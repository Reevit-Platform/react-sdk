import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReevitCheckout } from './ReevitCheckout';

const NUMBER = '712345678';
const E164 = '254712345678';

function intent(id: string, status = 'pending') {
  return {
    id,
    org_id: 'org_1',
    connection_id: 'conn_mpesa',
    provider: 'mpesa',
    method: 'mobile_money',
    status,
    client_secret: `secret_${id}`,
    psp_public_key: '',
    amount: 75500,
    currency: 'KES',
    fee_amount: 0,
    fee_currency: 'KES',
    net_amount: 75500,
    available_psps: [{ provider: 'mpesa', name: 'M-Pesa', methods: ['mobile_money'] }],
  };
}

type Call = { url: string; method: string; body: Record<string, unknown> };

/**
 * A fake backend. `confirm` decides what each confirm-intent poll answers; the
 * default is that the payment stays pending.
 */
function fakeBackend(confirm: (paymentId: string, poll: number) => { status: number; body: unknown } = () => ({ status: 200, body: { status: 'pending' } })) {
  const calls: Call[] = [];
  const polls = new Map<string, number>();
  let selects = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });

    if (url.includes('/confirm-intent')) {
      const id = /payments\/([^/]+)\/confirm-intent/.exec(url)![1];
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      const answer = confirm(id, n);
      return json(answer.status, answer.body);
    }
    if (url.endsWith('/select')) {
      selects += 1;
      return json(200, { payment_intent: intent(`pay_mpesa_${selects}`) });
    }
    if (url.includes('/v1/checkout/sessions/')) {
      return json(200, { id: 'sess', client_secret: 'x', session_secret: 'cs_unused', payment_intent: intent('pay_original') });
    }
    if (url.endsWith('/v1/payments/intents')) {
      return json(201, intent('pay_mpesa_intent'));
    }
    return json(404, { message: 'not found' });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, polls, fetchMock, confirmCalls: () => calls.filter((c) => c.url.includes('/confirm-intent')) };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function payWithMpesa() {
  await flush();
  fireEvent.change(screen.getByLabelText('M-Pesa number'), { target: { value: NUMBER } });
  fireEvent.click(screen.getByRole('button', { name: 'Pay KES 755.00' }));
  await flush();
}

// @reevit/core caches intents per session/reference for ten minutes, so every test gets its own.
let seq = 0;
const sessionProps = () => ({ isOpen: true, sessionSecret: `cs_mpesa_${++seq}`, paymentMethods: ['mobile_money' as const], successDelayMs: 0 });
const intentProps = () => ({ isOpen: true, publicKey: 'pfk_test', amount: 75500, currency: 'KES', reference: `order_${++seq}`, paymentMethods: ['mobile_money' as const], successDelayMs: 0 });

