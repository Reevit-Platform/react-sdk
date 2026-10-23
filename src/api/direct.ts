/**
 * Direct charge API
 *
 * The public, key-less routes behind Reevit's own mobile money screens:
 *
 *   POST /v1/checkout/sessions/{session_secret}/charge   start a prompt
 *   GET  /v1/payments/{id}/status                        read the attempt (?check=1: ask the provider now)
 *   POST /v1/payments/{id}/action                        submit an OTP or voucher
 *   POST /v1/payments/{id}/resend                        a fresh prompt
 *
 * The session secret authorises `charge`; every other call carries the attempt's
 * own `client_secret` in the `X-Reevit-Client-Secret` header, never in the URL.
 * Responses are the public attempt view: no credentials, fees or full phone.
 */

import { SDK_VERSION } from '../version';

export type AttemptStatus =
  | 'pending'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'abandoned'
  | (string & {});

export type NextActionType = 'mobile_money_prompt' | 'otp' | 'voucher' | 'bank_transfer' | 'redirect' | (string & {});

export interface AttemptNextAction {
  type: NextActionType;
  network?: string;
  /** `024 ••• 8890` */
  phone_masked?: string;
  /** RFC 3339 */
  expires_at?: string;
  redirect_url?: string;
  attempt?: { n: number; max: number };
  /** RFC 3339. When the payer may ask for another prompt. Absent when the provider cannot. */
  can_resend_at?: string;
  voucher?: { ussd?: string; hint?: string };
  bank?: BankDetails;
}

/** The account a payer sends a bank transfer to. `account_name` is absent when the provider returns none. */
export interface BankDetails {
  bank: string;
  account_number: string;
  account_name?: string;
  /** Minor units: what the payer must send. */
  amount: number;
  /** RFC 3339 */
  expires_at?: string;
  reference?: string;
  note?: string;
}

export type FailureCategory =
  | 'declined'
  | 'insufficient_funds'
  | 'not_approved'
  | 'timeout'
  | 'provider_fault'
  | 'invalid'
  | (string & {});

export interface AttemptFailure {
  code: string;
  category: FailureCategory;
  retryable: boolean;
  /** Customer-safe wording from the server. */
  message: string;
}

export interface PublicAttempt {
  id: string;
  status: AttemptStatus;
  amount: number;
  currency: string;
  method?: string;
  provider_display?: string;
  /** Only on the response that creates the attempt. */
  client_secret?: string;
  next_action?: AttemptNextAction;
  failure?: AttemptFailure;
  rerouted: boolean;
  receipt_url?: string;
  /** Server advice on when to ask again; 0 once the attempt is final. */
  poll_after_ms: number;
}

export interface ChargeRequest {
  method: 'mobile_money' | 'bank_transfer';
  provider?: string;
  /** Mobile money only: a bank transfer asks the payer for nothing. */
  phone?: string;
  network?: string;
  /** Names one user action: repeating it replays that attempt and spends no budget. */
  attempt_token: string;
}

/** An API failure, with the fields the direct flow acts on. */
export interface DirectApiError {
  /** HTTP status; 0 when the request never got an answer. */
  status: number;
  code: string;
  message: string;
  /** True for network failures and timeouts: the server may or may not have acted. */
  unknownOutcome: boolean;
  /** `409 attempt_pending`: when the earlier prompt stops being live (RFC 3339). */
  canResendAt?: string;
  /** From `Retry-After`, in ms. */
  retryAfterMs?: number;
  /** `422 invalid_code`. */
  attemptsLeft?: number;
}

export type DirectResult<T> = { data: T; error?: undefined } | { data?: undefined; error: DirectApiError };

/** The slice of the API the direct flow uses. Tests substitute this. */
export interface DirectChargeApi {
  charge(sessionSecret: string, body: ChargeRequest, opts?: { signal?: AbortSignal }): Promise<DirectResult<PublicAttempt>>;
  status(
    paymentId: string,
    clientSecret: string,
    opts?: { signal?: AbortSignal; /** "I've sent it": the server asks the provider now (still rate limited). */ check?: boolean },
  ): Promise<DirectResult<PublicAttempt>>;
  action(
    paymentId: string,
    clientSecret: string,
    body: { type: string; code: string },
    opts?: { signal?: AbortSignal },
  ): Promise<DirectResult<PublicAttempt>>;
  resend(paymentId: string, clientSecret: string, opts?: { signal?: AbortSignal }): Promise<DirectResult<PublicAttempt>>;
}

