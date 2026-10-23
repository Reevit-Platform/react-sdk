/**
 * useDirectBank
 *
 * The state machine behind Reevit's own bank transfer screens. It asks the server
 * for a one-off account (`charge`, method `bank_transfer`), follows the attempt
 * with adaptive polling (`status`), and asks the provider to look right now when
 * the payer says "I've sent it" (`status?check=1`).
 *
 * Rules it holds to:
 *  - Only `status === 'succeeded'` ends in success. "I've sent it" is a forced
 *    status read, never a shortcut; if nothing arrived it says so ("not seen yet")
 *    and keeps watching.
 *  - The account has an expiry. When the clock runs out the attempt gets one last
 *    forced read (a transfer can land in the final seconds), then the screen asks
 *    for new details. A new account is a new `charge`; the server refuses it
 *    (`409 attempt_pending`) while the old account could still receive money, and
 *    the screen waits.
 *  - One request of each kind in flight at a time, and a retry after an unanswered
 *    charge reuses its `attempt_token` so the server replays the attempt instead of
 *    opening a second account.
 *  - No card, phone or bank detail of the payer is collected anywhere here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BankDetails, DirectApiError, DirectChargeApi, PublicAttempt } from '../api/direct';

export type BankPhase = 'idle' | 'starting' | 'details' | 'confirming' | 'notSeen' | 'expired' | 'failed' | 'succeeded';

export interface BankFailure {
  title: string;
  message: string;
  retryable: boolean;
  code: string;
}

export interface DirectBankState {
  phase: BankPhase;
  attempt: PublicAttempt | null;
  details: BankDetails | null;
  /** Epoch ms. The account stops receiving money here. */
  expiresAt: number | null;
  /** Epoch ms the countdown started from. */
  startedAt: number | null;
  failure: BankFailure | null;
  /** A polite line for the expired and not-seen panels (earlier details still live, offline). */
  notice: string | null;
  /** The server's answer to "Get new details" while the old account is still live (epoch ms). */
  retryAt: number | null;
  /** "I've sent it" taps so far. */
  checks: number;
  busy: boolean;
}

const FINAL_FAILED = new Set(['failed', 'canceled', 'cancelled', 'expired', 'abandoned']);

/** The account lifetime when the server names none. */
export const DEFAULT_ACCOUNT_WINDOW_MS = 30 * 60_000;
const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
const DEFAULT_POLL_MS = 5_000;
/** Don't let "Check again" make two provider reads in the same breath. */
const MIN_CONFIRM_MS = 700;

export const BANK_COPY = {
  offline: 'Couldn’t reach Reevit. Try again.',
  still: 'Your earlier details are still active. Try again in a moment.',
} as const;

const initialState: DirectBankState = {
  phase: 'idle',
  attempt: null,
  details: null,
  expiresAt: null,
  startedAt: null,
  failure: null,
  notice: null,
  retryAt: null,
  checks: 0,
  busy: false,
};

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
  return 'b' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function bankFailure(view: PublicAttempt): BankFailure {
  const failure = view.failure;
  const code = failure?.code || view.status;
  if (failure?.category === 'provider_fault') {
    return { title: 'Couldn’t get account details', message: 'Try again, or use another method.', retryable: true, code };
  }
  return {
    title: 'Couldn’t get account details',
    message: failure?.category === 'invalid' && failure.message ? failure.message : 'Something went wrong. Please try again.',
    retryable: failure?.retryable ?? true,
    code,
  };
}

export interface UseDirectBankOptions {
  api: DirectChargeApi;
  sessionSecret?: string;
  provider: string;
  /** Called once, when the server reports `succeeded`. */
  onSuccess: (attempt: PublicAttempt, details: BankDetails | null) => void;
  /** Called when an attempt ends in failure (for the host's `onError`). */
  onFailure?: (failure: BankFailure) => void;
  /** The clock; tests and the preview freeze it. */
  now?: () => number;
  /** How long "Confirming your transfer" shows at least. Tests set 0. */
  minConfirmMs?: number;
}

