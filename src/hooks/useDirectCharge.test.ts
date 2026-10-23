import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirectApiError, DirectChargeApi, DirectResult, PublicAttempt } from '../api/direct';
import { useDirectCharge } from './useDirectCharge';

const T0 = Date.parse('2026-10-23T12:00:00Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function attempt(over: Partial<PublicAttempt> = {}): PublicAttempt {
  return {
    id: 'pay_1',
    status: 'pending',
    amount: 75500,
    currency: 'GHS',
    method: 'mobile_money',
    provider_display: 'Test provider',
    client_secret: 'secret_1',
    next_action: { type: 'mobile_money_prompt', network: 'mtn', phone_masked: '024 ••• 8890', expires_at: iso(120_000), attempt: { n: 1, max: 3 } },
    rerouted: false,
    poll_after_ms: 2000,
    ...over,
  };
}

const ok = (data: PublicAttempt): DirectResult<PublicAttempt> => ({ data });
const fail = (status: number, code: string, extra: Partial<DirectApiError> = {}): DirectResult<PublicAttempt> => ({
  error: { status, code, message: `message for ${code}`, unknownOutcome: false, ...extra },
});
const failed = (code: string, category: string): PublicAttempt =>
  attempt({ status: 'failed', next_action: undefined, failure: { code, category, retryable: true, message: 'server wording' }, poll_after_ms: 0, client_secret: undefined });
const paid = (): PublicAttempt => attempt({ status: 'succeeded', next_action: undefined, poll_after_ms: 0, client_secret: undefined });

type Script = DirectResult<PublicAttempt> | (() => DirectResult<PublicAttempt> | Promise<DirectResult<PublicAttempt>>);

/** A scripted API: each call takes the next queued answer, the last one repeating. */
function makeApi(scripts: Partial<Record<'charge' | 'status' | 'action' | 'resend', Script[]>>) {
  const queues = {
    charge: [...(scripts.charge ?? [])],
    status: [...(scripts.status ?? [])],
    action: [...(scripts.action ?? [])],
    resend: [...(scripts.resend ?? [])],
  };
  const calls = { charge: [] as unknown[][], status: [] as unknown[][], action: [] as unknown[][], resend: [] as unknown[][] };
  const next = (name: keyof typeof queues, args: unknown[]) => {
    calls[name].push(args);
    const q = queues[name];
    const item = q.length > 1 ? q.shift()! : q[0];
    if (!item) throw new Error(`no script for ${name}`);
    return Promise.resolve(typeof item === 'function' ? item() : item);
  };
  const api: DirectChargeApi = {
    charge: (...args) => next('charge', args),
    status: (...args) => next('status', args),
    action: (...args) => next('action', args),
    resend: (...args) => next('resend', args),
  };
  return { api, calls };
}

function setup(scripts: Parameters<typeof makeApi>[0]) {
  const { api, calls } = makeApi(scripts);
  const onSuccess = vi.fn();
  const onFailure = vi.fn();
  const hook = renderHook(() =>
    useDirectCharge({ api, sessionSecret: 'cs_1', provider: 'stub', onSuccess, onFailure, now: () => Date.now() }),
  );
  return { ...hook, calls, onSuccess, onFailure };
}

const INPUT = { phone: '0244128890', network: 'mtn' };

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startIt(h: ReturnType<typeof setup>) {
  await act(async () => {
    await h.result.current.start(INPUT);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDirectCharge: the happy path', () => {
  it('waits on a pending attempt and only ends on succeeded, polling at the server pace', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined })), ok(attempt({ client_secret: undefined, poll_after_ms: 5000 })), ok(paid())] });
    await startIt(h);
    expect(h.result.current.phase).toBe('waiting');
    expect(h.calls.charge).toHaveLength(1);
    expect(h.calls.status).toHaveLength(0);

    await flush(1999);
    expect(h.calls.status).toHaveLength(0);
    await flush(1);
    expect(h.calls.status).toHaveLength(1);
    expect(h.result.current.phase).toBe('waiting');
    expect(h.onSuccess).not.toHaveBeenCalled();

    // The second answer asked for 5 s.
    await flush(4999);
    expect(h.calls.status).toHaveLength(2);
    await flush(1);
    expect(h.calls.status).toHaveLength(2);
    await flush(5000);
    expect(h.calls.status).toHaveLength(3);
    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);

    // Nothing more is asked once it has succeeded.
    await flush(60_000);
    expect(h.calls.status).toHaveLength(3);
  });

  it('sends the attempt secret on every follow-up, never the session secret', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(paid())] });
    await startIt(h);
    await flush(2000);
    const [id, secret] = h.calls.status[0] as [string, string];
    expect(id).toBe('pay_1');
    expect(secret).toBe('secret_1');
  });

  it('a charge that answers pending never counts as paid', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    await flush(30_000);
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.result.current.phase).toBe('waiting');
  });
});