export const CLIENT_SECRET_HEADER = 'X-Reevit-Client-Secret';

const DEFAULT_BASE_URL = 'https://api.reevit.io';
/** Read calls. A charge can wait on the provider for about a minute, so it gets longer. */
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 75_000;

export interface DirectChargeClientConfig {
  baseUrl?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function createDirectChargeClient(config: DirectChargeClientConfig = {}): DirectChargeApi {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');

  async function send<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; clientSecret?: string; idempotencyKey?: string; signal?: AbortSignal; timeoutMs: number },
  ): Promise<DirectResult<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, init.timeoutMs);
    const forward = () => controller.abort();
    if (init.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', forward, { once: true });
    }

    const headers: Record<string, string> = {
      'X-Reevit-Client': '@reevit/react',
      'X-Reevit-Client-Version': SDK_VERSION,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.clientSecret) headers[CLIENT_SECRET_HEADER] = init.clientSecret;
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

    try {
      const response = await (config.fetch ?? fetch)(`${baseUrl}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const code = String(payload.code || payload.error || `http_${response.status}`);
        const error: DirectApiError = {
          status: response.status,
          code,
          message: String(payload.message || 'Something went wrong. Please try again.'),
          // A 5xx after the request left the browser says nothing about what the provider did.
          unknownOutcome: response.status >= 500 && response.status !== 503,
        };
        if (typeof payload.can_resend_at === 'string') error.canResendAt = payload.can_resend_at;
        if (typeof payload.attempts_left === 'number') error.attemptsLeft = payload.attempts_left;
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        if (retryAfter !== undefined) error.retryAfterMs = retryAfter;
        return { error };
      }

      return { data: payload as unknown as T };
    } catch (err) {
      if (init.signal?.aborted && !timedOut) {
        return { error: { status: 0, code: 'aborted', message: 'The request was cancelled.', unknownOutcome: true } };
      }
      if (timedOut) {
        return { error: { status: 0, code: 'request_timeout', message: 'The request timed out.', unknownOutcome: true } };
      }
      void err;
      return {
        error: {
          status: 0,
          code: 'network_error',
          message: 'Unable to reach Reevit. Check your connection.',
          unknownOutcome: true,
        },
      };
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', forward);
    }
  }

  const paymentPath = (id: string, tail: string) => `/v1/payments/${encodeURIComponent(id)}/${tail}`;

  return {
    charge: (sessionSecret, body, opts) =>
      send<PublicAttempt>('POST', `/v1/checkout/sessions/${encodeURIComponent(sessionSecret)}/charge`, {
        body,
        idempotencyKey: body.attempt_token,
        signal: opts?.signal,
        timeoutMs: WRITE_TIMEOUT_MS,
      }),
    status: (paymentId, clientSecret, opts) =>
      send<PublicAttempt>('GET', paymentPath(paymentId, 'status') + (opts?.check ? '?check=1' : ''), {
        clientSecret,
        signal: opts?.signal,
        timeoutMs: READ_TIMEOUT_MS,
      }),
    action: (paymentId, clientSecret, body, opts) =>
      send<PublicAttempt>('POST', paymentPath(paymentId, 'action'), {
        body,
        clientSecret,
        signal: opts?.signal,
        timeoutMs: READ_TIMEOUT_MS,
      }),
    resend: (paymentId, clientSecret, opts) =>
      send<PublicAttempt>('POST', paymentPath(paymentId, 'resend'), {
        // An empty JSON body: the route reads none, and a stable key per click is not needed.
        body: {},
        clientSecret,
        signal: opts?.signal,
        timeoutMs: WRITE_TIMEOUT_MS,
      }),
  };
}
