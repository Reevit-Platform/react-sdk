/**
 * Polls a payment until it reaches a final status.
 *
 * Only `succeeded` is success. `pending`, `requires_action` and every other
 * in-flight status keep the poll going, a failed request backs off instead of
 * ending it, and the poll gives up at a real deadline.
 *
 * Phase 0 stopgap: it polls the public confirm-intent route and is replaced by
 * the status endpoint.
 */

export interface PolledPayment {
  status?: string;
}

export type PollOutcome<T extends PolledPayment = PolledPayment> =
  | { kind: 'succeeded'; data: T }
  | { kind: 'failed'; status: string; data: T }
  | { kind: 'timeout' }
  | { kind: 'aborted' };

export interface PollPaymentStatusOptions<T extends PolledPayment> {
  check: () => Promise<{ data?: T; error?: unknown }>;
  signal: AbortSignal;
  /** Wait between checks, and before the first one unless `immediate`. Default 4000. */
  intervalMs?: number;
  /** Give up after this long. Default 120000, the STK prompt's lifetime. */
  timeoutMs?: number;
  /** Longest wait after consecutive errors. Default 16000. */
  maxBackoffMs?: number;
  /** Check once straight away instead of waiting a full interval first. */
  immediate?: boolean;
}

/** A payment that will not complete on its own. */
const FAILED_STATUSES = new Set(['failed', 'canceled', 'cancelled', 'expired', 'abandoned']);

export const isPaymentFailure = (status?: string): boolean => !!status && FAILED_STATUSES.has(status.toLowerCase());

/** Resolves false when the signal aborts first. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const done = (completed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollPaymentStatus<T extends PolledPayment = PolledPayment>({
  check,
  signal,
  intervalMs = 4000,
  timeoutMs = 120_000,
  maxBackoffMs = 16_000,
  immediate = false,
}: PollPaymentStatusOptions<T>): Promise<PollOutcome<T>> {
  const deadline = Date.now() + timeoutMs;
  let failures = 0;
  let wait = immediate ? 0 : intervalMs;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: 'timeout' };

    if (wait > 0 && !(await sleep(Math.min(wait, remaining), signal))) return { kind: 'aborted' };
    if (signal.aborted) return { kind: 'aborted' };

    let result: Awaited<ReturnType<typeof check>> | undefined;
    try {
      result = await check();
    } catch {
      result = undefined;
    }
    if (signal.aborted) return { kind: 'aborted' };

    const status = result?.data?.status?.toLowerCase();
    if (result?.data && !result.error) {
      if (status === 'succeeded') return { kind: 'succeeded', data: result.data };
      if (isPaymentFailure(status)) return { kind: 'failed', status: status as string, data: result.data };
      failures = 0;
      wait = intervalMs;
    } else {
      failures += 1;
      wait = Math.min(intervalMs * 2 ** failures, maxBackoffMs);
    }
  }
}
