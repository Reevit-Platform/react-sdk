import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDirectChargeClient } from './direct';

afterEach(() => {
  vi.unstubAllGlobals();
});

function client(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => answer());
  return { api: createDirectChargeClient({ baseUrl: 'https://api.test/', fetch: fetchMock as unknown as typeof fetch }), fetchMock };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('direct charge API client', () => {
  it('charges against the session path with the attempt token as the idempotency key', async () => {
    const { api, fetchMock } = client(() => json(200, { id: 'pay_1', status: 'pending' }));
    await api.charge('cs_secret/1', { method: 'mobile_money', phone: '0244128890', network: 'mtn', attempt_token: 'a1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/v1/checkout/sessions/cs_secret%2F1/charge');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('a1');
    expect(headers['X-Reevit-Client']).toBe('@reevit/react');
    expect(JSON.parse(String(init?.body))).toEqual({ method: 'mobile_money', phone: '0244128890', network: 'mtn', attempt_token: 'a1' });
  });

  it('reads status, acts and resends with the client secret in a header, never the URL or an API key', async () => {
    const { api, fetchMock } = client(() => json(200, { id: 'pay_1', status: 'pending' }));
    await api.status('pay_1', 'pfsec_x');
    await api.action('pay_1', 'pfsec_x', { type: 'otp', code: '123456' });
    await api.resend('pay_1', 'pfsec_x');
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://api.test/v1/payments/pay_1/status',
      'https://api.test/v1/payments/pay_1/action',
      'https://api.test/v1/payments/pay_1/resend',
    ]);
    for (const [url, init] of fetchMock.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Reevit-Client-Secret']).toBe('pfsec_x');
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-reevit-key');
      expect(String(url)).not.toContain('pfsec_x');
    }
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('reads the 409 attempt_pending body, whose code key is `error`, and Retry-After', async () => {
    const { api } = client(() =>
      json(409, { error: 'attempt_pending', message: 'still active', can_resend_at: '2026-10-23T12:00:45Z' }, { 'Retry-After': '45' }),
    );
    const result = await api.resend('pay_1', 's');
    expect(result.error).toMatchObject({
      status: 409,
      code: 'attempt_pending',
      message: 'still active',
      canResendAt: '2026-10-23T12:00:45Z',
      retryAfterMs: 45_000,
      unknownOutcome: false,
    });
  });

  it('reads attempts_left from a 422 invalid_code', async () => {
    const { api } = client(() => json(422, { error: 'invalid_code', message: 'm', attempts_left: 3 }));
    const result = await api.action('pay_1', 's', { type: 'otp', code: '000000' });
    expect(result.error).toMatchObject({ status: 422, code: 'invalid_code', attemptsLeft: 3 });
  });

  it('a network failure is an unknown outcome, not a decline', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createDirectChargeClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await api.status('pay_1', 's');
    expect(result.error).toMatchObject({ status: 0, code: 'network_error', unknownOutcome: true });
  });

  it('an aborted request reports aborted, not a timeout', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const api = createDirectChargeClient({ fetch: fetchMock as unknown as typeof fetch });
    const pending = api.status('pay_1', 's', { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.error?.code).toBe('aborted');
  });

  it('a request that outlives its time limit is an unknown outcome', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const api = createDirectChargeClient({ fetch: fetchMock as unknown as typeof fetch });
    const pending = api.status('pay_1', 's');
    await vi.advanceTimersByTimeAsync(16_000);
    expect((await pending).error).toMatchObject({ code: 'request_timeout', unknownOutcome: true });
    vi.useRealTimers();
  });

  it('a 503 provider_busy is a clear answer, a 500 is not', async () => {
    const busy = await client(() => json(503, { error: 'provider_busy', message: 'busy' }, { 'Retry-After': '15' })).api.resend('p', 's');
    expect(busy.error).toMatchObject({ unknownOutcome: false, retryAfterMs: 15_000 });
    const boom = await client(() => json(500, { message: 'x' })).api.resend('p', 's');
    expect(boom.error?.unknownOutcome).toBe(true);
  });

  it('charges a bank transfer with no phone, and "I\u2019ve sent it" is status?check=1 with the secret still in a header', async () => {
    const { api, fetchMock } = client(() => json(200, { id: 'pay_1', status: 'requires_action' }));
    await api.charge('cs_1', { method: 'bank_transfer', provider: 'paystack', attempt_token: 'b1' });
    await api.status('pay_1', 'pfsec_x', { check: true });
    await api.status('pay_1', 'pfsec_x');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ method: 'bank_transfer', provider: 'paystack', attempt_token: 'b1' });
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.test/v1/payments/pay_1/status?check=1');
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://api.test/v1/payments/pay_1/status');
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['X-Reevit-Client-Secret']).toBe('pfsec_x');
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('pfsec_x');
  });
});
