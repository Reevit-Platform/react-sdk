/**
 * Flutterwave Bridge
 * Handles integration with Flutterwave payment modal
 */

import { useEffect, useCallback, useRef } from 'react';
import { currencyExponent, toMinorUnits } from '@reevit/core';
import type { PaymentResult, PaymentError } from '../types';
import { LoadingState } from '../components/LoadingState';

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: FlutterwaveConfig) => void;
  }
}

interface FlutterwaveConfig {
  public_key: string;
  tx_ref: string;
  amount: number;
  currency: string;
  payment_options?: string;
  customer: {
    email: string;
    phone_number?: string;
    name?: string;
  };
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: Record<string, unknown>;
  redirect_url?: string;
  callback: (response: FlutterwaveResponse) => void;
  onclose: () => void;
}

interface FlutterwaveResponse {
  status: 'successful' | 'failed' | 'cancelled';
  transaction_id: number;
  tx_ref: string;
  flw_ref: string;
  amount: number;
  currency: string;
  charged_amount: number;
  payment_type: string;
}

/**
 * The `tx_ref` to open Flutterwave's window with.
 *
 * Reevit creates the Flutterwave payment server-side under its own reference
 * (`pf_…`, returned as `provider_ref_id`) and later asks Flutterwave about that
 * reference, both when it checks the payment's status and when it binds
 * Flutterwave's webhook to the payment. The window must pay under the same
 * reference, or Reevit never learns the payer paid.
 */
export function flutterwaveTxRef(
  intent: { providerRefId?: string; reference?: string; id?: string } | null | undefined,
  fallback?: string
): string {
  const stored = intent?.providerRefId?.trim();
  if (stored && stored.startsWith('pf_')) return stored;
  return intent?.reference || fallback || intent?.id || `flw_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface FlutterwaveBridgeProps {
  publicKey: string;
  amount: number;
  currency?: string;
  reference?: string;
  /** The merchant's own reference, handed back in `onSuccess`. `reference` is what Flutterwave is charged under. */
  orderReference?: string;
  email: string;
  phone?: string;
  name?: string;
  paymentOptions?: string;
  title?: string;
  description?: string;
  logo?: string;
  metadata?: Record<string, unknown>;
  /** Flutterwave navigates here when done, instead of calling `onSuccess`. */
  redirectUrl?: string;
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
}

// Load Flutterwave script
function loadFlutterwaveScript(): Promise<void> {
  // The bridge component only calls this from an effect (never during SSR), but
  // it is also exported for manual initialization, so guard against non-browser
  // environments with a clear error instead of a cryptic ReferenceError.
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error('Reevit: Flutterwave script can only be loaded in a browser environment'),
    );
  }

  return new Promise((resolve, reject) => {
    if (window.FlutterwaveCheckout) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.flutterwave.com/v3.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Flutterwave script'));
    document.head.appendChild(script);
  });
}

export function FlutterwaveBridge({
  publicKey,
  amount,
  currency = 'GHS',
  reference,
  orderReference,
  email,
  phone,
  name,
  paymentOptions = 'card,mobilemoney,ussd',
  title,
  description,
  logo,
  metadata,
  redirectUrl,
  onSuccess,
  onError,
  onClose,
  autoStart = true,
}: FlutterwaveBridgeProps) {
  const initialized = useRef(false);

  const startPayment = useCallback(async () => {
    try {
      await loadFlutterwaveScript();

      if (!window.FlutterwaveCheckout) {
        throw new Error('Flutterwave checkout not available');
      }

      const txRef = reference || `flw_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      window.FlutterwaveCheckout({
        public_key: publicKey,
        tx_ref: txRef,
        amount: amount / 10 ** currencyExponent(currency), // Flutterwave expects major units
        currency,
        payment_options: paymentOptions,
        customer: {
          email,
          phone_number: phone,
          name,
        },
        customizations: {
          title,
          description,
          logo,
        },
        meta: metadata,
        // Flutterwave prefers redirect_url over callback, so send it only when asked.
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
        callback: (response: FlutterwaveResponse) => {
          if (response.status === 'successful') {
            const result: PaymentResult = {
              paymentId: response.transaction_id.toString(),
              reference: orderReference || response.tx_ref,
              amount: toMinorUnits(response.amount, response.currency),
              currency: response.currency,
              paymentMethod: response.payment_type === 'mobilemoney' ? 'mobile_money' : 'card',
              psp: 'flutterwave',
              pspReference: response.flw_ref,
              status: 'success',
              metadata: {
                charged_amount: response.charged_amount,
                payment_type: response.payment_type,
              },
            };
            onSuccess(result);
          } else {
            const error: PaymentError = {
              code: response.status === 'cancelled' ? 'CANCELLED' : 'PAYMENT_FAILED',
              message: response.status === 'cancelled' ? 'Payment was cancelled' : 'Payment failed',
              recoverable: true,
            };
            onError(error);
          }
        },
        onclose: () => {
          onClose();
        },
      });
    } catch (err) {
      const error: PaymentError = {
        code: 'PSP_ERROR',
        message: 'Failed to initialize Flutterwave',
        recoverable: true,
        originalError: err,
      };
      onError(error);
    }
  }, [
    publicKey,
    amount,
    currency,
    reference,
    orderReference,
    email,
    phone,
    name,
    paymentOptions,
    title,
    description,
    logo,
    metadata,
    redirectUrl,
    onSuccess,
    onError,
    onClose,
  ]);

  useEffect(() => {
    if (autoStart && !initialized.current) {
      initialized.current = true;
      startPayment();
    }
  }, [autoStart, startPayment]);

  return <LoadingState variant="line" title="Opening Flutterwave…" />;
}

export { loadFlutterwaveScript };
