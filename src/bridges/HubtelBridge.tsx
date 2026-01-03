/**
 * Hubtel Bridge
 * Handles integration with Hubtel payment popup
 */

import { useEffect, useCallback, useRef } from 'react';
import type { PaymentResult, PaymentError } from '../types';

declare global {
  interface Window {
    HubtelCheckout?: HubtelCheckoutInterface;
  }
}

interface HubtelCheckoutInterface {
  initPayment: (config: HubtelConfig) => void;
}

interface HubtelConfig {
  merchantAccount: string;
  basicDescription: string;
  totalAmount: number;
  currency: string;
  clientReference: string;
  customerEmail?: string;
  customerMsisdn?: string;
  callbackUrl?: string;
  onComplete?: (response: HubtelResponse) => void;
  onCancel?: () => void;
}

interface HubtelResponse {
  status: 'Success' | 'Failed' | 'Cancelled';
  transactionId: string;
  clientReference: string;
  amount: number;
  currency: string;
  message?: string;
}

interface HubtelBridgeProps {
  merchantAccount: string;
  amount: number;
  currency?: string;
  reference?: string;
  email?: string;
  phone?: string;
  description?: string;
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
}

// Load Hubtel script
function loadHubtelScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.HubtelCheckout) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout-v3.hubtel.com/js/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Hubtel script'));
    document.head.appendChild(script);
  });
}

export function HubtelBridge({
  merchantAccount,
  amount,
  currency = 'GHS',
  reference,
  email,
  phone,
  description = 'Payment',
  onSuccess,
  onError,
  onClose,
  autoStart = true,
}: HubtelBridgeProps) {
  const initialized = useRef(false);

  const startPayment = useCallback(async () => {
    try {
      await loadHubtelScript();

      if (!window.HubtelCheckout) {
        throw new Error('Hubtel checkout not available');
      }

      window.HubtelCheckout.initPayment({
        merchantAccount,
        basicDescription: description,
        totalAmount: amount / 100, // Hubtel expects amount in major units (GHS, not pesewas)
        currency,
        clientReference: reference || `hubtel_${Date.now()}`,
        customerEmail: email,
        customerMsisdn: phone,
        onComplete: (response: HubtelResponse) => {
          if (response.status === 'Success') {
            const result: PaymentResult = {
              paymentId: response.transactionId,
              reference: response.clientReference,
              amount: Math.round(response.amount * 100), // Convert back to pesewas
              currency: response.currency,
              paymentMethod: 'mobile_money',
              psp: 'hubtel',
              pspReference: response.transactionId,
              status: 'success',
            };
            onSuccess(result);
          } else {
            const error: PaymentError = {
              code: 'PAYMENT_FAILED',
              message: response.message || 'Payment failed',
              recoverable: true,
            };
            onError(error);
          }
        },
        onCancel: () => {
          onClose();
        },
      });
    } catch (err) {
      const error: PaymentError = {
        code: 'PSP_ERROR',
        message: 'Failed to initialize Hubtel',
        recoverable: true,
        originalError: err,
      };
      onError(error);
    }
  }, [merchantAccount, amount, currency, reference, email, phone, description, onSuccess, onError, onClose]);

  useEffect(() => {
    if (autoStart && !initialized.current) {
      initialized.current = true;
      startPayment();
    }
  }, [autoStart, startPayment]);

  return (
    <div className="reevit-psp-bridge reevit-psp-bridge--hubtel">
      <div className="reevit-psp-bridge__loading">
        <div className="reevit-spinner" />
        <p>Connecting to Hubtel...</p>
      </div>
    </div>
  );
}

export { loadHubtelScript };
