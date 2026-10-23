/**
 * useDirectCharge
 *
 * The state machine behind Reevit's own mobile money screens. It starts a prompt
 * (`charge`), follows the attempt with adaptive polling (`status`), takes an OTP
 * or voucher (`action`), and asks for a fresh prompt (`resend`).
 *
 * Rules it holds to:
 *  - Only `status === 'succeeded'` ends in success. "I've approved" is an immediate
 *    status read, never a shortcut.
 *  - One request of each kind in flight at a time. Every user action carries its
 *    own `attempt_token`; a retry after an unanswered request reuses the token so
 *    the server replays the attempt instead of sending a second prompt.
 *  - Polling follows the server's `poll_after_ms`, backs off on errors, pauses
 *    while the tab is hidden, and stops on abort, unmount or close.
 *  - Running out the clock never ends the attempt on its own authority: the
 *    countdown ends the screen, but the attempt is still watched, so an approval
 *    that lands late still reaches success.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttemptFailure, DirectApiError, DirectChargeApi, PublicAttempt } from '../api/direct';

export type DirectPhase = 'idle' | 'starting' | 'waiting' | 'code' | 'submitting' | 'failed' | 'succeeded';

export type DirectFailureKind = 'declined' | 'insufficient' | 'timeout' | 'provider' | 'locked' | 'exhausted' | 'other';

export interface DirectFailure {
  kind: DirectFailureKind;
  title: string;
  message: string;
  retryable: boolean;
  code: string;
}

export interface DirectInput {
  phone: string;
  network?: string;
}

export interface DirectChargeState {
  phase: DirectPhase;
  /** The latest public view of the live attempt. */
  attempt: PublicAttempt | null;
  input: DirectInput | null;
  /** Epoch ms. The prompt stops being approvable here (server `expires_at`, else a 2 minute default). */
  expiresAt: number | null;
  /** Epoch ms the countdown started from. */
  startedAt: number | null;
  /** Epoch ms from which "Resend prompt" is enabled. */
  canResendAt: number | null;
  failure: DirectFailure | null;
  /** A polite status line for the wait and failure panels. */
  notice: string | null;
  /** A line above the form's button (earlier prompt still active, bad number, offline). */
  formNotice: string | null;
  checking: boolean;
  resending: boolean;
  /** The server will send no more prompts for this attempt. */
  resendClosed: boolean;
  codeError: string | null;
  /** `next_action.type` of the code being asked for. */
  codeKind: 'otp' | 'voucher' | null;
}

const FINAL_FAILED = new Set(['failed', 'canceled', 'cancelled', 'expired', 'abandoned']);

/** The prompt window when the server names none. */
export const DEFAULT_PROMPT_WINDOW_MS = 120_000;
/** The server enforces 30 s between prompts. */
const RESEND_COOLDOWN_MS = 30_000;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 15_000;
const DEFAULT_POLL_MS = 2_000;
/** How long a timed-out attempt is still watched for a late approval. */
const WATCH_GRACE_MS = 5 * 60_000;
/** A wrong or slow answer should not make two requests in the same breath. */
const MIN_FORCE_GAP_MS = 800;

export const FAILOVER_NOW = 'Your provider didn’t respond. Retrying with another…';
export const FAILOVER_DONE = 'Your provider didn’t respond — we retried with another and it went through.';

const COPY = {
  checking: 'Checking with your provider…',
  notYet: 'We haven’t received your approval yet.',
  newPrompt: 'New prompt sent.',
  offline: 'Trouble reaching Reevit. Still trying…',
  unreachable: 'Couldn’t reach Reevit. Try again.',
} as const;

const initialState: DirectChargeState = {
  phase: 'idle',
  attempt: null,
  input: null,
  expiresAt: null,
  startedAt: null,
  canResendAt: null,
  failure: null,
  notice: null,
  formNotice: null,
  checking: false,
  resending: false,
  resendClosed: false,
  codeError: null,
  codeKind: null,
};

