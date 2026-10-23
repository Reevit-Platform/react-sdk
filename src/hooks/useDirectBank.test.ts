import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirectApiError, DirectChargeApi, DirectResult, PublicAttempt } from '../api/direct';
import { useDirectBank } from './useDirectBank';

const T0 = Date.parse('2026-10-23T12:00:00Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const BANK = { bank: 'Wema Bank', account_number: '7820194552', account_name: 'Reevit / Kente & Co.', amount: 75500, expires_at: iso(600_000) };

function attempt(over: Partial<PublicAttempt> = {}): PublicAttempt {
  return {
    id: 'pay_bank_1',
    status: 'requires_action',
    amount: 75500,
    currency: 'GHS',
    method: 'bank_transfer',
    provider_display: 'Test provider',
    client_secret: 'secret_1',
    next_action: { type: 'bank_transfer', expires_at: BANK.expires_at, bank: BANK, attempt: { n: 1, max: 3 } },
    rerouted: false,
    poll_after_ms: 5000,
    ...over,
  };
}

const ok = (data: PublicAttempt): DirectResult<PublicAttempt> => ({ data });
const fail = (status: number, code: string, extra: Partial<DirectApiError> = {}): DirectResult<PublicAttempt> => ({
  error: { status, code, message: `message for ${code}`, unknownOutcome: false, ...extra },
});
const live = (): PublicAttempt => attempt({ client_secret: undefined });
const paid = (): PublicAttempt => attempt({ status: 'succeeded', next_action: undefined, poll_after_ms: 0, client_secret: undefined });
const expired = (): PublicAttempt =>
  attempt({ status: 'expired', next_action: undefined, poll_after_ms: 0, client_secret: undefined, failure: { code: 'expired', category: 'timeout', retryable: true, message: 'x' } });

type Script = DirectResult<PublicAttempt> | (() => DirectResult<PublicAttempt> | Promise<DirectResult<PublicAttempt>>);

function makeApi(scripts: Partial<Record<'charge' | 'status', Script[]>>) {
  const queues = { charge: [...(scripts.charge ?? [])], status: [...(scripts.status ?? [])] };
  const calls = { charge: [] as unknown[][], status: [] as unknown[][] };
  const next = (name: 'charge' | 'status', args: unknown[]) => {
    calls[name].push(args);
    const q = queues[name];
    const item = q.length > 1 ? q.shift()! : q[0];
    if (!item) throw new Error(`no script for ${name}`);
    return Promise.resolve(typeof item === 'function' ? item() : item);
  };
  const api: DirectChargeApi = {
    charge: (...args) => next('charge', args),
    status: (...args) => next('status', args),
    action: () => Promise.reject(new Error('bank transfer has no action')),
    resend: () => Promise.reject(new Error('bank transfer has no resend')),
  };
  return { api, calls };
}

function setup(scripts: Parameters<typeof makeApi>[0]) {
  const { api, calls } = makeApi(scripts);
  const onSuccess = vi.fn();
  const onFailure = vi.fn();
  const hook = renderHook(() =>
    useDirectBank({ api, sessionSecret: 'cs_1', provider: 'stub', onSuccess, onFailure, now: () => Date.now(), minConfirmMs: 0 }),
  );
  return { ...hook, calls, onSuccess, onFailure };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function run(h: ReturnType<typeof setup>, action: 'start' | 'sent' | 'newDetails') {
  await act(async () => {
    await h.result.current[action]();
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

describe('useDirectBank', () => {
  it('asks for an account with no phone and shows the details with their expiry', async () => {
    const h = setup({ charge: [ok(attempt())] });
    await run(h, 'start');

    expect(h.result.current.phase).toBe('details');
    expect(h.result.current.details).toEqual(BANK);
    expect(h.result.current.expiresAt).toBe(T0 + 600_000);

    const body = h.calls.charge[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({ method: 'bank_transfer', provider: 'stub' });
    expect(body.attempt_token).toMatch(/^b[0-9a-f]+$/);
    expect(body).not.toHaveProperty('phone');
  });

  it('polls at the server pace and ends only on succeeded', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(live()), ok(paid())] });
    await run(h, 'start');

    await flush(4999);
    expect(h.calls.status).toHaveLength(0);
    await flush(1);
    expect(h.calls.status).toHaveLength(1);
    expect(h.result.current.phase).toBe('details');
    expect(h.onSuccess).not.toHaveBeenCalled();

    await flush(5000);
    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onSuccess.mock.calls[0][1]).toEqual(BANK);
  });

  it('"I\'ve sent it" is a forced status read, never a shortcut to success', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(live())] });
    await run(h, 'start');

    await run(h, 'sent');
    expect(h.calls.status).toHaveLength(1);
    expect(h.calls.status[0][2]).toMatchObject({ check: true });
    expect(h.result.current.phase).toBe('notSeen');
    expect(h.result.current.checks).toBe(1);
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it('a check that finds the transfer succeeds', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(paid())] });
    await run(h, 'start');
    await run(h, 'sent');

    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('"Check again" asks again and "Keep waiting" returns to the details', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(live()), ok(live()), ok(paid())] });
    await run(h, 'start');
    await run(h, 'sent');
    expect(h.result.current.phase).toBe('notSeen');

    await run(h, 'sent');
    expect(h.result.current.phase).toBe('notSeen');
    expect(h.result.current.checks).toBe(2);
    expect(h.calls.status.filter((c) => (c[2] as { check?: boolean }).check)).toHaveLength(2);

    act(() => h.result.current.keepWaiting());
    expect(h.result.current.phase).toBe('details');
    expect(h.result.current.expiresAt).toBe(T0 + 600_000);

    await run(h, 'sent');
    expect(h.result.current.phase).toBe('succeeded');
  });

  it('a check that cannot reach Reevit goes back with a line, not to "not seen"', async () => {
    const h = setup({ charge: [ok(attempt())], status: [fail(0, 'network_error', { unknownOutcome: true })] });
    await run(h, 'start');
    await run(h, 'sent');

    expect(h.result.current.phase).toBe('details');
    expect(h.result.current.notice).toMatch(/reach Reevit/);
  });

  it('running out the clock takes one last forced read, then asks for new details', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(live())] });
    await run(h, 'start');

    await flush(600_000 - 1);
    expect(h.result.current.phase).toBe('details');

    const before = h.calls.status.length;
    await flush(1_001);
    expect(h.result.current.phase).toBe('expired');
    const last = h.calls.status[h.calls.status.length - 1];
    expect(h.calls.status.length).toBeGreaterThan(before);
    expect(last[2]).toMatchObject({ check: true });
  });

  it('a transfer that lands in the final seconds still succeeds', async () => {
    // Routine polls say "live"; only a forced read after the expiry finds the money.
    const { api } = makeApi({ charge: [ok(attempt())] });
    const status = vi.fn(async (_id: string, _secret: string, opts?: { check?: boolean }) =>
      opts?.check && Date.now() >= T0 + 600_000 ? ok(paid()) : ok(live()),
    );
    const onSuccess = vi.fn();
    const hook = renderHook(() =>
      useDirectBank({ api: { ...api, status }, sessionSecret: 'cs_1', provider: 'stub', onSuccess, now: () => Date.now(), minConfirmMs: 0 }),
    );
    await act(async () => {
      await hook.result.current.start();
    });

    await flush(600_000 + 1_001);
    expect(hook.result.current.phase).toBe('succeeded');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('the server closing the attempt as expired ends on the expired screen', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(expired())] });
    await run(h, 'start');
    await flush(5000);

    expect(h.result.current.phase).toBe('expired');
    expect(h.onFailure).not.toHaveBeenCalled();
  });

  it('"Get new details" reads once more, then opens a new account with a fresh token', async () => {
    const second = attempt({ id: 'pay_bank_2', client_secret: 'secret_2' });
    const h = setup({ charge: [ok(attempt()), ok(second)], status: [ok(expired())] });
    await run(h, 'start');
    await flush(5000);
    expect(h.result.current.phase).toBe('expired');

    await run(h, 'newDetails');
    expect(h.calls.charge).toHaveLength(2);
    expect((h.calls.charge[0][1] as { attempt_token: string }).attempt_token).not.toBe(
      (h.calls.charge[1][1] as { attempt_token: string }).attempt_token,
    );
    expect(h.result.current.phase).toBe('details');
    expect(h.result.current.attempt?.id).toBe('pay_bank_2');
    expect(h.result.current.checks).toBe(0);
  });

  it('"Get new details" refused with 409 keeps the expired screen and says when to try again', async () => {
    const canResendAt = iso(30_000);
    const h = setup({
      charge: [ok(attempt()), fail(409, 'attempt_pending', { canResendAt, message: 'Your earlier payment is still active.' })],
      status: [ok(expired())],
    });
    await run(h, 'start');
    await flush(5000);

    await run(h, 'newDetails');
    expect(h.result.current.phase).toBe('expired');
    expect(h.result.current.notice).toBe('Your earlier payment is still active.');
    expect(h.result.current.retryAt).toBe(T0 + 30_000);
    expect(h.result.current.busy).toBe(false);
    expect(h.onFailure).not.toHaveBeenCalled();
  });

  it('a late success found when asking for new details wins: no second account', async () => {
    const { api, calls } = makeApi({ charge: [ok(attempt())] });
    let forced = 0;
    const status = vi.fn(async (_id: string, _secret: string, opts?: { check?: boolean }) => {
      if (!opts?.check) return ok(live());
      forced += 1;
      // The read at the expiry sees nothing; the transfer lands before "Get new details" reads again.
      return forced === 1 ? ok(live()) : ok(paid());
    });
    const onSuccess = vi.fn();
    const hook = renderHook(() =>
      useDirectBank({ api: { ...api, status }, sessionSecret: 'cs_1', provider: 'stub', onSuccess, now: () => Date.now(), minConfirmMs: 0 }),
    );
    await act(async () => {
      await hook.result.current.start();
    });
    await flush(600_000 + 1_001);
    expect(hook.result.current.phase).toBe('expired');

    await act(async () => {
      await hook.result.current.newDetails();
    });
    expect(hook.result.current.phase).toBe('succeeded');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(calls.charge).toHaveLength(1);
  });

  it('reuses the token when a charge got no answer, so the server replays one account', async () => {
    const h = setup({ charge: [fail(0, 'network_error', { unknownOutcome: true }), ok(attempt())] });
    await run(h, 'start');
    expect(h.result.current.phase).toBe('failed');

    await run(h, 'start');
    expect((h.calls.charge[0][1] as { attempt_token: string }).attempt_token).toBe(
      (h.calls.charge[1][1] as { attempt_token: string }).attempt_token,
    );
    expect(h.result.current.phase).toBe('details');
  });

  it('an earlier live account at the very first request reads as a failure the payer can retry', async () => {
    const h = setup({ charge: [fail(409, 'attempt_pending', { message: 'Your earlier payment is still active.' })] });
    await run(h, 'start');
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.retryable).toBe(true);
  });

  it('refuses to become a redirect or a card: a hosted answer is a failure to choose another method', async () => {
    const h = setup({ charge: [ok(attempt({ next_action: { type: 'redirect', redirect_url: 'https://x.test' } }))] });
    await run(h, 'start');
    expect(h.result.current.phase).toBe('failed');
    expect(h.result.current.failure?.code).toBe('redirect_not_supported');
  });

  it('a server that answers succeeded at once ends in success', async () => {
    const h = setup({ charge: [ok(attempt({ status: 'succeeded', next_action: undefined, poll_after_ms: 0 }))] });
    await run(h, 'start');
    expect(h.result.current.phase).toBe('succeeded');
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('stops polling when it unmounts', async () => {
    const h = setup({ charge: [ok(attempt())], status: [ok(live())] });
    await run(h, 'start');
    h.unmount();
    await flush(60_000);
    expect(h.calls.status).toHaveLength(0);
  });
});