describe('useDirectCharge: "I\'ve approved"', () => {
  it('reads the status straight away, says so, and never marks success itself', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    await act(async () => {
      await h.result.current.check();
    });
    expect(h.calls.status).toHaveLength(1);
    expect(h.result.current.notice).toBe('We haven’t received your approval yet.');
    expect(h.result.current.phase).toBe('waiting');
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it('is single-flight: a second tap while the read is out makes no second request', async () => {
    let release: (value: DirectResult<PublicAttempt>) => void = () => {};
    const slow = () => new Promise<DirectResult<PublicAttempt>>((resolve) => { release = resolve; });
    const h = setup({ charge: [ok(attempt())], status: [slow] });
    await startIt(h);
    let first: Promise<void>;
    act(() => { first = h.result.current.check(); });
    act(() => { void h.result.current.check(); });
    expect(h.calls.status).toHaveLength(1);
    expect(h.result.current.checking).toBe(true);
    await act(async () => {
      release(ok(paid()));
      await first;
    });
    expect(h.result.current.phase).toBe('succeeded');
  });
});

describe('useDirectCharge: customer failures', () => {
  it.each([
    ['declined', 'declined', 'Payment declined'],
    ['not_approved', 'not_approved', 'Payment declined'],
    ['insufficient_funds', 'insufficient_funds', 'Insufficient funds'],
  ])('maps %s to its own panel', async (code, category, title) => {
    const h = setup({ charge: [ok(attempt())], status: [ok(failed(code, category))] });
    await startIt(h);
    await flush(2000);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.title).toBe(title);
    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).not.toHaveBeenCalled();
    // A failed attempt is final: no more polling.
    const polls = h.calls.status.length;
    await flush(60_000);
    expect(h.calls.status).toHaveLength(polls);
  });

  it('a decline in the charge response itself goes straight to the failure panel', async () => {
    const h = setup({ charge: [ok(failed('declined', 'declined'))] });
    await startIt(h);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.kind).toBe('declined');
  });

  it('"Try again" starts a new attempt for the same number with a new token', async () => {
    const second = attempt({ id: 'pay_2', client_secret: 'secret_2' });
    const h = setup({ charge: [ok(attempt()), ok(second)], status: [ok(failed('declined', 'declined'))] });
    await startIt(h);
    await flush(2000);
    expect(h.result.current.phase).toBe('failed');
    await act(async () => {
      await h.result.current.retry();
    });
    expect(h.calls.charge).toHaveLength(2);
    const bodies = h.calls.charge.map((c) => c[1] as { phone: string; attempt_token: string });
    expect(bodies[1].phone).toBe('0244128890');
    expect(bodies[1].attempt_token).not.toBe(bodies[0].attempt_token);
    expect(h.result.current.phase).toBe('waiting');
    expect(h.result.current.attempt?.id).toBe('pay_2');
  });
});

describe('useDirectCharge: timeout and late success', () => {
  it('the countdown ends the screen after one last read, and a late approval still reaches success', async () => {
    const pending = ok(attempt({ client_secret: undefined }));
    const h = setup({ charge: [ok(attempt())], status: [pending] });
    await startIt(h);
    await flush(125_000);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.kind).toBe('timeout');
    expect(h.result.current.failure?.title).toBe('No response in time');
    expect(h.onSuccess).not.toHaveBeenCalled();

    // The same attempt is still watched; an approval that lands late is the paid one.
    const before = h.calls.status.length;
    await flush(10_000);
    expect(h.calls.status.length).toBeGreaterThan(before);
  });

  it('late success: the status flips to succeeded after the timeout screen', async () => {
    let paidNow = false;
    const h = setup({
      charge: [ok(attempt())],
      status: [() => (paidNow ? ok(paid()) : ok(attempt({ client_secret: undefined })))],
    });
    await startIt(h);
    await flush(125_000);
    expect(h.result.current.failure?.kind).toBe('timeout');
    paidNow = true;
    await flush(5000);
    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('stops watching an attempt five minutes after it timed out', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    await flush(125_000 + 5 * 60_000 + 20_000);
    const n = h.calls.status.length;
    await flush(60_000);
    expect(h.calls.status).toHaveLength(n);
  });
});

