import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReevitCheckout } from './ReevitCheckout';

const T0 = Date.parse('2026-10-23T12:00:00Z');
/** Fixed instants, like a real server: an attempt's expiry does not slide as the clock moves. */
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const GH_OPTIONS = [
  { method: 'mobile_money', flow: 'direct', networks: ['mtn', 'telecel', 'airteltigo'], needs: ['phone', 'network'], voucher_networks: ['telecel'] },
  { method: 'card', flow: 'hosted', networks: [], needs: [] },
];

function sessionIntent(options: unknown[] = GH_OPTIONS) {
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
    available_psps: [{ provider: 'stub', name: 'Test provider', methods: ['mobile_money', 'card'], method_options: options }],
  };
}

function view(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: 'pending',
    amount: 75500,
    currency: 'GHS',
    method: 'mobile_money',
    provider_display: 'Test provider',
    next_action: { type: 'mobile_money_prompt', network: 'mtn', phone_masked: '024 ••• 8890', expires_at: iso(120_000), attempt: { n: 1, max: 3 } },
    rerouted: false,
    poll_after_ms: 2000,
    ...over,
  };
}

const failedView = (id: string, code: string, category: string) =>
  view(id, { status: 'failed', next_action: undefined, poll_after_ms: 0, failure: { code, category, retryable: true, message: 'server wording' } });
const paidView = (id: string) => view(id, { status: 'succeeded', next_action: undefined, poll_after_ms: 0 });

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

interface Backend {
  /** Answer for `charge`; receives the 1-based call number. */
  charge?: (n: number, body: Record<string, unknown>) => { status: number; body: unknown; headers?: Record<string, string> };
  status?: (id: string, n: number) => { status: number; body: unknown };
  action?: (n: number, body: Record<string, unknown>) => { status: number; body: unknown };
  resend?: (n: number) => { status: number; body: unknown; headers?: Record<string, string> };
  options?: unknown[];
}

