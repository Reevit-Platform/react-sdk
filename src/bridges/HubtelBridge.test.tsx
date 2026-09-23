import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HubtelBridge } from './HubtelBridge';

const CHECKOUT_URL = 'https://pay.hubtel.com/9aa1';
const DIRECT_URL = 'https://pay.hubtel.com/9aa1/direct';

function mockReevitApi(statuses: string[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/v1/payments/hubtel/sessions/')) {
      return new Response(
        JSON.stringify({ paymentId: 'pay_1', status: 'requires_action', checkoutUrl: CHECKOUT_URL, checkoutDirectUrl: DIRECT_URL, checkoutId: '9aa1' }),
        { status: 200 },
      );
    }
    const status = statuses.shift() ?? 'requires_action';
    return new Response(JSON.stringify({ id: 'pay_1', status }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

describe('HubtelBridge', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('opens the hosted checkout from the session and reports success from confirm-intent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockReevitApi(['requires_action', 'succeeded']);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <HubtelBridge
        paymentId="pay_1"
        clientSecret={CHECKOUT_URL}
        amount={1000}
        currency="GHS"
        reference="ref_1"
        apiBaseUrl="https://api.test"
        onSuccess={onSuccess}
        onError={onError}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText('Complete your payment with Hubtel');
    const iframe = document.querySelector('[data-reevit-hubtel-checkout] iframe') as HTMLIFrameElement;
    expect(iframe.src).toBe(DIRECT_URL);

    await vi.advanceTimersByTimeAsync(8000);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onSuccess.mock.calls[0][0]).toMatchObject({
      paymentId: 'pay_1',
      psp: 'hubtel',
      status: 'success',
      pspReference: '9aa1',
      reference: 'ref_1',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(document.querySelector('[data-reevit-hubtel-checkout]')).toBeNull();
    expect(calls[0]).toBe(`https://api.test/v1/payments/hubtel/sessions/pay_1?client_secret=${encodeURIComponent(CHECKOUT_URL)}`);
    expect(calls.slice(1).every((url) => url.includes('/v1/payments/pay_1/confirm-intent'))).toBe(true);
  });

  it('ignores a legacy basicAuth prop and warns once', async () => {
    mockReevitApi([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const props = {
      paymentId: 'pay_1',
      clientSecret: CHECKOUT_URL,
      amount: 1000,
      basicAuth: 'bGVnYWN5OmNyZWRz',
      merchantAccount: '2020',
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const { unmount } = render(<HubtelBridge {...props} />);
    await screen.findByText('Complete your payment with Hubtel');
    unmount();
    render(<HubtelBridge {...props} />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('basicAuth');
    expect(document.body.innerHTML).not.toContain('bGVnYWN5OmNyZWRz');
  });

  it('closes the hosted checkout when unmounted', async () => {
    mockReevitApi([]);
    const { unmount } = render(
      <HubtelBridge paymentId="pay_1" clientSecret={CHECKOUT_URL} amount={1000} onSuccess={vi.fn()} onError={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByText('Complete your payment with Hubtel');
    expect(document.querySelector('[data-reevit-hubtel-checkout]')).not.toBeNull();

    unmount();
    expect(document.querySelector('[data-reevit-hubtel-checkout]')).toBeNull();
  });
});
