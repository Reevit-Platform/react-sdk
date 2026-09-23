/**
 * Hubtel hosted checkout.
 *
 * The Reevit backend initiates the Hubtel checkout server-side, with the
 * merchant's credentials, and hands the browser only the hosted checkout URL.
 * This module opens that URL (embedded, when Hubtel issued its iframe-safe
 * `checkoutDirectUrl`) and learns the outcome from Reevit's confirm endpoint —
 * never from the Hubtel page itself. No Hubtel credential reaches the browser.
 *
 * It replaces the `@hubteljs/checkout` flow, which needed the merchant's
 * `basicAuth` (base64 client_id:client_secret) client-side.
 *
 * Framework-agnostic on purpose: the React, Vue and Svelte SDKs carry the same
 * file so the three checkouts behave identically.
 */

export interface HubtelHostedCheckout {
  /** Hubtel hosted checkout page. */
  checkoutUrl: string;
  /** Hubtel's embeddable (iframe) variant, when Hubtel issued one. */
  checkoutDirectUrl?: string;
  checkoutId?: string;
  /** Reevit payment status at the time the session was created. */
  status?: string;
}

export type HubtelPaymentOutcome = 'succeeded' | 'failed' | 'pending';

export interface HubtelStatusCheck {
  status?: string;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export interface HubtelCheckoutError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface HubtelCheckoutSuccess {
  status: string;
  checkoutId?: string;
}

export interface StartHubtelCheckoutOptions {
  /** Fetches the hosted-checkout handoff (POST /v1/payments/hubtel/sessions/{id}). */
  createSession: () => Promise<{ data?: unknown; error?: { code?: string; message?: string } }>;
  /** Reads the payment's status from Reevit (confirm-intent). */
  checkStatus: () => Promise<HubtelStatusCheck>;
  /** The payment's client secret; older backends store the checkout URL there. */
  clientSecret?: string;
  onSuccess: (result: HubtelCheckoutSuccess) => void;
  onError: (error: HubtelCheckoutError) => void;
  /** The shopper closed the checkout before it settled. */
  onClose: () => void;
  /** Called once the hosted checkout is on screen. */
  onOpen?: (checkout: HubtelHostedCheckout) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface HubtelCheckoutHandle {
  /** Closes the checkout and stops polling without firing any callback. */
  cancel: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const HUBTEL_HOST = 'hubtel.com';

const SUCCEEDED_STATUSES = new Set(['succeeded', 'success', 'successful', 'paid', 'completed']);
const FAILED_STATUSES = new Set(['failed', 'canceled', 'cancelled', 'expired', 'abandoned', 'declined']);
// The payment or its client secret is gone for good; polling cannot recover.
const FATAL_HTTP_STATUSES = new Set([401, 403, 404]);

function readString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function httpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isHubtelHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === HUBTEL_HOST || host.endsWith(`.${HUBTEL_HOST}`);
}

/** True for messages posted by a Hubtel checkout page. */
export function isHubtelOrigin(origin: string): boolean {
  const url = httpsUrl(origin);
  return url !== null && isHubtelHostname(url.hostname);
}

/**
 * Reads the hosted checkout out of a Hubtel session response. Only https URLs
 * are accepted. Backends from before the hosted-checkout switch return no URL
 * here, but a Hubtel payment's client secret *is* its checkout URL, so that is
 * used as a fallback when it points at Hubtel.
 */
export function resolveHubtelHostedCheckout(session: unknown, clientSecret?: string): HubtelHostedCheckout | null {
  const source = session && typeof session === 'object' ? (session as Record<string, unknown>) : {};
  const checkoutUrl = readString(source, 'checkoutUrl', 'checkout_url');

  if (httpsUrl(checkoutUrl)) {
    const directUrl = readString(source, 'checkoutDirectUrl', 'checkout_direct_url');
    return {
      checkoutUrl: checkoutUrl as string,
      checkoutDirectUrl: httpsUrl(directUrl) ? directUrl : undefined,
      checkoutId: readString(source, 'checkoutId', 'checkout_id'),
      status: readString(source, 'status'),
    };
  }

  const fromSecret = httpsUrl(clientSecret);
  if (fromSecret && isHubtelHostname(fromSecret.hostname)) {
    return { checkoutUrl: (clientSecret as string).trim() };
  }

  return null;
}

export function classifyPaymentStatus(status?: string): HubtelPaymentOutcome {
  const normalized = (status || '').toLowerCase().trim();
  if (SUCCEEDED_STATUSES.has(normalized)) return 'succeeded';
  if (FAILED_STATUSES.has(normalized)) return 'failed';
  return 'pending';
}

// Declared locally so the module type-checks without Node's typings.
declare const process: { env: { NODE_ENV?: string } };

function isProductionBuild(): boolean {
  try {
    // Bundlers replace `process.env.NODE_ENV` statically; the try covers
    // browsers where `process` was never defined.
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

let warnedAboutBasicAuth = false;

/** Warns once (outside production builds) that `basicAuth` is ignored. */
export function warnHubtelBasicAuthIgnored(): void {
  if (warnedAboutBasicAuth || typeof console === 'undefined' || isProductionBuild()) {
    return;
  }
  warnedAboutBasicAuth = true;
  console.warn(
    '[Reevit] The Hubtel `basicAuth` option is deprecated and ignored. Hubtel checkout now opens the hosted checkout ' +
      'URL created by the Reevit API, so Hubtel credentials never need to reach the browser. Remove `basicAuth` from ' +
      'your code, and rotate the Hubtel API keys it contained.'
  );
}

interface CheckoutFrame {
  close: () => void;
}

const FRAME_ATTRIBUTE = 'data-reevit-hubtel-checkout';

function applyStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Shows the hosted checkout in a plain overlay above the Reevit modal. Inline
 * styles keep it independent of the host page's CSS.
 */
function openCheckoutFrame(url: string, newTabUrl: string, onDismiss: () => void): CheckoutFrame {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.setAttribute(FRAME_ATTRIBUTE, '');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Hubtel checkout');
  applyStyles(overlay, {
    position: 'fixed',
    inset: '0',
    'z-index': '2147483000',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: 'min(24px, 4vw)',
    background: 'rgba(0, 0, 0, 0.5)',
  });

  const panel = document.createElement('div');
  applyStyles(panel, {
    display: 'flex',
    'flex-direction': 'column',
    width: 'min(480px, 100%)',
    height: 'min(720px, 100%)',
    background: '#fff',
    'border-radius': '12px',
    overflow: 'hidden',
    'box-shadow': '0 16px 48px rgba(0, 0, 0, 0.2)',
  });

  const header = document.createElement('div');
  applyStyles(header, {
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'space-between',
    padding: '8px 8px 8px 16px',
    'border-bottom': '1px solid rgba(0, 0, 0, 0.08)',
    font: '13px/1.4 system-ui, -apple-system, sans-serif',
    color: '#555',
  });

  const newTab = document.createElement('a');
  newTab.href = newTabUrl;
  newTab.target = '_blank';
  newTab.rel = 'noopener noreferrer';
  newTab.textContent = 'Open in a new tab';
  applyStyles(newTab, { color: 'inherit', 'text-decoration': 'underline' });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close Hubtel checkout');
  closeButton.textContent = '×';
  applyStyles(closeButton, {
    width: '32px',
    height: '32px',
    border: '0',
    background: 'transparent',
    color: '#333',
    'font-size': '22px',
    'line-height': '1',
    cursor: 'pointer',
  });

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'Hubtel checkout';
  iframe.setAttribute('allow', 'payment');
  applyStyles(iframe, { flex: '1', width: '100%', border: '0', background: '#fff' });

  header.append(newTab, closeButton);
  panel.append(header, iframe);
  overlay.append(panel);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss();
    }
  };
  closeButton.addEventListener('click', onDismiss);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) onDismiss();
  });
  document.addEventListener('keydown', onKeyDown, true);

  document.body.appendChild(overlay);
  closeButton.focus();

  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      previouslyFocused?.focus?.();
    },
  };
}

