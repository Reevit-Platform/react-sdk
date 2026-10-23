import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isDefinitiveFailure, isPaymentFailure, pollPaymentStatus } from './pollPaymentStatus';

describe('pollPaymentStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => vi.useRealTimers());

  const answers = (...list: Array<{ data?: { status?: string }; error?: unknown }>) => {
    const check = vi.fn(async () => list[Math.min(check.mock.calls.length - 1, list.length - 1)]);
    return check;
  };

  it('waits one interval before the first check, then stops on succeeded', async () => {
    const check = answers({ data: { status: 'pending' } }, { data: { status: 'succeeded' } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal });

    await vi.advanceTimersByTimeAsync(3999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);

    expect(await outcome).toMatchObject({ kind: 'succeeded' });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('can check straight away', async () => {
    const check = answers({ data: { status: 'succeeded' } });
    expect(await pollPaymentStatus({ check, signal: new AbortController().signal, immediate: true })).toMatchObject({ kind: 'succeeded' });
  });

  it.each(['failed', 'canceled', 'cancelled', 'expired', 'abandoned'])('stops on %s', async (status) => {
    const check = answers({ data: { status } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await outcome).toMatchObject({ kind: 'failed', status });
  });

  it.each(['pending', 'requires_action', 'processing', 'authorized', undefined])('never ends on %s', async (status) => {
    const check = answers({ data: { status } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal, timeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await outcome).toEqual({ kind: 'timeout' });
  });

  it('backs off on errors up to the cap, and recovers', async () => {
    const check = answers({ error: { code: 'x' } }, { error: { code: 'x' } }, { error: { code: 'x' } }, { error: { code: 'x' } }, { data: { status: 'succeeded' } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal });

    await vi.advanceTimersByTimeAsync(4000); // 1st check
    await vi.advanceTimersByTimeAsync(8000); // 2nd, after 4 s * 2
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16_000); // 3rd, after 4 s * 4 = 16 s
    expect(check).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(16_000); // 4th, capped at 16 s
    expect(check).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(await outcome).toMatchObject({ kind: 'succeeded' });
  });

  it('treats a throwing check like an error', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: { status: 'succeeded' } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(4000 + 8000);
    expect(await outcome).toMatchObject({ kind: 'succeeded' });
  });

  it('gives up at the deadline', async () => {
    const check = answers({ data: { status: 'pending' } });
    const outcome = pollPaymentStatus({ check, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await outcome).toEqual({ kind: 'timeout' });
    const calls = check.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check.mock.calls.length).toBe(calls);
  });

  it('stops without another check when aborted, even mid-wait', async () => {
    const check = answers({ data: { status: 'pending' } });
    const controller = new AbortController();
    const outcome = pollPaymentStatus({ check, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(4000);
    controller.abort();
    expect(await outcome).toEqual({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('ignores an answer that arrives after an abort', async () => {
    let release!: (value: { data: { status: string } }) => void;
    const check = vi.fn(() => new Promise<{ data: { status: string } }>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const outcome = pollPaymentStatus({ check, signal: controller.signal, immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    release({ data: { status: 'succeeded' } });
    expect(await outcome).toEqual({ kind: 'aborted' });
  });
});

describe('isPaymentFailure', () => {
  it('is true only for statuses that will not complete', () => {
    expect(isPaymentFailure('failed')).toBe(true);
    expect(isPaymentFailure('FAILED')).toBe(true);
    expect(isPaymentFailure('pending')).toBe(false);
    expect(isPaymentFailure('succeeded')).toBe(false);
    expect(isPaymentFailure(undefined)).toBe(false);
  });
});

describe('isDefinitiveFailure', () => {
  const err = (httpStatus?: number) => ({ code: 'x', message: 'y', details: { httpStatus } });

  it('is true for a backend 4xx that speaks about the payment', () => {
    expect(isDefinitiveFailure(err(402))).toBe(true);
    expect(isDefinitiveFailure(err(400))).toBe(true);
    expect(isDefinitiveFailure(err(422))).toBe(true);
  });

  it.each([401, 403, 404, 408, 409, 425, 429, 500, 502, 503, undefined])('is false for %s', (status) => {
    expect(isDefinitiveFailure(err(status))).toBe(false);
  });

  it('is false for a transport error with no status', () => {
    expect(isDefinitiveFailure({ code: 'network_error', message: 'offline' })).toBe(false);
    expect(isDefinitiveFailure(undefined)).toBe(false);
  });
});