describe('useDirectCharge: resend', () => {
  it('a 409 attempt_pending keeps the prompt, shows the server line and moves can_resend_at', async () => {
    const later = iso(45_000);
    const h = setup({
      charge: [ok(attempt())],
      status: [ok(attempt({ client_secret: undefined }))],
      resend: [fail(409, 'attempt_pending', { canResendAt: later, retryAfterMs: 45_000 })],
    });
    await startIt(h);
    await flush(31_000);
    await act(async () => {
      await h.result.current.resend();
    });
    expect(h.result.current.phase).toBe('waiting');
    expect(h.result.current.notice).toBe('message for attempt_pending');
    expect(h.result.current.canResendAt).toBe(Date.parse(later));
    expect(h.result.current.resending).toBe(false);
    expect(h.result.current.attempt?.id).toBe('pay_1');
  });

  it('a new prompt switches to the new attempt and follows its secret', async () => {
    const second = attempt({ id: 'pay_2', client_secret: 'secret_2', next_action: { type: 'mobile_money_prompt', network: 'mtn', expires_at: iso(31_000 + 120_000) } });
    const h = setup({
      charge: [ok(attempt())],
      resend: [ok(second)],
      status: [ok({ ...paid(), id: 'pay_2' })],
    });
    await startIt(h);
    await flush(1000);
    h.calls.status.length = 0;
    await flush(0);
    await act(async () => {
      await h.result.current.resend();
    });
    expect(h.result.current.attempt?.id).toBe('pay_2');
    expect(h.result.current.notice).toBe('New prompt sent.');
    await flush(2000);
    const call = h.calls.status[h.calls.status.length - 1] as [string, string];
    expect(call[0]).toBe('pay_2');
    expect(call[1]).toBe('secret_2');
    expect(h.result.current.phase).toBe('succeeded');
  });

  it('resend_cooldown pushes can_resend_at by Retry-After', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))], resend: [fail(429, 'resend_cooldown', { retryAfterMs: 20_000 })] });
    await startIt(h);
    await act(async () => {
      await h.result.current.resend();
    });
    expect(h.result.current.canResendAt).toBe(Date.now() + 20_000);
  });

  it('resend_limit_reached closes resending for the attempt', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))], resend: [fail(429, 'resend_limit_reached')] });
    await startIt(h);
    await act(async () => {
      await h.result.current.resend();
    });
    expect(h.result.current.resendClosed).toBe(true);
    expect(h.result.current.phase).toBe('waiting');
  });

  it('is single-flight', async () => {
    let release: (v: DirectResult<PublicAttempt>) => void = () => {};
    const slow = () => new Promise<DirectResult<PublicAttempt>>((resolve) => { release = resolve; });
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))], resend: [slow] });
    await startIt(h);
    act(() => { void h.result.current.resend(); });
    act(() => { void h.result.current.resend(); });
    expect(h.calls.resend).toHaveLength(1);
    await act(async () => {
      release(fail(409, 'attempt_pending'));
      await Promise.resolve();
    });
  });
});