/**
 * Opens Hubtel's hosted checkout for a payment and reports its outcome.
 *
 * Exactly one of onSuccess / onError / onClose fires, unless the returned
 * handle is cancelled first.
 */
export function startHubtelHostedCheckout(options: StartHubtelCheckoutOptions): HubtelCheckoutHandle {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let finished = false;
  let frame: CheckoutFrame | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<HubtelPaymentOutcome> | null = null;

  const teardown = () => {
    finished = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
    frame?.close();
    frame = null;
  };

  const settle = (fire: () => void) => {
    if (finished) return;
    teardown();
    fire();
  };

  const succeed = (status: string, checkoutId?: string) =>
    settle(() => options.onSuccess({ status, checkoutId }));

  const fail = (error: HubtelCheckoutError) => settle(() => options.onError(error));

  let checkoutId: string | undefined;

  const checkNow = (): Promise<HubtelPaymentOutcome> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const { status, error } = await options.checkStatus();
        if (finished) return 'pending';
        if (error) {
          const httpStatus = Number(error.details?.httpStatus);
          if (FATAL_HTTP_STATUSES.has(httpStatus)) {
            fail({
              code: error.code || 'HUBTEL_STATUS_UNAVAILABLE',
              message: error.message || 'We could not check this payment. Please start again.',
              recoverable: true,
            });
          }
          // Anything else (network, 5xx, rate limit) is transient: keep polling.
          return 'pending';
        }
        const outcome = classifyPaymentStatus(status);
        if (outcome === 'succeeded') {
          succeed(status as string, checkoutId);
        } else if (outcome === 'failed') {
          fail({ code: 'PAYMENT_FAILED', message: 'The payment was not completed.', recoverable: true });
        }
        return outcome;
      } catch {
        return 'pending';
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const schedulePoll = () => {
    if (finished) return;
    pollTimer = setTimeout(async () => {
      await checkNow();
      schedulePoll();
    }, pollIntervalMs);
  };

  // A Hubtel page posting a message usually means something changed; check
  // Reevit right away. The message content itself is never trusted.
  function onMessage(event: MessageEvent) {
    if (isHubtelOrigin(event.origin)) {
      void checkNow();
    }
  }

  const onDismiss = async () => {
    if (finished) return;
    frame?.close();
    frame = null;
    // The shopper may have paid just before closing: check once before
    // reporting a close.
    const outcome = await checkNow();
    if (outcome === 'pending') {
      settle(() => options.onClose());
    }
  };

  const open = async () => {
    let session: Awaited<ReturnType<StartHubtelCheckoutOptions['createSession']>>;
    try {
      session = await options.createSession();
    } catch {
      session = {};
    }
    if (finished) return;

    const hosted = resolveHubtelHostedCheckout(session.data, options.clientSecret);
    if (!hosted) {
      fail({
        code: session.error?.code || 'HUBTEL_CHECKOUT_UNAVAILABLE',
        message: session.error?.message || 'Hubtel checkout is not available for this payment.',
        recoverable: true,
      });
      return;
    }

    checkoutId = hosted.checkoutId;

    const initial = classifyPaymentStatus(hosted.status);
    if (initial === 'succeeded') {
      succeed(hosted.status as string, checkoutId);
      return;
    }
    if (initial === 'failed') {
      fail({ code: 'PAYMENT_FAILED', message: 'The payment was not completed.', recoverable: true });
      return;
    }

    frame = openCheckoutFrame(hosted.checkoutDirectUrl || hosted.checkoutUrl, hosted.checkoutUrl, () => {
      void onDismiss();
    });
    window.addEventListener('message', onMessage);
    deadlineTimer = setTimeout(() => {
      fail({
        code: 'PAYMENT_TIMEOUT',
        message: 'We did not receive a confirmation from Hubtel. If you were charged, the merchant will be notified.',
        recoverable: true,
      });
    }, timeoutMs);
    schedulePoll();
    options.onOpen?.(hosted);
  };

  void open();

  return { cancel: teardown };
}

/**
 * Opens a hosted checkout URL you already hold, without outcome tracking.
 * Prefer `startHubtelHostedCheckout`, which also reports the payment result.
 */
export function openHubtelCheckoutUrl(url: string, onClose?: () => void): HubtelCheckoutHandle {
  let frame: CheckoutFrame | null = null;
  frame = openCheckoutFrame(url, url, () => {
    frame?.close();
    frame = null;
    onClose?.();
  });
  return {
    cancel: () => {
      frame?.close();
      frame = null;
    },
  };
}
