import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReevitCheckout } from './ReevitCheckout';
import type { PaymentIntent, PaymentMethod } from '../types';

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

  it('opens Paystack with the shopper-selected Mobile Money intent and deduplicates repeated taps', async () => {
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

    const row = await screen.findByRole('button', { name: 'Mobile money' });
    act(() => {
      row.click();
      row.click();
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

    fireEvent.click(await screen.findByRole('button', { name: 'Card' }));

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

  it('routes to the recommended provider when several support the method, with no processor picker', async () => {
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

    await screen.findByRole('button', { name: 'Mobile money' });
    expect(screen.queryByRole('button', { name: 'Paystack' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flutterwave' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mobile money' }));

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

  it('never logs the shopper to the console while starting a payment', async () => {
    const { resumeTransaction } = installPaystackBridge();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify(sessionResponse('initial-access-code')), { status: 200 });
      }

      return new Response(JSON.stringify({
        payment_intent: sessionResponse('pii-card-access-code').payment_intent,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        sessionSecret={SESSION_SECRET + '_pii'}
        paymentMethods={['card', 'mobile_money']}
        email="shopper@example.com"
        phone="0241234567"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Card' }));

    await waitFor(() => expect(resumeTransaction).toHaveBeenCalledWith(
      'pii-card-access-code',
      expect.any(Object),
    ));

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logSpy).not.toHaveBeenCalled();
    expect(logged).not.toContain('shopper@example.com');
    expect(logged).not.toContain('0241234567');
    expect(logged).not.toContain('pii-card-access-code');
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

    fireEvent.click(await screen.findByRole('button', { name: 'Mobile money' }));

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


function mockIntent(
  providers: { provider: string; name: string; methods: PaymentMethod[] }[],
  recommendedPsp: PaymentIntent['recommendedPsp'] = 'paystack',
): PaymentIntent {
  return {
    id: 'pay_mock_1',
    clientSecret: 'cs_mock_1',
    amount: 75500,
    currency: 'GHS',
    status: 'pending',
    recommendedPsp,
    availableMethods: ['card', 'mobile_money', 'bank_transfer'],
    availableProviders: providers,
  };
}

const ALL_METHODS: PaymentMethod[] = ['card', 'mobile_money', 'bank_transfer'];

function rowLabels() {
  return Array.from(document.querySelectorAll('[data-reevit="row"] .reevit-row-label')).map((n) => n.textContent);
}

describe('ReevitCheckout method list and routing', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.PaystackPop;
    delete window.FlutterwaveCheckout;
  });

  it('shows the union of methods across providers, in card, mobile money, bank order', () => {
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={ALL_METHODS}
        initialPaymentIntent={mockIntent([
          { provider: 'monnify', name: 'Monnify', methods: ['bank_transfer'] },
          { provider: 'paystack', name: 'Paystack', methods: ['card'] },
          { provider: 'flutterwave', name: 'Flutterwave', methods: ['mobile_money', 'card'] },
        ])}
      />,
    );

    expect(rowLabels()).toEqual(['Card', 'Mobile money', 'Bank transfer']);
    expect(screen.queryByRole('button', { name: /Paystack|Flutterwave|Monnify/ })).toBeNull();
  });

  it('only lists methods the merchant allowed and Hubtel can take', () => {
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={ALL_METHODS}
        initialPaymentIntent={mockIntent(
          [{ provider: 'hubtel', name: 'Hubtel', methods: ['card', 'mobile_money', 'bank_transfer'] }],
          'hubtel',
        )}
      />,
    );

    expect(rowLabels()).toEqual(['Card', 'Mobile money']);
  });

  it('falls back to the first provider that supports the method when the recommended one does not', async () => {
    const flutterwave = vi.fn();
    window.FlutterwaveCheckout = flutterwave;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={ALL_METHODS}
        email="shopper@example.com"
        initialPaymentIntent={mockIntent([
          { provider: 'paystack', name: 'Paystack', methods: ['card'] },
          { provider: 'flutterwave', name: 'Flutterwave', methods: ['mobile_money'] },
        ], 'paystack')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mobile money' }));
    await waitFor(() => expect(flutterwave).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-reevit="footer-logo"]')?.getAttribute('data-provider')).toBe('flutterwave');
  });

  it('shows the recommended provider in the footer before a method is picked', () => {
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={ALL_METHODS}
        initialPaymentIntent={mockIntent([
          { provider: 'paystack', name: 'Paystack', methods: ['card'] },
          { provider: 'monnify', name: 'Monnify', methods: ['bank_transfer'] },
        ], 'monnify')}
      />,
    );

    expect(document.querySelector('[data-reevit="footer-logo"]')?.getAttribute('data-provider')).toBe('monnify');
  });

  it('shows the Opening line and a back chevron while the provider window is open, and returns to the list when it is dismissed', async () => {
    const { resumeTransaction } = installPaystackBridge();
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={ALL_METHODS}
        initialPaymentIntent={mockIntent([{ provider: 'paystack', name: 'Paystack', methods: ['card'] }])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(resumeTransaction).toHaveBeenCalled());
    expect(document.querySelector('[data-reevit="status"]')?.textContent).toBe('Opening Paystack…');
    expect(document.querySelector('[data-reevit="panel-title"]')?.textContent).toBe('Card');

    // The provider reports the shopper dismissed its window.
    act(() => { resumeTransaction.mock.calls[0][1].onCancel(); });
    await waitFor(() => expect(document.querySelector('[data-reevit="list"]')).not.toBeNull());
  });
});

describe('ReevitCheckout receipt', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.PaystackPop;
  });

  async function payThroughPaystack(props: Partial<React.ComponentProps<typeof ReevitCheckout>>) {
    const { resumeTransaction } = installPaystackBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'pay_mock_1', status: 'succeeded' }), { status: 200 })));
    const onSuccess = vi.fn();
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={['card']}
        initialPaymentIntent={mockIntent([{ provider: 'paystack', name: 'Paystack', methods: ['card'] }])}
        onSuccess={onSuccess}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(resumeTransaction).toHaveBeenCalled());
    await act(async () => {
      resumeTransaction.mock.calls[0][1].onSuccess({ reference: 'ref_123', trans: '1', status: 'success', message: 'ok', transaction: 'txn_1', trxref: 'ref_123' });
    });
    await screen.findByText('Payment received');
    return onSuccess;
  }

  it('shows reference, method, provider and date, then Done fires onSuccess exactly once and closes', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = await payThroughPaystack({ onOpenChange });

    const receipt = document.querySelector('[data-reevit="receipt"]') as HTMLElement;
    expect(receipt.textContent).toContain('ref_123');
    expect(receipt.textContent).toContain('Card');
    expect(receipt.textContent).toContain('Paystack');
    expect(onSuccess).not.toHaveBeenCalled(); // still inside the success delay

    fireEvent.click(document.querySelector('[data-reevit="done"]') as HTMLElement);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ reference: 'ref_123', paymentMethod: 'card' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // A second click, or closing the receipt, must not deliver the result again.
    fireEvent.click(document.querySelector('[data-reevit="done"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-reevit="close"]') as HTMLElement);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('auto-closes after successDelayMs and still fires onSuccess only once', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = await payThroughPaystack({ onOpenChange, successDelayMs: 60 });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(document.querySelector('[data-reevit="done"]') as HTMLElement);
    await new Promise((r) => setTimeout(r, 120));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('delivers the result when the receipt is closed with the X before the delay ends', async () => {
    const onSuccess = await payThroughPaystack({});
    fireEvent.click(document.querySelector('[data-reevit="close"]') as HTMLElement);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('ReevitCheckout closing, focus and keyboard', () => {
  beforeEach(() => {
    // Closing cancels the pending intent; answer that call instead of hitting the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.PaystackPop;
  });

  const intent = () => mockIntent([{ provider: 'paystack', name: 'Paystack', methods: ['card', 'mobile_money'] }]);

  it('closes straight away from the list, without a confirmation', () => {
    const onClose = vi.fn();
    render(
      <ReevitCheckout isOpen publicKey="pfk_test" paymentMethods={['card', 'mobile_money']} initialPaymentIntent={intent()} onClose={onClose} />,
    );

    fireEvent.click(document.querySelector('[data-reevit="close"]') as HTMLElement);
    expect(document.querySelector('[data-reevit="confirm"]')).toBeNull();
    return waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('asks before leaving while a provider window is open, and Keep paying stays', async () => {
    const { resumeTransaction } = installPaystackBridge();
    const onClose = vi.fn();
    render(
      <ReevitCheckout isOpen publicKey="pfk_test" paymentMethods={['card', 'mobile_money']} initialPaymentIntent={intent()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(resumeTransaction).toHaveBeenCalled());

    fireEvent.click(document.querySelector('[data-reevit="close"]') as HTMLElement);
    const confirm = document.querySelector('[data-reevit="confirm"]');
    expect(confirm).not.toBeNull();
    expect(confirm?.getAttribute('role')).toBe('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('[data-reevit="stay"]') as HTMLElement);
    expect(document.querySelector('[data-reevit="confirm"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('[data-reevit="close"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-reevit="leave"]') as HTMLElement);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('moves focus to the first method, traps Tab, closes on Escape and returns focus to the opener', async () => {
    const onClose = vi.fn();
    render(
      <ReevitCheckout publicKey="pfk_test" paymentMethods={['card', 'mobile_money']} initialPaymentIntent={intent()} onClose={onClose} />,
    );
    const opener = screen.getByRole('button', { name: /Pay/ });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(document.querySelector('[data-reevit="title"]')?.id);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-reevit="row"]'));
    expect(document.activeElement).toBe(rows[0]);

    // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    controls[controls.length - 1].focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(controls[controls.length - 1]);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('announces the current view in a polite live region', async () => {
    render(<ReevitCheckout isOpen publicKey="pfk_test" paymentMethods={['card', 'mobile_money']} initialPaymentIntent={intent()} />);
    const live = document.querySelector('[data-reevit="live"]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(live.textContent).toBe('Choose a payment method'));
  });
});

describe('ReevitCheckout M-Pesa', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks for the number when M-Pesa is the only method and sends the STK push after Pay', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify(body.phone_number ? { checkout_request_id: 'ws_CO_1' } : {}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={['mobile_money']}
        initialPaymentIntent={{
          ...mockIntent([{ provider: 'mpesa', name: 'M-Pesa', methods: ['mobile_money'] }], 'mpesa'),
          currency: 'KES',
        }}
      />,
    );

    // One method, so there is no list and no back button: straight to the number.
    expect(document.querySelector('[data-reevit="list"]')).toBeNull();
    expect(document.querySelector('[data-reevit="back"]')).toBeNull();

    const input = screen.getByLabelText('M-Pesa number');
    fireEvent.change(input, { target: { value: '712345678' } });
    expect((input as HTMLInputElement).value).toBe('712 345 678');
    fireEvent.click(screen.getByRole('button', { name: 'Pay KES 755.00' }));

    await screen.findByText('Approve on your phone');
    const stk = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/mpesa'));
    expect(JSON.parse(String(stk?.[1]?.body))).toMatchObject({ phone_number: '254712345678', currency: 'KES', amount: 75500 });
  });

  it('rejects a number that is not a Kenyan mobile', () => {
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={['mobile_money']}
        initialPaymentIntent={{
          ...mockIntent([{ provider: 'mpesa', name: 'M-Pesa', methods: ['mobile_money'] }], 'mpesa'),
          currency: 'KES',
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('M-Pesa number'), { target: { value: '512345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay KES 755.00' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid M-Pesa number');
  });
});

describe('ReevitCheckout failure', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.PaystackPop;
  });

  it('shows the failure panel with Try again when confirming the payment fails', async () => {
    const { resumeTransaction } = installPaystackBridge();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Card declined' }), { status: 402 })));
    const onError = vi.fn();
    render(
      <ReevitCheckout
        isOpen
        publicKey="pfk_test"
        paymentMethods={['card']}
        initialPaymentIntent={mockIntent([{ provider: 'paystack', name: 'Paystack', methods: ['card'] }])}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(resumeTransaction).toHaveBeenCalled());
    await act(async () => {
      resumeTransaction.mock.calls[0][1].onSuccess({ reference: 'ref_x', trans: '1', status: 'success', message: 'ok', transaction: 't', trxref: 'ref_x' });
    });

    const failure = await waitFor(() => {
      const el = document.querySelector('[data-reevit="failure"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(failure.textContent).toContain('Payment failed');
    expect(onError).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(document.querySelector('[data-reevit="list"]')).not.toBeNull());
  });
});

describe('MobileMoneyForm (Ghana)', () => {
  afterEach(() => cleanup());

  it('detects the network from the number, validates, and submits digits plus network', async () => {
    const { MobileMoneyForm } = await import('./MobileMoneyForm');
    const onSubmit = vi.fn();
    render(<MobileMoneyForm onSubmit={onSubmit} submitLabel="Pay GHS 755.00" hideCancel />);

    // Nothing typed: the number is rejected.
    fireEvent.click(screen.getByRole('button', { name: 'Pay GHS 755.00' }));
    expect(screen.getByRole('alert').textContent).toContain('10-digit');
    expect(onSubmit).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Mobile money number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0244128890' } });
    expect(input.value).toBe('024 412 8890');
    expect(screen.getByRole('button', { name: 'MTN' }).getAttribute('aria-pressed')).toBe('true');

    // A manual pick of another network survives further typing within the same operator.
    fireEvent.click(screen.getByRole('button', { name: 'Telecel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay GHS 755.00' }));
    expect(screen.getByRole('alert').textContent).toContain('doesn’t match');

    fireEvent.click(screen.getByRole('button', { name: 'MTN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay GHS 755.00' }));
    expect(onSubmit).toHaveBeenCalledWith({ phone: '0244128890', network: 'mtn' });
  });
});
