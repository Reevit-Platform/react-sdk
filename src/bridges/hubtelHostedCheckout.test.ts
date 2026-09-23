import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyPaymentStatus,
  isHubtelOrigin,
  resolveHubtelHostedCheckout,
  startHubtelHostedCheckout,
  type StartHubtelCheckoutOptions,
} from './hubtelHostedCheckout';

const CHECKOUT_URL = 'https://pay.hubtel.com/4b2f0c';
const DIRECT_URL = 'https://pay.hubtel.com/4b2f0c/direct';
const LEAKED_BASIC_AUTH = 'aHVidGVsLWNsaWVudDpodWJ0ZWwtc2VjcmV0';

function frame(): HTMLIFrameElement | null {
  return document.querySelector('[data-reevit-hubtel-checkout] iframe');
}

function start(overrides: Partial<StartHubtelCheckoutOptions> = {}) {
  const callbacks = {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
  const checkStatus = vi.fn(async () => ({ status: 'requires_action' }));
  const handle = startHubtelHostedCheckout({
    clientSecret: CHECKOUT_URL,
    createSession: async () => ({
      data: { checkoutUrl: CHECKOUT_URL, checkoutDirectUrl: DIRECT_URL, checkoutId: '4b2f0c', status: 'requires_action' },
    }),
    checkStatus,
    pollIntervalMs: 1000,
    ...callbacks,
    ...overrides,
  });
  return { handle, checkStatus, ...callbacks };
}

describe('resolveHubtelHostedCheckout', () => {
  it('reads the hosted checkout from the session response', () => {
    expect(
      resolveHubtelHostedCheckout({ checkoutUrl: CHECKOUT_URL, checkoutDirectUrl: DIRECT_URL, checkoutId: 'c1', status: 'pending' })
    ).toEqual({ checkoutUrl: CHECKOUT_URL, checkoutDirectUrl: DIRECT_URL, checkoutId: 'c1', status: 'pending' });
  });

  it('never uses basicAuth, and falls back to a Hubtel client secret for older backends', () => {
    const oldShape = { token: 't', merchantAccount: '2020', basicAuth: LEAKED_BASIC_AUTH };
    expect(resolveHubtelHostedCheckout(oldShape)).toBeNull();
    expect(resolveHubtelHostedCheckout(oldShape, CHECKOUT_URL)).toEqual({ checkoutUrl: CHECKOUT_URL });
  });

  it('rejects anything that is not an https URL, and non-Hubtel client secrets', () => {
    expect(resolveHubtelHostedCheckout({ checkoutUrl: 'javascript:alert(1)' })).toBeNull();
    expect(resolveHubtelHostedCheckout({ checkoutUrl: 'http://pay.hubtel.com/x' })).toBeNull();
    expect(
      resolveHubtelHostedCheckout({ checkoutUrl: CHECKOUT_URL, checkoutDirectUrl: 'data:text/html,hi' })?.checkoutDirectUrl
    ).toBeUndefined();
    expect(resolveHubtelHostedCheckout({}, 'https://evil.example/pay')).toBeNull();
    expect(resolveHubtelHostedCheckout({}, 'cs_opaque_secret')).toBeNull();
  });
});

describe('status helpers', () => {
  it('classifies Reevit payment statuses', () => {
    expect(classifyPaymentStatus('succeeded')).toBe('succeeded');
    expect(classifyPaymentStatus('failed')).toBe('failed');
    expect(classifyPaymentStatus('canceled')).toBe('failed');
    expect(classifyPaymentStatus('requires_action')).toBe('pending');
    expect(classifyPaymentStatus(undefined)).toBe('pending');
  });

  it('recognises Hubtel origins only', () => {
    expect(isHubtelOrigin('https://pay.hubtel.com')).toBe(true);
    expect(isHubtelOrigin('https://hubtel.com')).toBe(true);
    expect(isHubtelOrigin('https://hubtel.com.evil.example')).toBe(false);
    expect(isHubtelOrigin('http://pay.hubtel.com')).toBe(false);
  });
});

describe('startHubtelHostedCheckout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('embeds the direct checkout URL and reports success from Reevit, then closes', async () => {
    const { checkStatus, onSuccess, onError, onClose } = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(frame()?.src).toBe(DIRECT_URL);
    const newTab = document.querySelector('[data-reevit-hubtel-checkout] a') as HTMLAnchorElement;
    expect(newTab.href).toBe(CHECKOUT_URL);
    expect(newTab.rel).toContain('noopener');

    await vi.advanceTimersByTimeAsync(1000);
    expect(checkStatus).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();

    checkStatus.mockResolvedValueOnce({ status: 'succeeded' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onSuccess).toHaveBeenCalledWith({ status: 'succeeded', checkoutId: '4b2f0c' });
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(frame()).toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    expect(checkStatus).toHaveBeenCalledTimes(2);
  });

  it('falls back to the checkout URL when Hubtel issued no direct URL, ignoring a legacy basicAuth', async () => {
    start({
      createSession: async () => ({ data: { basicAuth: LEAKED_BASIC_AUTH, merchantAccount: '2020' } }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(frame()?.src).toBe(CHECKOUT_URL);
    expect(document.body.innerHTML).not.toContain(LEAKED_BASIC_AUTH);
  });

  it('checks once when the shopper closes, and reports a close if still unpaid', async () => {
    const { checkStatus, onClose, onSuccess } = start();
    await vi.advanceTimersByTimeAsync(0);

    (document.querySelector('[data-reevit-hubtel-checkout] button') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(checkStatus).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
  });

  it('reports success when the shopper closes right after paying', async () => {
    const { checkStatus, onClose, onSuccess } = start();
    await vi.advanceTimersByTimeAsync(0);
    checkStatus.mockResolvedValueOnce({ status: 'succeeded' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('checks immediately when a Hubtel page posts a message, and ignores other origins', async () => {
    const { checkStatus } = start();
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { success: true } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(checkStatus).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', { origin: 'https://pay.hubtel.com', data: { success: true } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it('surfaces the session error when there is no checkout to open', async () => {
    const { onError } = start({
      clientSecret: 'cs_opaque',
      createSession: async () => ({ error: { code: 'hubtel_checkout_unavailable', message: 'no checkout' } }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith({ code: 'hubtel_checkout_unavailable', message: 'no checkout', recoverable: true });
    expect(frame()).toBeNull();
  });

  it('stops on a permanent status error but keeps polling through transient ones', async () => {
    const { checkStatus, onError } = start();
    await vi.advanceTimersByTimeAsync(0);

    checkStatus.mockResolvedValueOnce({ error: { code: 'network_error', message: 'offline' } } as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).not.toHaveBeenCalled();

    checkStatus.mockResolvedValueOnce({
      error: { code: 'invalid_client_secret', message: 'invalid client secret', details: { httpStatus: 401 } },
    } as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_client_secret' }));
    expect(frame()).toBeNull();
  });

  it('cancel closes the checkout without firing callbacks', async () => {
    const { handle, onClose, onError, onSuccess, checkStatus } = start();
    await vi.advanceTimersByTimeAsync(0);

    handle.cancel();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(frame()).toBeNull();
    expect(checkStatus).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('never opens a checkout when cancelled while the session is loading', async () => {
    const { handle } = start();
    handle.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(frame()).toBeNull();
  });
});
