/**
 * Hubtel Bridge
 *
 * Opens Hubtel's hosted checkout for a payment the Reevit API has already
 * initiated, and reports the outcome from Reevit's confirm endpoint. Hubtel
 * credentials never reach the browser: the API returns only the checkout URL.
 */

import { useEffect, useRef, useState } from 'react';
import type { PaymentMethod, PaymentResult, PaymentError } from '../types';
import { createReevitClient } from '../api/client';
import { LoadingState } from '../components/LoadingState';
import {
  openHubtelCheckoutUrl,
  startHubtelHostedCheckout,
  warnHubtelBasicAuthIgnored,
} from './hubtelHostedCheckout';

interface HubtelBridgeProps {
  paymentId: string;
  publicKey?: string;
  amount: number;
  currency?: string;
  reference?: string;
  apiBaseUrl?: string;
  /** The payment's client secret; authorises the session and status calls. */
  clientSecret?: string;
  preferredMethod?: PaymentMethod;
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
  /** @deprecated Ignored. Hubtel's hosted checkout already knows the merchant. */
  merchantAccount?: string | number;
  /** @deprecated Ignored. Collected on Hubtel's hosted checkout. */
  email?: string;
  /** @deprecated Ignored. Collected on Hubtel's hosted checkout. */
  phone?: string;
  /** @deprecated Ignored. Set when the payment is created. */
  description?: string;
  /** @deprecated Ignored. The Reevit API registers Hubtel's callback. */
  callbackUrl?: string;
  /** @deprecated Ignored. The session is always fetched for `paymentId`. */
  hubtelSessionToken?: string;
  /**
   * @deprecated Ignored, and never send it: it is the merchant's Hubtel API
   * login (base64 client_id:client_secret). Hubtel checkout no longer needs it.
   */
  basicAuth?: string;
}

type BridgeStage = 'idle' | 'connecting' | 'open';