describe('useDirectCharge: OTP and voucher', () => {
  const otp = attempt({
    status: 'requires_action',
    next_action: { type: 'otp', network: 'mtn', phone_masked: '024 ••• 8890', expires_at: iso(120_000) },
  });
  const voucher = attempt({
    status: 'requires_action',
    next_action: { type: 'voucher', network: 'telecel', phone_masked: '020 ••• 8890', expires_at: iso(120_000), voucher: { ussd: '*110#' } },
  });

  it('moves to the code screen and submits the type the server asked for', async () => {
    const h = setup({ charge: [ok(voucher)], action: [ok(attempt({ client_secret: undefined }))], status: [ok(paid())] });
    await startIt(h);
    expect(h.result.current.phase).toBe('code');
    expect(h.result.current.codeKind).toBe('voucher');
    await act(async () => {
      await h.result.current.submitCode('123456');
    });
    expect(h.calls.action[0]).toEqual(['pay_1', 'secret_1', { type: 'voucher', code: '123456' }, expect.anything()]);
    expect(h.result.current.phase).toBe('waiting');
    await flush(2000);
    expect(h.result.current.phase).toBe('succeeded');
  });

  it('a wrong code stays on the screen and counts down the tries', async () => {
    const h = setup({ charge: [ok(otp)], action: [fail(422, 'invalid_code', { attemptsLeft: 2 })] });
    await startIt(h);
    await act(async () => {
      await h.result.current.submitCode('000000');
    });
    expect(h.result.current.phase).toBe('code');
    expect(h.result.current.codeError).toBe('That code wasn’t accepted. 2 tries left.');
  });

  it('five wrong codes lock the attempt', async () => {
    const wrong = (left: number) => fail(422, 'invalid_code', { attemptsLeft: left });
    const h = setup({ charge: [ok(otp)], action: [wrong(4), wrong(3), wrong(2), wrong(1), fail(423, 'attempt_locked')] });
    await startIt(h);
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await h.result.current.submitCode('000000');
      });
      expect(h.result.current.phase).toBe('code');
    }
    expect(h.result.current.codeError).toBe('That code wasn’t accepted. 1 try left.');
    await act(async () => {
      await h.result.current.submitCode('000000');
    });
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.kind).toBe('locked');
    expect(h.onFailure).toHaveBeenCalledTimes(1);
  });

  it('submits one code at a time', async () => {
    let release: (v: DirectResult<PublicAttempt>) => void = () => {};
    const slow = () => new Promise<DirectResult<PublicAttempt>>((resolve) => { release = resolve; });
    const h = setup({ charge: [ok(otp)], action: [slow] });
    await startIt(h);
    act(() => { void h.result.current.submitCode('123456'); });
    act(() => { void h.result.current.submitCode('123456'); });
    expect(h.calls.action).toHaveLength(1);
    expect(h.result.current.phase).toBe('submitting');
    await act(async () => {
      release(ok(paid()));
      await Promise.resolve();
    });
    expect(h.result.current.phase).toBe('succeeded');
  });

  it('never keeps the code in state', async () => {
    const h = setup({ charge: [ok(otp)], action: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    await act(async () => {
      await h.result.current.submitCode('918273');
    });
    expect(JSON.stringify(h.result.current)).not.toContain('918273');
  });
});