describe('M-Pesa completes in the checkout', () => {
  let props: ReturnType<typeof sessionProps>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the number with the session selection and never calls the /mpesa route', async () => {
    const backend = fakeBackend();
    render(<ReevitCheckout {...(props = sessionProps())} />);
    await payWithMpesa();

    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    const select = backend.calls.find((c) => c.url.endsWith('/select'));
    expect(select?.body).toEqual({ method: 'mobile_money', provider: 'mpesa', phone: E164 });
    expect(backend.calls.some((c) => /\/mpesa(\?|$)/.test(c.url))).toBe(false);
    for (const call of backend.fetchMock.mock.calls) {
      const headers = (call[1]?.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-reevit-public-key');
    }
    // The number never rides in a URL or in the idempotency key.
    for (const call of backend.fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain(E164);
      expect(JSON.stringify(call[1]?.headers ?? {})).not.toContain(E164);
    }
  });

  it('sends the number when the intent is created (public-key mode)', async () => {
    const backend = fakeBackend();
    render(<ReevitCheckout {...intentProps()} />);
    await payWithMpesa();

    const intents = backend.calls.filter((c) => c.url.endsWith('/v1/payments/intents'));
    expect(intents.length).toBeGreaterThan(0);
    const mine = intents[intents.length - 1];
    expect((mine.body.metadata as Record<string, unknown>).customer_phone).toBe(E164);
    expect(backend.calls.some((c) => /\/mpesa(\?|$)/.test(c.url))).toBe(false);
  });

  it('keeps waiting while the payment is pending and never reports success', async () => {
    const backend = fakeBackend();
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...(props = sessionProps())} onSuccess={onSuccess} />);
    await payWithMpesa();

    await advance(4000);
    await advance(4000);
    await advance(4000);

    expect(backend.confirmCalls().length).toBe(3);
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    expect(document.querySelector('[data-reevit="receipt"]')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('ends on succeeded with the receipt and delivers onSuccess once', async () => {
    fakeBackend((_id, poll) => ({ status: 200, body: { id: 'pay_mpesa_1', status: poll >= 3 ? 'succeeded' : 'pending', provider_ref_id: 'ws_CO_1' } }));
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...(props = sessionProps())} onSuccess={onSuccess} />);
    await payWithMpesa();

    await advance(4000);
    await advance(4000);
    expect(onSuccess).not.toHaveBeenCalled();
    await advance(4000);
    await flush();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ paymentId: 'pay_mpesa_1', status: 'success', pspReference: 'ws_CO_1' });
  });

  it('ends on a failed payment with the failure panel and Try again sends a fresh prompt', async () => {
    const backend = fakeBackend((id) => ({ status: 200, body: { id, status: id === 'pay_mpesa_1' ? 'failed' : 'pending' } }));
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<ReevitCheckout {...(props = sessionProps())} onSuccess={onSuccess} onError={onError} />);
    await payWithMpesa();

    await advance(4000);

    const failure = document.querySelector('[data-reevit="failure"]');
    expect(failure?.textContent).toContain('Payment not approved');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_DECLINED' }));

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();

    const selects = backend.calls.filter((c) => c.url.endsWith('/select'));
    expect(selects).toHaveLength(2);
    expect(selects[1].body).toEqual({ method: 'mobile_money', provider: 'mpesa', phone: E164, attempt: 1 });
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
  });

  it('treats a cancelled or expired payment as a terminal failure', async () => {
    fakeBackend(() => ({ status: 200, body: { status: 'expired' } }));
    render(<ReevitCheckout {...(props = sessionProps())} />);
    await payWithMpesa();
    await advance(4000);
    expect(document.querySelector('[data-reevit="failure"]')).not.toBeNull();
  });

  it('gives up at the timeout with the timeout wording and never reports success', async () => {
    const backend = fakeBackend();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<ReevitCheckout {...(props = sessionProps())} onSuccess={onSuccess} onError={onError} />);
    await payWithMpesa();

    await advance(119_000);
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    await advance(2_000);

    const failure = document.querySelector('[data-reevit="failure"]');
    expect(failure?.textContent).toContain('No response in time');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_TIMEOUT' }));

    const polled = backend.confirmCalls().length;
    await advance(60_000);
    expect(backend.confirmCalls().length).toBe(polled);
  });

  it('backs off after errors and still finishes when the backend recovers', async () => {
    const backend = fakeBackend((_id, poll) =>
      poll <= 3 ? { status: 503, body: { message: 'down' } } : { status: 200, body: { status: 'succeeded' } });
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...(props = sessionProps())} onSuccess={onSuccess} />);
    await payWithMpesa();

    await advance(4000); // poll 1 -> error, next wait 8 s
    expect(backend.confirmCalls().length).toBe(1);
    await advance(7000);
    expect(backend.confirmCalls().length).toBe(1);
    await advance(1000); // poll 2 -> error, next wait 16 s
    expect(backend.confirmCalls().length).toBe(2);
    await advance(16_000); // poll 3 -> error, still 16 s (capped)
    expect(backend.confirmCalls().length).toBe(3);
    await advance(16_000); // poll 4 -> succeeded
    await flush();
    expect(backend.confirmCalls().length).toBeGreaterThanOrEqual(4);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the checkout is closed', async () => {
    const backend = fakeBackend();
    const view = render(<ReevitCheckout {...(props = sessionProps())} />);
    await payWithMpesa();
    await advance(4000);
    expect(backend.confirmCalls().length).toBe(1);

    view.rerender(<ReevitCheckout {...(props = sessionProps())} isOpen={false} />);
    await advance(30_000);
    expect(backend.confirmCalls().length).toBe(1);
  });

  it('stops polling when the component unmounts', async () => {
    const backend = fakeBackend();
    const view = render(<ReevitCheckout {...(props = sessionProps())} />);
    await payWithMpesa();
    await advance(4000);
    view.unmount();
    await advance(30_000);
    expect(backend.confirmCalls().length).toBe(1);
  });
});
