import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReevitCheckout } from './ReevitCheckout';

const SESSION_SECRET = 'cs_checkout_session_secret';

function installPaystackBridge() {
  const newTransaction = vi.fn();
  const resumeTransaction = vi.fn();
  window.PaystackPop = class {
    newTransaction = newTransaction;
    resumeTransaction = resumeTransaction;
  } as any;

  return { newTransaction, resumeTransaction };
}

function sessionResponse(accessCode: string, method = 'card') {
  return {
    id: 'checkout_session_payment',
    client_secret: accessCode,
    session_secret: SESSION_SECRET,
    payment_intent: {
      id: method === 'card' ? 'pay_initial_card' : 'pay_selected_mobile_money',
      org_id: 'org_123',
      connection_id: 'conn_paystack',
      provider: 'paystack',
      method,
      status: 'requires_action',
      client_secret: accessCode,
      amount: 1000,
      currency: 'GHS',
      fee_amount: 0,
      fee_currency: 'GHS',
      net_amount: 1000,
      available_psps: [{
        provider: 'paystack',
        name: 'Paystack',
        methods: ['card', 'mobile_money'],
      }],
    },
  };
}

describe('ReevitCheckout server-created sessions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.PaystackPop;
  });

  it('opens Paystack with the shopper-selected Mobile Money intent and deduplicates repeated Continue clicks', async () => {
    const { newTransaction, resumeTransaction } = installPaystackBridge();

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify(sessionResponse('card-only-access-code')), { status: 200 });
      }

      return new Response(JSON.stringify({
        payment_intent: sessionResponse('mobile-money-access-code', 'mobile_money').payment_intent,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        sessionSecret={SESSION_SECRET}
        paymentMethods={['card', 'mobile_money']}
        email="shopper@example.com"
        phone="0241234567"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /MOBILE MONEY/ }));
    const continueButton = screen.getByRole('button', { name: /MAKE PAYMENT/ });
    act(() => {
      continueButton.click();
      continueButton.click();
    });

    await waitFor(() => expect(resumeTransaction).toHaveBeenCalledWith(
      'mobile-money-access-code',
      expect.any(Object),
    ));

    const selectCalls = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith(`/v1/checkout/sessions/${encodeURIComponent(SESSION_SECRET)}/select`) &&
      init?.method === 'POST',
    );
    expect(selectCalls).toHaveLength(1);
    expect(JSON.parse(String(selectCalls[0][1]?.body))).toEqual({
      method: 'mobile_money',
      provider: 'paystack',
    });
    expect(resumeTransaction).not.toHaveBeenCalledWith('card-only-access-code', expect.anything());
    expect(newTransaction).not.toHaveBeenCalled();
  });

  it('requests and opens a card-specific intent', async () => {
    const { resumeTransaction } = installPaystackBridge();

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify(sessionResponse('initial-access-code')), { status: 200 });
      }

      return new Response(JSON.stringify({
        payment_intent: sessionResponse('card-specific-access-code').payment_intent,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        sessionSecret={SESSION_SECRET + '_card'}
        paymentMethods={['card', 'mobile_money']}
        email="shopper@example.com"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /CARD/ }));
    fireEvent.click(screen.getByRole('button', { name: /MAKE PAYMENT/ }));

    await waitFor(() => expect(resumeTransaction).toHaveBeenCalledWith(
      'card-specific-access-code',
      expect.any(Object),
    ));
    const selectCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(selectCall?.[1]?.body))).toEqual({
      method: 'card',
      provider: 'paystack',
    });
  });

  it('honors an explicit provider selection when several providers are available', async () => {
    const { resumeTransaction } = installPaystackBridge();

    const initial = sessionResponse('initial-access-code');
    initial.payment_intent.available_psps = [
      { provider: 'flutterwave', name: 'Flutterwave', methods: ['card', 'mobile_money'] },
      { provider: 'paystack', name: 'Paystack', methods: ['card', 'mobile_money'] },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify(initial), { status: 200 });
      }

      return new Response(JSON.stringify({
        payment_intent: sessionResponse('paystack-mobile-money-code', 'mobile_money').payment_intent,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        sessionSecret={SESSION_SECRET + '_provider'}
        paymentMethods={['card', 'mobile_money']}
        email="shopper@example.com"
        phone="0241234567"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Paystack' }));
    fireEvent.click(screen.getByRole('button', { name: /MOBILE MONEY/ }));
    fireEvent.click(screen.getByRole('button', { name: /MAKE PAYMENT/ }));

    await waitFor(() => expect(resumeTransaction).toHaveBeenCalledWith(
      'paystack-mobile-money-code',
      expect.any(Object),
    ));
    const selectCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(selectCall?.[1]?.body))).toEqual({
      method: 'mobile_money',
      provider: 'paystack',
    });
  });

  it('keeps the existing public-key intent refresh flow working', async () => {
    const { resumeTransaction } = installPaystackBridge();

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const intent = body.method === 'mobile_money'
        ? sessionResponse('public-key-mobile-money-code', 'mobile_money').payment_intent
        : sessionResponse('public-key-initial-code').payment_intent;
      return new Response(JSON.stringify(intent), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test_public_key"
        amount={1000}
        currency="GHS"
        reference="public-key-regression"
        paymentMethods={['card', 'mobile_money']}
        email="public-key-shopper@example.com"
        phone="0241234567"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /MOBILE MONEY/ }));
    fireEvent.click(screen.getByRole('button', { name: /MAKE PAYMENT/ }));

    await waitFor(() => expect(resumeTransaction).toHaveBeenCalledWith(
      'public-key-mobile-money-code',
      expect.any(Object),
    ));
    expect(fetchMock.mock.calls.some(([, init]) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return body.method === 'mobile_money' && body.policy?.allowed_providers?.[0] === 'paystack';
    })).toBe(true);
  });
});