describe('useDirectCharge: starting', () => {
  it('is single-flight: a double tap sends one charge', async () => {
    let release: (v: DirectResult<PublicAttempt>) => void = () => {};
    const slow = () => new Promise<DirectResult<PublicAttempt>>((resolve) => { release = resolve; });
    const h = setup({ charge: [slow] });
    act(() => { void h.result.current.start(INPUT); });
    act(() => { void h.result.current.start(INPUT); });
    expect(h.calls.charge).toHaveLength(1);
    expect(h.result.current.phase).toBe('starting');
    await act(async () => {
      release(ok(attempt()));
      await Promise.resolve();
    });
    expect(h.result.current.phase).toBe('waiting');
  });

  it('retries an unanswered charge with the same token so the server replays it', async () => {
    const lost: DirectResult<PublicAttempt> = { error: { status: 0, code: 'network_error', message: 'x', unknownOutcome: true } };
    const h = setup({ charge: [lost, ok(attempt())] });
    await startIt(h);
    expect(h.result.current.phase).toBe('idle');
    expect(h.result.current.formNotice).toMatch(/couldn’t confirm/);
    await startIt(h);
    const [first, second] = h.calls.charge.map((c) => (c[1] as { attempt_token: string }).attempt_token);
    expect(second).toBe(first);
    expect(h.result.current.phase).toBe('waiting');
  });

  it('a 409 attempt_pending from the form keeps following the earlier prompt, and a late approval still wins', async () => {
    let approved = false;
    const h = setup({
      charge: [ok(attempt()), fail(409, 'attempt_pending', { canResendAt: iso(60_000) })],
      status: [() => (approved ? ok(paid()) : ok(attempt({ client_secret: undefined })))],
    });
    await startIt(h);
    act(() => { h.result.current.useAnotherNumber(); });
    expect(h.result.current.phase).toBe('idle');
    await act(async () => {
      await h.result.current.start({ phone: '0201234567', network: 'telecel' });
    });
    expect(h.result.current.phase).toBe('idle');
    expect(h.result.current.formNotice).toBe('message for attempt_pending');
    approved = true;
    await flush(4000);
    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('shows the attempt limit as a closed door, not a retry', async () => {
    const h = setup({ charge: [fail(429, 'charge_limit_reached')] });
    await startIt(h);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.kind).toBe('exhausted');
    expect(h.result.current.failure?.retryable).toBe(false);
  });

  it('a throttled number stays on the form with the server line', async () => {
    const h = setup({ charge: [fail(429, 'phone_rate_limited')] });
    await startIt(h);
    expect(h.result.current.phase).toBe('idle');
    expect(h.result.current.formNotice).toBe('message for phone_rate_limited');
  });

  it('every route failing before a prompt went out is a provider failure with a way to retry', async () => {
    const h = setup({ charge: [fail(503, 'no_providers_available')] });
    await startIt(h);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure).toMatchObject({ kind: 'provider', retryable: true });
    expect(h.onFailure).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a session secret', async () => {
    const { api, calls } = makeApi({ charge: [ok(attempt())] });
    const h = renderHook(() => useDirectCharge({ api, provider: 'stub', onSuccess: vi.fn() }));
    await act(async () => {
      await h.result.current.start(INPUT);
    });
    expect(calls.charge).toHaveLength(0);
  });
});

describe('useDirectCharge: polling discipline', () => {
  it('backs off on errors and says so after the third', async () => {
    const down: DirectResult<PublicAttempt> = { error: { status: 0, code: 'network_error', message: 'x', unknownOutcome: true } };
    const h = setup({ charge: [ok(attempt())], status: [down] });
    await startIt(h);
    await flush(2000);
    expect(h.calls.status).toHaveLength(1);
    await flush(1999);
    expect(h.calls.status).toHaveLength(1);
    await flush(1);
    expect(h.calls.status).toHaveLength(2);
    // 2 s, then 4 s, then 8 s.
    await flush(4000);
    expect(h.calls.status).toHaveLength(3);
    expect(h.result.current.notice).toBe('Trouble reaching Reevit. Still trying…');
    await flush(7999);
    expect(h.calls.status).toHaveLength(3);
    await flush(1);
    expect(h.calls.status).toHaveLength(4);
    expect(h.result.current.phase).toBe('waiting');
  });

  it('a 404 from status is a lost payment, not a pending one', async () => {
    const h = setup({ charge: [ok(attempt())], status: [fail(404, 'payment_not_found')] });
    await startIt(h);
    await flush(2000);
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.title).toBe('Payment not found');
  });

  it('pauses while the tab is hidden and reads at once when it returns', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush(30_000);
    expect(h.calls.status).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush(0);
    expect(h.calls.status).toHaveLength(1);
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it('stops everything on unmount', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    await flush(2000);
    const n = h.calls.status.length;
    h.unmount();
    await flush(60_000);
    expect(h.calls.status).toHaveLength(n);
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it('reset aborts the request in flight and forgets the attempt', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(attempt({ client_secret: undefined }))] });
    await startIt(h);
    act(() => { h.result.current.reset(); });
    await flush(60_000);
    expect(h.calls.status).toHaveLength(0);
    expect(h.result.current.phase).toBe('idle');
    expect(h.result.current.attempt).toBeNull();
  });

  it('shows the failover line while a rerouted attempt is pending, and reports success once', async () => {
    const rerouted = attempt({ client_secret: undefined, rerouted: true });
    const h = setup({ charge: [ok(attempt())], status: [ok(rerouted), ok({ ...paid(), rerouted: true })] });
    await startIt(h);
    await flush(2000);
    expect(h.result.current.attempt?.rerouted).toBe(true);
    await flush(2000);
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onSuccess.mock.calls[0][0].rerouted).toBe(true);
  });
});