export function HubtelBridge({
  paymentId,
  publicKey,
  amount,
  currency,
  reference,
  apiBaseUrl,
  clientSecret,
  preferredMethod,
  onSuccess,
  onError,
  onClose,
  autoStart = true,
  basicAuth,
}: HubtelBridgeProps) {
  const [stage, setStage] = useState<BridgeStage>(autoStart ? 'connecting' : 'idle');
  const [started, setStarted] = useState(autoStart);

  // Callbacks change identity on most parent renders; read them through a ref
  // so a re-render never restarts an open checkout.
  const latest = useRef({ amount, currency, reference, preferredMethod, onSuccess, onError, onClose });
  latest.current = { amount, currency, reference, preferredMethod, onSuccess, onError, onClose };

  useEffect(() => {
    if (basicAuth) {
      warnHubtelBasicAuthIgnored();
    }
  }, [basicAuth]);

  useEffect(() => {
    if (!started) {
      return;
    }

    let cancelled = false;
    const client = createReevitClient({ publicKey, baseUrl: apiBaseUrl });
    setStage('connecting');

    const handle = startHubtelHostedCheckout({
      clientSecret,
      createSession: () => client.createHubtelSession(paymentId, clientSecret),
      checkStatus: async () => {
        const { data, error } = clientSecret
          ? await client.confirmPaymentIntent(paymentId, clientSecret)
          : await client.confirmPayment(paymentId);
        return { status: data?.status, error };
      },
      onOpen: () => {
        if (!cancelled) setStage('open');
      },
      onSuccess: ({ status, checkoutId }) => {
        const current = latest.current;
        current.onSuccess({
          paymentId,
          reference: current.reference || paymentId,
          amount: current.amount,
          currency: current.currency || 'GHS',
          paymentMethod: current.preferredMethod || 'mobile_money',
          psp: 'hubtel',
          pspReference: checkoutId || paymentId,
          status: 'success',
          metadata: {
            hubtel_checkout_id: checkoutId,
            backend_status: status,
          },
        });
      },
      onError: (error) => latest.current.onError(error),
      onClose: () => latest.current.onClose(),
    });

    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [started, paymentId, clientSecret, publicKey, apiBaseUrl]);

  if (stage === 'idle') {
    return (
      <div className="reevit-brut__state">
        <span className="reevit-brut__state-marker">PAYMENT GATEWAY</span>
        <h3 className="reevit-brut__state-title">Pay with Hubtel</h3>
        <p className="reevit-brut__state-sub">You'll finish the payment on Hubtel's secure checkout</p>
        <button type="button" className="reevit-brut__cta" onClick={() => setStarted(true)}>
          <span>CONTINUE TO HUBTEL</span>
          <span>&rarr;</span>
        </button>
      </div>
    );
  }

  if (stage === 'open') {
    return (
      <LoadingState
        marker="AWAITING CONFIRMATION"
        title="Complete your payment with Hubtel"
        message="This updates as soon as Hubtel confirms the payment"
      />
    );
  }

  return <LoadingState marker="PAYMENT GATEWAY" title="Connecting to Hubtel" />;
}

/**
 * Opens Hubtel's hosted checkout.
 *
 * Pass `paymentId` and `clientSecret` (with `publicKey`/`apiBaseUrl` as
 * needed) to have the SDK fetch the checkout URL and report the outcome
 * through `onSuccess`/`onError`. With only `checkoutUrl`, the page is shown and
 * `onClose` fires when it is dismissed; confirm the payment server-side.
 */
export function openHubtelPopup(config: {
  /** Reevit payment id; enables session fetch and outcome tracking. */
  paymentId?: string;
  /** The payment's client secret. */
  clientSecret?: string;
  publicKey?: string;
  apiBaseUrl?: string;
  /** A Hubtel hosted checkout URL you already hold. */
  checkoutUrl?: string;
  onSuccess?: (data: Record<string, unknown>) => void;
  onError?: (data: Record<string, unknown>) => void;
  onClose?: () => void;
  /** @deprecated Ignored. */
  merchantAccount?: string | number;
  /** @deprecated Ignored. */
  description?: string;
  /** @deprecated Ignored. */
  amount?: number;
  /** @deprecated Ignored. */
  clientReference?: string;
  /** @deprecated Ignored. */
  callbackUrl?: string;
  /** @deprecated Ignored. */
  customerPhoneNumber?: string;
  /** @deprecated Ignored, and never send it: it is the merchant's Hubtel API login. */
  basicAuth?: string;
  /** @deprecated Ignored. */
  preferredMethod?: PaymentMethod;
}): void {
  if (config.basicAuth) {
    warnHubtelBasicAuthIgnored();
  }

  if (config.paymentId) {
    const paymentId = config.paymentId;
    const client = createReevitClient({ publicKey: config.publicKey, baseUrl: config.apiBaseUrl });
    startHubtelHostedCheckout({
      clientSecret: config.clientSecret,
      createSession: async () => {
        if (config.checkoutUrl) {
          return { data: { checkoutUrl: config.checkoutUrl } };
        }
        return client.createHubtelSession(paymentId, config.clientSecret);
      },
      checkStatus: async () => {
        const { data, error } = config.clientSecret
          ? await client.confirmPaymentIntent(paymentId, config.clientSecret)
          : await client.confirmPayment(paymentId);
        return { status: data?.status, error };
      },
      onSuccess: ({ status, checkoutId }) =>
        config.onSuccess?.({ paymentId, status, checkoutId, psp: 'hubtel' }),
      onError: (error) => config.onError?.({ ...error }),
      onClose: () => config.onClose?.(),
    });
    return;
  }

  if (config.checkoutUrl) {
    openHubtelCheckoutUrl(config.checkoutUrl, config.onClose);
    return;
  }

  config.onError?.({
    code: 'HUBTEL_CHECKOUT_URL_REQUIRED',
    message: 'openHubtelPopup needs a paymentId (and clientSecret) or a Hubtel checkoutUrl.',
    recoverable: false,
  });
}