function fakeBackend(spec: Backend = {}) {
  const calls: Call[] = [];
  const counts = { charge: 0, action: 0, resend: 0, status: new Map<string, number>() };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, headers, body });
    const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(payload), { status, headers: extra });

    if (url.endsWith('/charge')) {
      counts.charge += 1;
      const answer = spec.charge?.(counts.charge, body) ?? { status: 200, body: { ...view('pay_1'), client_secret: 'secret_1' } };
      return json(answer.status, answer.body, answer.headers);
    }
    if (url.endsWith('/status')) {
      const id = /payments\/([^/]+)\/status/.exec(url)![1];
      const n = (counts.status.get(id) ?? 0) + 1;
      counts.status.set(id, n);
      const answer = spec.status?.(id, n) ?? { status: 200, body: view(id) };
      return json(answer.status, answer.body);
    }
    if (url.endsWith('/action')) {
      counts.action += 1;
      const answer = spec.action?.(counts.action, body) ?? { status: 200, body: view('pay_1') };
      return json(answer.status, answer.body);
    }
    if (url.endsWith('/resend')) {
      counts.resend += 1;
      const answer = spec.resend?.(counts.resend) ?? { status: 200, body: { ...view('pay_2'), client_secret: 'secret_2' } };
      return json(answer.status, answer.body, answer.headers);
    }
    if (url.endsWith('/select')) {
      return json(200, { payment_intent: { ...sessionIntent(spec.options), id: 'pay_hosted' } });
    }
    if (url.includes('/v1/checkout/sessions/')) {
      return json(200, { id: 'sess', client_secret: 'x', session_secret: 'cs', payment_intent: sessionIntent(spec.options) });
    }
    return json(404, { message: 'not found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  const by = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));
  return { calls, fetchMock, counts, by };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// @reevit/core caches intents per session for ten minutes, so every test gets its own.
let seq = 0;
const props = (extra: Record<string, unknown> = {}) => ({
  isOpen: true,
  sessionSecret: `cs_direct_${++seq}`,
  paymentMethods: ['card' as const, 'mobile_money' as const],
  successDelayMs: 0,
  reference: 'ORD-24817',
  ...extra,
});

async function openMomo() {
  await advance(0);
  fireEvent.click(screen.getByRole('button', { name: 'Mobile money' }));
  await advance(0);
}

async function payWith(number: string, label = 'Mobile money number') {
  fireEvent.change(screen.getByLabelText(label), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: 'Pay GHS 755.00' }));
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

describe('direct mobile money in the checkout', () => {
  it('collects the number on Reevit’s own form, charges, waits, and ends on the receipt only when the server says succeeded', async () => {
    const backend = fakeBackend({
      charge: () => ({ status: 200, body: { ...view('pay_1'), client_secret: 'secret_1' } }),
      status: (id, n) => ({ status: 200, body: n < 3 ? view(id) : paidView(id) }),
    });
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...props()} onSuccess={onSuccess} />);
    await openMomo();
    expect(screen.getByText('Mobile money', { selector: 'h2' })).toBeTruthy();

    await payWith('0244128890');
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    expect(screen.getByText('024 412 8890')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('2:00');

    const charge = backend.by('/charge')[0];
    expect(charge.body).toMatchObject({ method: 'mobile_money', provider: 'stub', phone: '0244128890', network: 'mtn' });
    expect(typeof charge.body.attempt_token).toBe('string');
    expect(Object.keys(charge.headers).map((h) => h.toLowerCase())).not.toContain('x-reevit-key');
    // No hosted selection and no card data anywhere.
    expect(backend.by('/select')).toHaveLength(0);

    await advance(2000);
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    const poll = backend.by('/status')[0];
    expect(poll.headers['X-Reevit-Client-Secret']).toBe('secret_1');
    expect(poll.url).not.toContain('secret_1');

    await advance(2000);
    await advance(2000);
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ paymentId: 'pay_1', paymentMethod: 'mobile_money', status: 'success' });
  });

  it('"I’ve approved" is a status read, not a shortcut', async () => {
    const backend = fakeBackend();
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...props()} onSuccess={onSuccess} />);
    await openMomo();
    await payWith('0244128890');
    fireEvent.click(screen.getByRole('button', { name: 'I’ve approved' }));
    await advance(0);
    expect(backend.by('/status')).toHaveLength(1);
    expect(screen.getByText('We haven’t received your approval yet.')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('Payment received')).toBeNull();
  });

  it('shows the declined panel and "Try again" starts a new attempt for the same number', async () => {
    const backend = fakeBackend({
      charge: (n) => ({ status: 200, body: { ...(n === 1 ? view('pay_1') : view('pay_2')), client_secret: `secret_${n}` } }),
      status: (id) => ({ status: 200, body: id === 'pay_1' ? failedView(id, 'not_approved', 'not_approved') : view(id) }),
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0244128890');
    await advance(2000);
    expect(screen.getByText('Payment declined')).toBeTruthy();
    expect(screen.getByText('The request wasn’t approved on your phone.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use another number' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another method' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);
    expect(backend.counts.charge).toBe(2);
    expect(backend.by('/charge')[1].body.phone).toBe('0244128890');
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
  });

  it('shows insufficient funds with its own wording', async () => {
    fakeBackend({ status: (id) => ({ status: 200, body: failedView(id, 'insufficient_funds', 'insufficient_funds') }) });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0244128890');
    await advance(2000);
    expect(screen.getByText('Insufficient funds')).toBeTruthy();
    expect(screen.getByText('Top up your wallet, then try again.')).toBeTruthy();
  });

  it('times out at the countdown, offers a new prompt, and lets a late approval through', async () => {
    let paid = false;
    fakeBackend({ status: (id) => ({ status: 200, body: paid ? paidView(id) : view(id) }) });
    const onSuccess = vi.fn();
    render(<ReevitCheckout {...props()} onSuccess={onSuccess} />);
    await openMomo();
    await payWith('0244128890');
    await advance(125_000);
    expect(screen.getByText('No response in time')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send a new prompt' })).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    paid = true;
    await advance(6000);
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('Resend prompt stays disabled until can_resend_at, then a 409 attempt_pending is handled calmly', async () => {
    const backend = fakeBackend({
      charge: () => ({
        status: 200,
        body: { ...view('pay_1', { next_action: { type: 'mobile_money_prompt', network: 'mtn', phone_masked: '024 ••• 8890', expires_at: iso(120_000), can_resend_at: iso(30_000) } }), client_secret: 'secret_1' },
      }),
      resend: () => ({
        status: 409,
        body: { error: 'attempt_pending', message: 'Your earlier payment prompt is still active. Approve it on your phone, or wait for it to expire.', can_resend_at: iso(45_000) },
        headers: { 'Retry-After': '45' },
      }),
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0244128890');
    const resend = () => screen.getByRole('button', { name: /Resend prompt/ }) as HTMLButtonElement;
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toBe('Resend prompt in 30s');
    fireEvent.click(resend());
    expect(backend.counts.resend).toBe(0);

    await advance(30_500);
    expect(resend().disabled).toBe(false);
    expect(resend().textContent).toBe('Resend prompt');
    fireEvent.click(resend());
    await advance(0);
    expect(backend.counts.resend).toBe(1);
    expect(screen.getByText(/earlier payment prompt is still active/)).toBeTruthy();
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    expect(resend().disabled).toBe(true);
  });

  it('asks for the code when the provider needs one, and submits it to /action', async () => {
    const backend = fakeBackend({
      charge: () => ({
        status: 200,
        body: {
          ...view('pay_1', { status: 'requires_action', next_action: { type: 'otp', network: 'mtn', phone_masked: '024 ••• 8890', expires_at: iso(120_000) } }),
          client_secret: 'secret_1',
        },
      }),
      action: () => ({ status: 200, body: view('pay_1') }),
      status: (id, n) => ({ status: 200, body: n < 2 ? view(id) : paidView(id) }),
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0244128890');
    expect(screen.getByText('Enter your code')).toBeTruthy();
    expect(screen.getByText('024 ••• 8890')).toBeTruthy();

    const continueButton = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(continueButton);
    await advance(0);

    expect(backend.counts.action).toBe(1);
    expect(backend.by('/action')[0].body).toEqual({ type: 'otp', code: '123456' });
    expect(backend.by('/action')[0].headers['X-Reevit-Client-Secret']).toBe('secret_1');
    expect(screen.getByText('Approve on your phone')).toBeTruthy();
    await advance(4000);
    expect(screen.getByText('Payment received')).toBeTruthy();
  });

  it('shows the Telecel voucher screen with the dial code, and the wrong-code line', async () => {
    fakeBackend({
      charge: () => ({
        status: 200,
        body: {
          ...view('pay_1', {
            status: 'requires_action',
            next_action: { type: 'voucher', network: 'telecel', phone_masked: '020 ••• 8890', expires_at: iso(120_000), voucher: { ussd: '*110#' } },
          }),
          client_secret: 'secret_1',
        },
      }),
      action: () => ({ status: 422, body: { error: 'invalid_code', message: 'x', attempts_left: 4 } }),
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0201234567');
    expect(screen.getByText('Enter your voucher')).toBeTruthy();
    expect(screen.getByText('*110#')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Voucher code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await advance(0);
    expect(screen.getByRole('alert').textContent).toBe('That code wasn’t accepted.');
  });

  it('shows the failover line while a rerouted attempt is pending and a note on the receipt', async () => {
    fakeBackend({
      status: (id, n) => ({ status: 200, body: n < 2 ? view(id, { rerouted: true }) : { ...paidView(id), rerouted: true } }),
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    await payWith('0244128890');
    await advance(2000);
    expect(screen.getByText('Your provider didn’t respond. Retrying with another…')).toBeTruthy();
    await advance(2000);
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(screen.getByText(/we retried with another and it went through/)).toBeTruthy();
  });

  it('keeps today’s provider handoff for a hosted provider', async () => {
    const backend = fakeBackend({
      options: [
        { method: 'mobile_money', flow: 'hosted', networks: [], needs: [] },
        { method: 'card', flow: 'hosted', networks: [], needs: [] },
      ],
    });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    expect(backend.by('/select').length).toBeGreaterThan(0);
    expect(backend.by('/charge')).toHaveLength(0);
  });

  it('never routes a card through the direct path', async () => {
    const backend = fakeBackend({ options: [{ method: 'card', flow: 'direct', networks: [], needs: [] }, GH_OPTIONS[0]] });
    render(<ReevitCheckout {...props()} />);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await advance(0);
    expect(backend.by('/charge')).toHaveLength(0);
  });

  it('only offers the networks the provider accepts', async () => {
    fakeBackend({ options: [{ method: 'mobile_money', flow: 'direct', networks: ['mtn', 'telecel'], needs: ['phone', 'network'] }, GH_OPTIONS[1]] });
    render(<ReevitCheckout {...props()} />);
    await openMomo();
    const networks = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent);
    expect(networks).toContain('MTN');
    expect(networks).toContain('Telecel');
    expect(networks).not.toContain('AirtelTigo');
  });

  it('stops polling when the checkout is closed', async () => {
    const backend = fakeBackend();
    const onClose = vi.fn();
    render(<ReevitCheckout {...props()} onClose={onClose} />);
    await openMomo();
    await payWith('0244128890');
    await advance(2000);
    const n = backend.by('/status').length;
    fireEvent.click(screen.getByRole('button', { name: 'Close checkout' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await advance(60_000);
    expect(backend.by('/status')).toHaveLength(n);
  });

  it('M-Pesa direct: +254 form, no network chips, charge carries 254…', async () => {
    const backend = fakeBackend({
      options: [{ method: 'mobile_money', flow: 'direct', networks: ['mpesa'], needs: ['phone'] }],
    });
    render(<ReevitCheckout {...props({ paymentMethods: ['mobile_money'] })} />);
    await advance(0);
    fireEvent.change(screen.getByLabelText('M-Pesa number'), { target: { value: '712345678' } });
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await advance(0);
    expect(backend.by('/charge')[0].body).toMatchObject({ phone: '254712345678', network: 'mpesa' });
    expect(screen.getByText('+254 712 345 678')).toBeTruthy();
  });
});