export function mapFailure(failure: AttemptFailure | undefined, status: string): DirectFailure {
  const category = failure?.category;
  const code = failure?.code || status;
  const retryable = failure?.retryable ?? true;

  if (category === 'insufficient_funds') {
    return { kind: 'insufficient', title: 'Insufficient funds', message: 'Top up your wallet, then try again.', retryable, code };
  }
  if (category === 'timeout' || status === 'expired') {
    return { kind: 'timeout', title: 'No response in time', message: 'The approval prompt expired.', retryable: true, code };
  }
  if (category === 'provider_fault') {
    return {
      kind: 'provider',
      title: 'Couldn’t reach your provider',
      message: 'Try again, or use another method.',
      retryable: true,
      code,
    };
  }
  if (code === 'code_locked') {
    return { kind: 'locked', title: 'Too many wrong codes', message: 'Start again to get a new code.', retryable: true, code };
  }
  if (category === 'declined' || category === 'not_approved' || status === 'canceled' || status === 'cancelled') {
    return {
      kind: 'declined',
      title: 'Payment declined',
      message: 'The request wasn’t approved on your phone.',
      retryable,
      code,
    };
  }
  return {
    kind: 'other',
    title: category === 'invalid' ? 'Check your details' : 'Payment failed',
    message: failure?.message || 'Something went wrong. Please try again.',
    retryable,
    code,
  };
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function clampPoll(ms: number | undefined): number {
  const wanted = ms && ms > 0 ? ms : DEFAULT_POLL_MS;
  return Math.min(Math.max(wanted, MIN_POLL_MS), MAX_POLL_MS);
}

function randomToken(): string {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'a' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UseDirectChargeOptions {
  api: DirectChargeApi;
  sessionSecret?: string;
  provider: string;
  /** Called once, when the server reports `succeeded`. */
  onSuccess: (attempt: PublicAttempt, input: DirectInput | null) => void;
  /** Called when an attempt ends in failure (for the host's `onError`). */
  onFailure?: (failure: DirectFailure) => void;
  /** The clock; tests and the preview freeze it. */
  now?: () => number;
}

export interface DirectCharge extends DirectChargeState {
  start: (input: DirectInput) => Promise<void>;
  /** "I've approved": an immediate status read. */
  check: () => Promise<void>;
  resend: () => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  /** Back to the form, keeping the number. The earlier attempt is still watched. */
  useAnotherNumber: () => void;
  /** "Try again": a new attempt with the same number. */
  retry: () => Promise<void>;
  /** Stop everything and forget the attempt (leaving direct mode, or closing). */
  reset: () => void;
}

export function useDirectCharge(options: UseDirectChargeOptions): DirectCharge {
  const [state, setState] = useState<DirectChargeState>(initialState);
  const stateRef = useRef<DirectChargeState>(initialState);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const now = useCallback(() => (optionsRef.current.now ?? Date.now)(), []);

  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController>(new AbortController());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFlightRef = useRef<Promise<void> | null>(null);
  const lastPollAtRef = useRef(0);
  const pollErrorsRef = useRef(0);
  /** The attempt being followed. `over` once it is known final. */
  const attemptRef = useRef<{ id: string; secret: string; over: boolean } | null>(null);
  const successSentRef = useRef(false);
  const startLockRef = useRef(false);
  const resendLockRef = useRef(false);
  const codeLockRef = useRef(false);
  /** Token of an unanswered charge, reused if the same input is sent again. */
  const pendingTokenRef = useRef<{ key: string; token: string } | null>(null);

  const patch = useCallback((next: Partial<DirectChargeState>) => {
    stateRef.current = { ...stateRef.current, ...next };
    if (aliveRef.current) setState(stateRef.current);
  }, []);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    pollTimerRef.current = null;
    expiryTimerRef.current = null;
  }, []);

  const failWith = useCallback(
    (failure: DirectFailure, extra: Partial<DirectChargeState> = {}) => {
      patch({ phase: 'failed', failure, checking: false, resending: false, ...extra });
      optionsRef.current.onFailure?.(failure);
    },
    [patch],
  );

  // ---- polling ---------------------------------------------------------------------------

  const pollOnceRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const schedulePoll = useCallback(
    (delayMs: number) => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
      const current = attemptRef.current;
      if (!current || current.over || !aliveRef.current) return;
      // A hidden tab does not poll; the visibility handler resumes it.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pollTimerRef.current = setTimeout(() => void pollOnceRef.current(), delayMs);
    },
    [],
  );

  const armExpiry = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    const { expiresAt, phase } = stateRef.current;
    if (!expiresAt || (phase !== 'waiting' && phase !== 'code')) return;
    const wait = Math.max(0, expiresAt - now()) + 1_000;
    expiryTimerRef.current = setTimeout(() => {
      expiryTimerRef.current = null;
      void (async () => {
        // One last read decides: the approval may have landed in the final second.
        await pollOnceRef.current(true);
        const s = stateRef.current;
        if (!aliveRef.current || (s.phase !== 'waiting' && s.phase !== 'code')) return;
        failWith(mapFailure({ code: 'timeout', category: 'timeout', retryable: true, message: '' }, 'pending'));
        // Keep watching for a late approval.
        schedulePoll(clampPoll(s.attempt?.poll_after_ms));
      })();
    }, wait);
  }, [failWith, now, schedulePoll]);

  /**
   * Fold a public attempt view into the state. `resume` lets the view move a failed
   * screen back to waiting (a resend that succeeded).
   */
  const applyAttempt = useCallback(
    (view: PublicAttempt, opts: { resume?: boolean; fresh?: boolean } = {}) => {
      const s = stateRef.current;
      const current = attemptRef.current;
      if (current && view.id !== current.id) return;

      const at = now();
      if (view.status === 'succeeded') {
        if (current) current.over = true;
        clearTimers();
        patch({ phase: 'succeeded', attempt: view, checking: false, resending: false, failure: null, notice: null });
        if (!successSentRef.current) {
          successSentRef.current = true;
          optionsRef.current.onSuccess(view, stateRef.current.input);
        }
        return;
      }

      if (FINAL_FAILED.has(view.status)) {
        if (current) current.over = true;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
        // On the form (after "Use another number") or already on the timeout screen: say nothing new.
        if (s.phase === 'idle' || (s.phase === 'failed' && !opts.resume)) {
          patch({ attempt: view, checking: false });
          return;
        }
        failWith(mapFailure(view.failure, view.status), { attempt: view, notice: null, formNotice: null });
        return;
      }

      // Still live.
      const action = view.next_action;
      const wantsCode = action?.type === 'otp' || action?.type === 'voucher';
      const startedAt = opts.fresh ? at : s.startedAt ?? at;
      const expiresAt = parseTime(action?.expires_at) ?? (opts.fresh || !s.expiresAt ? startedAt + DEFAULT_PROMPT_WINDOW_MS : s.expiresAt);
      const canResendAt = parseTime(action?.can_resend_at) ?? (opts.fresh || !s.canResendAt ? startedAt + RESEND_COOLDOWN_MS : s.canResendAt);

      const base: Partial<DirectChargeState> = { attempt: view, startedAt, expiresAt, canResendAt, checking: false };
      const mayMove = s.phase === 'starting' || s.phase === 'waiting' || s.phase === 'code' || s.phase === 'submitting' || opts.resume;
      if (!mayMove) {
        // Background watch while the shopper is on the form or the timeout screen.
        patch(base);
        return;
      }
      if (wantsCode) {
        patch({
          ...base,
          phase: 'code',
          codeKind: action?.type === 'voucher' ? 'voucher' : 'otp',
          failure: null,
          codeError: s.phase === 'submitting' && s.codeKind === (action?.type === 'voucher' ? 'voucher' : 'otp') ? s.codeError : null,
        });
      } else {
        patch({ ...base, phase: 'waiting', failure: null, codeKind: null, codeError: null });
      }
      armExpiry();
    },
    [armExpiry, clearTimers, failWith, now, patch],
  );

  const pollOnce = useCallback(
    (force = false): Promise<void> => {
      const current = attemptRef.current;
      if (!current || current.over || !aliveRef.current) return Promise.resolve();
      if (pollFlightRef.current) return pollFlightRef.current;
      if (force && now() - lastPollAtRef.current < MIN_FORCE_GAP_MS) {
        schedulePoll(MIN_FORCE_GAP_MS);
        return Promise.resolve();
      }

      const run = (async () => {
        lastPollAtRef.current = now();
        const result = await optionsRef.current.api.status(current.id, current.secret, { signal: abortRef.current.signal });
        if (!aliveRef.current || attemptRef.current !== current) return;

        if (result.error) {
          handlePollError(result.error);
          return;
        }
        pollErrorsRef.current = 0;
        if (stateRef.current.notice === COPY.offline) patch({ notice: null });
        applyAttempt(result.data);

        // Past the grace, an attempt nobody is waiting on any more is left to the webhook.
        const s = stateRef.current;
        if (s.expiresAt && now() > s.expiresAt + WATCH_GRACE_MS && s.phase !== 'waiting' && s.phase !== 'code') {
          current.over = true;
          return;
        }
        if (!current.over) schedulePoll(clampPoll(result.data.poll_after_ms));
      })().finally(() => {
        pollFlightRef.current = null;
      });
      pollFlightRef.current = run;
      return run;

      function handlePollError(error: DirectApiError) {
        if (error.code === 'aborted') return;
        if (error.status === 404 || error.status === 401) {
          current!.over = true;
          failWith({
            kind: 'other',
            title: 'Payment not found',
            message: 'We lost track of this payment. Start again.',
            retryable: true,
            code: error.code,
          });
          return;
        }
        pollErrorsRef.current += 1;
        if (pollErrorsRef.current >= 3 && !stateRef.current.notice) patch({ notice: COPY.offline });
        const backoff =
          error.retryAfterMs ?? Math.min(DEFAULT_POLL_MS * 2 ** (pollErrorsRef.current - 1), MAX_POLL_MS);
        schedulePoll(Math.max(backoff, MIN_POLL_MS));
      }
    },
    [applyAttempt, failWith, now, patch, schedulePoll],
  );
  pollOnceRef.current = pollOnce;

  // Pause while the tab is hidden; read straight away when it comes back.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
        return;
      }
      const current = attemptRef.current;
      if (current && !current.over) void pollOnceRef.current(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Abort everything on unmount.
  useEffect(() => {
    aliveRef.current = true;
    // StrictMode runs this effect, its cleanup, then the effect again: the controller must be live.
    if (abortRef.current.signal.aborted) abortRef.current = new AbortController();
    return () => {
      aliveRef.current = false;
      abortRef.current.abort();
      clearTimers();
    };
  }, [clearTimers]);

  // ---- actions ---------------------------------------------------------------------------

  const adoptAttempt = useCallback((view: PublicAttempt, fallbackSecret?: string): boolean => {
    const secret = view.client_secret || (attemptRef.current?.id === view.id ? attemptRef.current.secret : fallbackSecret) || '';
    // A final answer needs no secret to be followed: there is nothing left to ask.
    const final = view.status === 'succeeded' || FINAL_FAILED.has(view.status);
    if (!secret && !final) return false;
    attemptRef.current = { id: view.id, secret, over: final };
    pollErrorsRef.current = 0;
    return true;
  }, []);

  const start = useCallback(
    async (input: DirectInput) => {
      const { api, sessionSecret, provider } = optionsRef.current;
      if (startLockRef.current || !sessionSecret) return;
      startLockRef.current = true;
      const from = stateRef.current.phase;
      const key = `${input.phone}|${input.network ?? ''}`;
      const token = pendingTokenRef.current?.key === key ? pendingTokenRef.current.token : randomToken();
      pendingTokenRef.current = { key, token };
      // A re-send from the failure panel keeps that panel until the answer arrives.
      patch({ phase: from === 'failed' ? 'failed' : 'starting', input, formNotice: null, notice: null, checking: false });

      try {
        const result = await api.charge(
          sessionSecret,
          { method: 'mobile_money', provider, phone: input.phone, network: input.network, attempt_token: token },
          { signal: abortRef.current.signal },
        );
        if (!aliveRef.current) return;

        if (result.error) {
          const e = result.error;
          if (e.code === 'aborted') return;
          if (!e.unknownOutcome) pendingTokenRef.current = null;
          // Back where the shopper pressed the button: the failure panel keeps its place, the form its own line.
          const say = (message: string) =>
            patch(from === 'failed' ? { phase: 'failed', notice: message } : { phase: 'idle', formNotice: message });

          if (e.code === 'attempt_pending') {
            say(e.message);
            if (e.canResendAt) patch({ canResendAt: parseTime(e.canResendAt) });
            // The earlier prompt is still live: keep following it.
            if (attemptRef.current && !attemptRef.current.over) schedulePoll(MIN_POLL_MS);
            return;
          }
          if (e.code === 'charge_limit_reached') {
            failWith({
              kind: 'exhausted',
              title: 'No more attempts',
              message: 'You’ve used every attempt for this payment.',
              retryable: false,
              code: e.code,
            });
            return;
          }
          if (e.code === 'no_providers_available' || e.code === 'provider_error') {
            // Every route failed before a prompt went out: nothing was sent, so it is safe to try again.
            failWith({
              kind: 'provider',
              title: 'Couldn’t reach your provider',
              message: 'Try again, or use another method.',
              retryable: true,
              code: e.code,
            });
            return;
          }
          if (e.status === 404 || e.status === 401 || e.status === 410 || e.code === 'checkout_session_closed') {
            failWith({
              kind: 'other',
              title: e.status === 410 ? 'Checkout expired' : 'Checkout unavailable',
              message: e.status === 410 ? 'This checkout has expired. Start again.' : e.message,
              retryable: false,
              code: e.code,
            });
            return;
          }
          say(e.unknownOutcome ? 'We couldn’t confirm the prompt was sent. Check your connection and try again.' : e.message);
          return;
        }

        pendingTokenRef.current = null;
        const view = result.data;
        if (view.next_action?.type === 'redirect') {
          failWith({
            kind: 'other',
            title: 'Use another method',
            message: 'This method can’t be paid here. Choose another.',
            retryable: false,
            code: 'redirect_not_supported',
          });
          return;
        }
        if (!adoptAttempt(view)) {
          failWith({ kind: 'other', title: 'Payment failed', message: 'Something went wrong. Please try again.', retryable: true, code: 'missing_secret' });
          return;
        }
        successSentRef.current = false;
        clearTimers();
        patch({ resendClosed: false, notice: null, formNotice: null });
        applyAttempt(view, { resume: true, fresh: true });
        if (!attemptRef.current?.over) schedulePoll(clampPoll(view.poll_after_ms));
      } finally {
        startLockRef.current = false;
      }
    },
    [adoptAttempt, applyAttempt, clearTimers, failWith, patch, schedulePoll],
  );

  const check = useCallback(async () => {
    const s = stateRef.current;
    if (s.checking || (s.phase !== 'waiting' && s.phase !== 'code')) return;
    patch({ checking: true, notice: COPY.checking });
    await pollOnceRef.current(true);
    if (!aliveRef.current) return;
    if (stateRef.current.phase === 'waiting') {
      patch({ checking: false, notice: pollErrorsRef.current > 0 ? COPY.unreachable : COPY.notYet });
    } else {
      patch({ checking: false });
    }
  }, [patch]);

  const resend = useCallback(async () => {
    const current = attemptRef.current;
    const s = stateRef.current;
    if (!current || resendLockRef.current || s.resendClosed) return;
    if (s.phase !== 'waiting' && s.phase !== 'failed' && s.phase !== 'code') return;
    resendLockRef.current = true;
    patch({ resending: true, notice: null });

    try {
      const result = await optionsRef.current.api.resend(current.id, current.secret, { signal: abortRef.current.signal });
      if (!aliveRef.current) return;

      if (result.error) {
        const e = result.error;
        if (e.code === 'aborted') return;
        if (e.code === 'attempt_pending') {
          patch({ resending: false, notice: e.message, canResendAt: parseTime(e.canResendAt) ?? stateRef.current.canResendAt });
          // Still live: the answer may arrive any second.
          if (!current.over) schedulePoll(MIN_POLL_MS);
          return;
        }
        if (e.code === 'resend_cooldown') {
          patch({ resending: false, notice: e.message, canResendAt: now() + (e.retryAfterMs ?? RESEND_COOLDOWN_MS) });
          return;
        }
        if (e.code === 'resend_limit_reached' || e.code === 'resend_not_supported') {
          patch({ resending: false, resendClosed: true, notice: e.message });
          return;
        }
        if (e.code === 'charge_limit_reached') {
          patch({ resending: false });
          failWith({
            kind: 'exhausted',
            title: 'No more attempts',
            message: 'You’ve used every attempt for this payment.',
            retryable: false,
            code: e.code,
          });
          return;
        }
        if (e.status === 404) {
          current.over = true;
          failWith({ kind: 'other', title: 'Payment not found', message: 'We lost track of this payment. Start again.', retryable: true, code: e.code });
          return;
        }
        patch({ resending: false, notice: e.unknownOutcome ? 'Couldn’t send a new prompt. Check your connection and try again.' : e.message });
        return;
      }

      const view = result.data;
      const next = view.id !== current.id;
      if (next && !adoptAttempt(view)) {
        patch({ resending: false, notice: 'Couldn’t send a new prompt. Try again.' });
        return;
      }
      clearTimers();
      patch({ resending: false, notice: COPY.newPrompt, formNotice: null, failure: null });
      applyAttempt(view, { resume: true, fresh: true });
      if (!attemptRef.current?.over) schedulePoll(clampPoll(view.poll_after_ms));
    } finally {
      resendLockRef.current = false;
    }
  }, [adoptAttempt, applyAttempt, clearTimers, failWith, now, patch, schedulePoll]);

  const submitCode = useCallback(
    async (code: string) => {
      const current = attemptRef.current;
      const s = stateRef.current;
      const kind = s.codeKind;
      if (!current || !kind || codeLockRef.current || s.phase !== 'code') return;
      codeLockRef.current = true;
      patch({ phase: 'submitting', codeError: null });

      try {
        const result = await optionsRef.current.api.action(current.id, current.secret, { type: kind, code }, { signal: abortRef.current.signal });
        if (!aliveRef.current) return;

        if (result.error) {
          const e = result.error;
          if (e.code === 'aborted') return;
          if (e.code === 'invalid_code') {
            const left = e.attemptsLeft;
            patch({
              phase: 'code',
              codeError:
                typeof left === 'number' && left > 0 && left <= 2
                  ? `That code wasn’t accepted. ${left} ${left === 1 ? 'try' : 'tries'} left.`
                  : 'That code wasn’t accepted.',
            });
            return;
          }
          if (e.code === 'attempt_locked') {
            current.over = true;
            failWith({
              kind: 'locked',
              title: 'Too many wrong codes',
              message: 'Start again to get a new code.',
              retryable: true,
              code: e.code,
            });
            return;
          }
          if (e.code === 'action_not_allowed') {
            // Not waiting for a code any more: the status read says where it went.
            patch({ phase: 'waiting', codeKind: null });
            await pollOnceRef.current(true);
            return;
          }
          if (e.status === 404) {
            current.over = true;
            failWith({ kind: 'other', title: 'Payment not found', message: 'We lost track of this payment. Start again.', retryable: true, code: e.code });
            return;
          }
          patch({ phase: 'code', codeError: e.unknownOutcome ? 'Couldn’t reach Reevit. Try again.' : e.message });
          return;
        }

        applyAttempt(result.data);
        if (!current.over) schedulePoll(clampPoll(result.data.poll_after_ms));
      } finally {
        codeLockRef.current = false;
      }
    },
    [applyAttempt, failWith, patch, schedulePoll],
  );

  const useAnotherNumber = useCallback(() => {
    // The earlier prompt may still be live, so it stays watched.
    patch({ phase: 'idle', failure: null, notice: null, formNotice: null, checking: false, codeError: null, codeKind: null });
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, [patch]);

  const retry = useCallback(async () => {
    const input = stateRef.current.input;
    if (input) await start(input);
  }, [start]);

  const reset = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    clearTimers();
    attemptRef.current = null;
    pollFlightRef.current = null;
    pendingTokenRef.current = null;
    successSentRef.current = false;
    startLockRef.current = false;
    resendLockRef.current = false;
    codeLockRef.current = false;
    pollErrorsRef.current = 0;
    patch({ ...initialState });
  }, [clearTimers, patch]);

  return useMemo(
    () => ({ ...state, start, check, resend, submitCode, useAnotherNumber, retry, reset }),
    [state, start, check, resend, submitCode, useAnotherNumber, retry, reset],
  );
}
