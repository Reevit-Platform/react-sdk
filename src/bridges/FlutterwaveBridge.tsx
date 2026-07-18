/**
 * Flutterwave Bridge
 * Handles integration with Flutterwave payment modal
 */

import { useEffect, useCallback, useRef } from 'react';
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

interface FlutterwaveBridgeProps {
  publicKey: string;
  amount: number;
  currency?: string;
  reference?: string;
  email: string;
  phone?: string;
  name?: string;
  paymentOptions?: string;
  title?: string;
  description?: string;
  logo?: string;
  metadata?: Record<string, unknown>;
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
  email,
  phone,
  name,
  paymentOptions = 'card,mobilemoney,ussd',
  title,
  description,
  logo,
  metadata,
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
        amount: amount / 100, // Flutterwave expects amount in major units
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
        callback: (response: FlutterwaveResponse) => {
          if (response.status === 'successful') {
            const result: PaymentResult = {
              paymentId: response.transaction_id.toString(),
              reference: response.tx_ref,
              amount: Math.round(response.amount * 100),
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
    email,
    phone,
    name,
    paymentOptions,
    title,
    description,
    logo,
    metadata,
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

  return <LoadingState marker="PAYMENT GATEWAY" title="Connecting to Flutterwave" />;
}

export { loadFlutterwaveScript };
