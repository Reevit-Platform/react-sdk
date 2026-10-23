import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReevitCheckout } from './ReevitCheckout';

const T0 = Date.parse('2026-10-23T12:00:00Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const BANK = { bank: 'Wema Bank', account_number: '7820194552', account_name: 'Reevit / Kente & Co.', amount: 75500, expires_at: iso(600_000) };

const OPTIONS = [
  { method: 'bank_transfer', flow: 'direct', networks: [], needs: [] },
  { method: 'card', flow: 'hosted', networks: [], needs: [] },
];

function sessionIntent(options: unknown[] = OPTIONS) {
  return {
    id: 'pay_original',
    org_id: 'org_1',
    connection_id: 'conn_stub',
    provider: 'stub',
    status: 'pending',
    client_secret: 'secret_original',
    amount: 75500,
    currency: 'GHS',
    fee_amount: 0,
    fee_currency: 'GHS',
    net_amount: 75500,
    available_psps: [{ provider: 'stub', name: 'Test provider', methods: ['bank_transfer', 'card'], method_options: options }],
  };
}

function bankView(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: 'requires_action',
    amount: 75500,
    currency: 'GHS',
    method: 'bank_transfer',
    provider_display: 'Test provider',
    next_action: { type: 'bank_transfer', expires_at: BANK.expires_at, bank: BANK, attempt: { n: 1, max: 3 } },
    rerouted: false,
    poll_after_ms: 5000,
    ...over,
  };
}
const paidView = (id: string) => bankView(id, { status: 'succeeded', next_action: undefined, poll_after_ms: 0 });
const expiredView = (id: string) =>
  bankView(id, { status: 'expired', next_action: undefined, poll_after_ms: 0, failure: { code: 'expired', category: 'timeout', retryable: true, message: 'x' } });

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
interface Call { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }

function fakeBackend(spec: {
  charge?: (n: number) => Reply;
  status?: (id: string, n: number, check: boolean) => Reply;
  options?: unknown[];
} = {}) {
  const calls: Call[] = [];
  let charges = 0;
  const statusCounts = new Map<string, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });

    if (url.endsWith('/charge')) {
      charges += 1;
      return json(spec.charge?.(charges) ?? { status: 200, body: { ...bankView('pay_bank_1'), client_secret: 'secret_1' } });
    }
    const m = /payments\/([^/?]+)\/status(\?check=1)?$/.exec(url);
    if (m) {
      const n = (statusCounts.get(m[1]) ?? 0) + 1;
      statusCounts.set(m[1], n);
      return json(spec.status?.(m[1], n, !!m[2]) ?? { status: 200, body: bankView(m[1]) });
    }
    if (url.includes('/v1/checkout/sessions/')) {
      return json({ status: 200, body: { id: 'sess', client_secret: 'x', session_secret: 'cs', payment_intent: sessionIntent(spec.options) } });
    }
    return json({ status: 404, body: { message: 'not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const by = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix) || c.url.includes(`${suffix}?`));
  return { calls, by };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let seq = 0;
const props = (extra: Record<string, unknown> = {}) => ({
  isOpen: true,
  sessionSecret: `cs_bank_${++seq}`,
  paymentMethods: ['card' as const, 'bank_transfer' as const],
  successDelayMs: 0,
  reference: 'ORD-24817',
  ...extra,
});

async function openBank() {
  await advance(0);
  fireEvent.click(screen.getByRole('button', { name: 'Bank transfer' }));
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('direct bank transfer in the checkout', () => {
  it('picking Bank transfer charges without a phone, shows the account, and ends on the receipt only when the server says succeeded', async () => {
    const backend = fakeBackend({ status: (id, n) => ({ status: 200, body: n < 2 ? bankView(id) : paidView(id) }) });
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...props()} onSuccess={onSuccess} />);
    await openBank();

    const charge = backend.by('/charge')[0];
    expect(charge.body).toMatchObject({ method: 'bank_transfer', provider: 'stub' });
    expect(charge.body).not.toHaveProperty('phone');
    expect(backend.by('/select')).toHaveLength(0);

    expect(screen.getByText('7820 194 552')).toBeTruthy();
    expect(screen.getByText('Wema Bank')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('10:00');

    await advance(5000);
    expect(screen.queryByText('Payment received')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(backend.by('/status')[0].headers['X-Reevit-Client-Secret']).toBe('secret_1');

    await advance(5000);
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(screen.getByText('Bank transfer · Wema Bank')).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ paymentId: 'pay_bank_1', paymentMethod: 'bank_transfer', status: 'success' });
  });

  it('"I’ve sent it" asks the provider now; nothing yet shows "We haven’t seen it yet", and Keep waiting goes back', async () => {
    const backend = fakeBackend();
    render(<ReevitCheckout {...props()} />);
    await openBank();

    fireEvent.click(screen.getByRole('button', { name: 'I’ve sent it' }));
    await advance(0);
    expect(screen.getByText('Confirming your transfer')).toBeTruthy();

    await advance(800);
    expect(backend.by('/status').some((c) => c.url.endsWith('?check=1'))).toBe(true);
    expect(screen.getByText('We haven’t seen it yet')).toBeTruthy();
    expect(screen.queryByText('Payment received')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    await advance(0);
    expect(screen.getByText('7820 194 552')).toBeTruthy();
  });

  it('an expired account asks for new details; a 409 keeps the screen and says why', async () => {
    const backend = fakeBackend({
      charge: (n) =>
        n === 1
          ? { status: 200, body: { ...bankView('pay_bank_1'), client_secret: 'secret_1' } }
          : { status: 409, body: { error: 'attempt_pending', message: 'Your earlier payment is still active.', can_resend_at: iso(700_000) }, headers: { 'Retry-After': '60' } },
      status: (id) => ({ status: 200, body: expiredView(id) }),
    });
    render(<ReevitCheckout {...props()} />);
    await openBank();

    await advance(5000);
    expect(screen.getByText('These details have expired.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Get new details' }));
    await advance(0);
    expect(backend.by('/charge')).toHaveLength(2);
    expect(screen.getByText('Your earlier payment is still active.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get new details' })).toBeTruthy();
    expect(screen.queryByText('Payment received')).toBeNull();
  });

  it('a successful "Get new details" shows the new account', async () => {
    const backend = fakeBackend({
      charge: (n) => ({
        status: 200,
        body: n === 1
          ? { ...bankView('pay_bank_1'), client_secret: 'secret_1' }
          : { ...bankView('pay_bank_2', { next_action: { type: 'bank_transfer', expires_at: iso(1_200_000), bank: { ...BANK, account_number: '1112223334' } } }), client_secret: 'secret_2' },
      }),
      status: (id) => ({ status: 200, body: id === 'pay_bank_1' ? expiredView(id) : bankView(id) }),
    });
    render(<ReevitCheckout {...props()} />);
    await openBank();
    await advance(5000);

    fireEvent.click(screen.getByRole('button', { name: 'Get new details' }));
    await advance(0);
    expect(backend.by('/charge')).toHaveLength(2);
    expect(screen.getByText('1112 223 334')).toBeTruthy();
  });

  it('omits the account name when the provider returns none', async () => {
    fakeBackend({
      charge: () => ({
        status: 200,
        body: { ...bankView('pay_bank_1', { next_action: { type: 'bank_transfer', expires_at: BANK.expires_at, bank: { ...BANK, account_name: undefined, bank: 'First Bank Ghana' } } }), client_secret: 'secret_1' },
      }),
    });
    render(<ReevitCheckout {...props()} />);
    await openBank();

    expect(screen.getByText('First Bank Ghana')).toBeTruthy();
    expect(screen.queryByText('Account name')).toBeNull();
  });

  it('a hosted bank transfer keeps the provider’s own flow (no charge route)', async () => {
    const backend = fakeBackend({ options: [{ method: 'bank_transfer', flow: 'hosted', networks: [], needs: [] }, { method: 'card', flow: 'hosted', networks: [], needs: [] }] });
    render(<ReevitCheckout {...props()} />);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Bank transfer' }));
    await advance(0);

    expect(backend.by('/charge')).toHaveLength(0);
  });

  it('closing mid-transfer asks first, and a live account is not replaced when the shopper goes back and picks it again', async () => {
    const backend = fakeBackend();
    render(<ReevitCheckout {...props()} />);
    await openBank();

    fireEvent.click(screen.getByRole('button', { name: 'Close checkout' }));
    await advance(0);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep paying' }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to payment methods' }));
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Bank transfer' }));
    await advance(0);

    expect(backend.by('/charge')).toHaveLength(1);
    expect(screen.getByText('7820 194 552')).toBeTruthy();
  });
});