export interface DirectBank extends DirectBankState {
  /** Ask for an account. Does nothing while one is live. */
  start: () => Promise<void>;
  /** "I've sent it" / "Check again": a forced status read. */
  sent: () => Promise<void>;
  /** "Keep waiting": back to the details, the countdown unchanged. */
  keepWaiting: () => void;
  /** "Get new details": a new account, once the old one is over. */
  newDetails: () => Promise<void>;
  /** Stop everything and forget the attempt. */
  reset: () => void;
}

export function useDirectBank(options: UseDirectBankOptions): DirectBank {
  const [state, setState] = useState<DirectBankState>(initialState);
  const stateRef = useRef<DirectBankState>(initialState);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const now = useCallback(() => (optionsRef.current.now ?? Date.now)(), []);

  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController>(new AbortController());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFlightRef = useRef<Promise<void> | null>(null);
  const attemptRef = useRef<{ id: string; secret: string; over: boolean } | null>(null);
  const successSentRef = useRef(false);
  const startLockRef = useRef(false);
  const confirmLockRef = useRef(false);
  const pendingTokenRef = useRef<string | null>(null);
  const pollErrorsRef = useRef(0);

  const patch = useCallback((next: Partial<DirectBankState>) => {
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
    (failure: BankFailure) => {
      clearTimers();
      patch({ phase: 'failed', failure, busy: false });
      optionsRef.current.onFailure?.(failure);
    },
    [clearTimers, patch],
  );

  const pollOnceRef = useRef<(force?: boolean) => Promise<PublicAttempt | null>>(async () => null);

  const schedulePoll = useCallback((delayMs: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    const current = attemptRef.current;
    if (!current || current.over || !aliveRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    pollTimerRef.current = setTimeout(() => void pollOnceRef.current(false), delayMs);
  }, []);

  const armExpiry = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    const { expiresAt, phase } = stateRef.current;
    if (!expiresAt || (phase !== 'details' && phase !== 'notSeen' && phase !== 'confirming')) return;
    const wait = Math.max(0, expiresAt - now()) + 1_000;
    expiryTimerRef.current = setTimeout(() => {
      expiryTimerRef.current = null;
      void (async () => {
        // One last forced read: a transfer can land in the final seconds, and the
        // read is also what closes the lapsed account on the server.
        await pollOnceRef.current(true);
        const s = stateRef.current;
        if (!aliveRef.current || (s.phase !== 'details' && s.phase !== 'notSeen' && s.phase !== 'confirming')) return;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
        patch({ phase: 'expired', notice: null, busy: false });
      })();
    }, wait);
  }, [now, patch]);

  /** Fold a public attempt view into the state. Returns true when it was final. */
  const applyAttempt = useCallback(
    (view: PublicAttempt, opts: { fresh?: boolean } = {}): boolean => {
      const current = attemptRef.current;
      if (current && view.id !== current.id) return false;

      if (view.status === 'succeeded') {
        if (current) current.over = true;
        clearTimers();
        patch({ phase: 'succeeded', attempt: view, busy: false, failure: null, notice: null });
        if (!successSentRef.current) {
          successSentRef.current = true;
          optionsRef.current.onSuccess(view, stateRef.current.details);
        }
        return true;
      }

      if (FINAL_FAILED.has(view.status)) {
        if (current) current.over = true;
        clearTimers();
        if (view.status === 'expired' || view.failure?.code === 'expired') {
          patch({ phase: 'expired', attempt: view, busy: false, notice: null });
        } else {
          failWith(bankFailure(view));
        }
        return true;
      }

      const s = stateRef.current;
      const bank = view.next_action?.type === 'bank_transfer' ? view.next_action.bank : undefined;
      const at = now();
      const startedAt = opts.fresh ? at : s.startedAt ?? at;
      const expiresAt = parseTime(bank?.expires_at ?? view.next_action?.expires_at) ?? (opts.fresh || !s.expiresAt ? startedAt + DEFAULT_ACCOUNT_WINDOW_MS : s.expiresAt);
      patch({ attempt: view, details: bank ?? s.details, startedAt, expiresAt });
      return false;
    },
    [clearTimers, failWith, now, patch],
  );

  const pollOnce = useCallback(
    (force = false): Promise<PublicAttempt | null> => {
      const current = attemptRef.current;
      if (!current || current.over || !aliveRef.current) return Promise.resolve(null);
      if (pollFlightRef.current && !force) return Promise.resolve(null);

      const run = (async (): Promise<PublicAttempt | null> => {
        const result = await optionsRef.current.api.status(current.id, current.secret, {
          signal: abortRef.current.signal,
          check: force,
        });
        if (!aliveRef.current || attemptRef.current !== current) return null;

        if (result.error) {
          if (result.error.code === 'aborted') return null;
          if (result.error.status === 404 || result.error.status === 401) {
            current.over = true;
            failWith({ title: 'Payment not found', message: 'We lost track of this payment. Start again.', retryable: true, code: result.error.code });
            return null;
          }
          pollErrorsRef.current += 1;
          const backoff = result.error.retryAfterMs ?? Math.min(DEFAULT_POLL_MS * 2 ** (pollErrorsRef.current - 1), MAX_POLL_MS);
          schedulePoll(Math.max(backoff, MIN_POLL_MS));
          throw result.error;
        }

        pollErrorsRef.current = 0;
        const final = applyAttempt(result.data);
        if (!final) schedulePoll(clampPoll(result.data.poll_after_ms));
        return result.data;
      })();

      pollFlightRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      void pollFlightRef.current.finally(() => {
        pollFlightRef.current = null;
      });

      return run.catch(() => null);
    },
    [applyAttempt, failWith, schedulePoll],
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
      const phase = stateRef.current.phase;
      if (current && !current.over && (phase === 'details' || phase === 'notSeen')) void pollOnceRef.current(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

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

  /** Open a new account. `from` is the phase the shopper pressed the button in. */
  const charge = useCallback(async () => {
    const { api, sessionSecret, provider } = optionsRef.current;
    if (startLockRef.current || !sessionSecret) return;
    startLockRef.current = true;
    const from = stateRef.current.phase;
    const token = pendingTokenRef.current ?? randomToken();
    pendingTokenRef.current = token;
    // "Get new details" keeps the expired panel until the answer arrives.
    patch({ phase: from === 'expired' || from === 'failed' ? from : 'starting', notice: null, busy: true });

    try {
      const result = await api.charge(sessionSecret, { method: 'bank_transfer', provider, attempt_token: token }, { signal: abortRef.current.signal });
      if (!aliveRef.current) return;

      if (result.error) {
        const e: DirectApiError = result.error;
        if (e.code === 'aborted') return;
        if (!e.unknownOutcome) pendingTokenRef.current = null;
        const back = (extra: Partial<DirectBankState>) => patch({ phase: from === 'idle' || from === 'starting' ? 'idle' : from, busy: false, ...extra });

        if (e.code === 'attempt_pending') {
          // The earlier account could still receive money: no second one until it lapses.
          const retryAt = parseTime(e.canResendAt);
          if (from === 'idle' || from === 'starting') {
            failWith({ title: 'Finish your earlier transfer', message: e.message || BANK_COPY.still, retryable: true, code: e.code });
          } else {
            back({ notice: e.message || BANK_COPY.still, retryAt });
          }
          return;
        }
        if (e.code === 'charge_limit_reached') {
          failWith({ title: 'No more attempts', message: 'You’ve used every attempt for this payment.', retryable: false, code: e.code });
          return;
        }
        if (e.code === 'no_providers_available' || e.code === 'provider_error') {
          failWith({ title: 'Couldn’t get account details', message: 'Try again, or use another method.', retryable: true, code: e.code });
          return;
        }
        if (e.status === 404 || e.status === 401 || e.status === 410 || e.code === 'checkout_session_closed') {
          failWith({
            title: e.status === 410 ? 'Checkout expired' : 'Checkout unavailable',
            message: e.status === 410 ? 'This checkout has expired. Start again.' : e.message,
            retryable: false,
            code: e.code,
          });
          return;
        }
        if (from === 'idle' || from === 'starting') {
          failWith({
            title: 'Couldn’t get account details',
            message: e.unknownOutcome ? 'We couldn’t confirm the details were issued. Check your connection and try again.' : e.message,
            retryable: true,
            code: e.code,
          });
        } else {
          back({ notice: e.unknownOutcome ? BANK_COPY.offline : e.message });
        }
        return;
      }

      pendingTokenRef.current = null;
      const view = result.data;
      if (view.next_action?.type === 'redirect') {
        failWith({ title: 'Use another method', message: 'This method can’t be paid here. Choose another.', retryable: false, code: 'redirect_not_supported' });
        return;
      }
      const secret = view.client_secret;
      const final = view.status === 'succeeded' || FINAL_FAILED.has(view.status);
      if (!secret && !final) {
        failWith({ title: 'Couldn’t get account details', message: 'Something went wrong. Please try again.', retryable: true, code: 'missing_secret' });
        return;
      }
      attemptRef.current = { id: view.id, secret: secret ?? '', over: final };
      pollErrorsRef.current = 0;
      successSentRef.current = false;
      clearTimers();

      const bank = view.next_action?.type === 'bank_transfer' ? view.next_action.bank : undefined;
      if (!final && !bank) {
        failWith({ title: 'Couldn’t get account details', message: 'Try again, or use another method.', retryable: true, code: 'missing_bank_details' });
        return;
      }
      patch({ details: bank ?? null, retryAt: null, checks: 0, failure: null });
      if (applyAttempt(view, { fresh: true })) return;
      patch({ phase: 'details', busy: false });
      armExpiry();
      schedulePoll(clampPoll(view.poll_after_ms));
    } finally {
      startLockRef.current = false;
    }
  }, [applyAttempt, armExpiry, clearTimers, failWith, patch, schedulePoll]);

  const start = useCallback(async () => {
    const phase = stateRef.current.phase;
    if (phase !== 'idle' && phase !== 'failed') return;
    await charge();
  }, [charge]);

  const sent = useCallback(async () => {
    const s = stateRef.current;
    const current = attemptRef.current;
    if (!current || confirmLockRef.current || (s.phase !== 'details' && s.phase !== 'notSeen')) return;
    confirmLockRef.current = true;
    const before = s.phase;
    patch({ phase: 'confirming', checks: s.checks + 1, notice: null });
    const started = Date.now();

    try {
      const view = await pollOnceRef.current(true);
      // "Confirming" is a beat, not a flash.
      const floor = optionsRef.current.minConfirmMs ?? MIN_CONFIRM_MS;
      const spent = Date.now() - started;
      if (floor > 0 && spent < floor && aliveRef.current && (!view || (view.status !== 'succeeded' && !FINAL_FAILED.has(view.status)))) {
        await new Promise((r) => setTimeout(r, floor - Math.max(0, spent)));
      }
      if (!aliveRef.current) return;
      const after = stateRef.current;
      if (after.phase !== 'confirming') return; // succeeded, expired or failed in the meantime
      if (!view) {
        patch({ phase: before, notice: BANK_COPY.offline });
        return;
      }
      patch({ phase: 'notSeen' });
      armExpiry();
    } finally {
      confirmLockRef.current = false;
    }
  }, [armExpiry, patch]);

  const keepWaiting = useCallback(() => {
    if (stateRef.current.phase !== 'notSeen') return;
    patch({ phase: 'details', notice: null });
  }, [patch]);

  const newDetails = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'expired' && s.phase !== 'failed') return;
    const current = attemptRef.current;
    patch({ busy: true, notice: null });

    // A last forced read first: money sent just before expiry must not be stranded
    // by a second account, and the read closes the old account server-side.
    if (current && !current.over) {
      const view = await pollOnceRef.current(true);
      if (!aliveRef.current) return;
      if (view?.status === 'succeeded') return;
    }
    await charge();
  }, [charge, patch]);

  const reset = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    clearTimers();
    attemptRef.current = null;
    pollFlightRef.current = null;
    pendingTokenRef.current = null;
    successSentRef.current = false;
    startLockRef.current = false;
    confirmLockRef.current = false;
    pollErrorsRef.current = 0;
    patch({ ...initialState });
  }, [clearTimers, patch]);

  return useMemo(() => ({ ...state, start, sent, keepWaiting, newDetails, reset }), [state, start, sent, keepWaiting, newDetails, reset]);
}
