/**
 * Paystack Bridge
 * Handles integration with Paystack popup checkout
 */

import { useEffect, useCallback, useRef } from 'react';
import type { PaymentResult, PaymentError } from '../types';

declare global {
  interface Window {
    PaystackPop?: PaystackPopupInterface;
  }
}

interface PaystackPopupInterface {
  setup: (config: PaystackConfig) => { openIframe: () => void };
}

interface PaystackConfig {
  key: string;
  email: string;
  amount: number;
  currency?: string;
  ref?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
  callback: (response: PaystackResponse) => void;
  onClose: () => void;
}

interface PaystackResponse {
  reference: string;
  trans: string;
  status: string;
  message: string;
  transaction: string;
  trxref: string;
}

interface PaystackBridgeProps {
  publicKey: string;
  email: string;
  amount: number;
  currency?: string;
  reference?: string;
  accessCode?: string;
  metadata?: Record<string, unknown>;
  channels?: ('card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer')[];
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
}

// Load Paystack script
function loadPaystackScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PaystackPop) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paystack script'));
    document.head.appendChild(script);
  });
}

export function PaystackBridge({
  publicKey,
  email,
  amount,
  currency = 'GHS',
  reference,
  metadata,
  channels = ['card', 'mobile_money'],
  onSuccess,
  onError,
  onClose,
  autoStart = true,
  accessCode, // Destructure accessCode
}: PaystackBridgeProps) {
  const initialized = useRef(false);

  const startPayment = useCallback(async () => {
    try {
      await loadPaystackScript();

      if (!window.PaystackPop) {
        throw new Error('Paystack not available');
      }

      // Modern Paystack V2 API
      const paystack = new (window.PaystackPop as any)();

      if (accessCode) {
        // If we have an access code from the server, use it to resume the transaction
        paystack.resumeTransaction(accessCode, {
          callback: (response: PaystackResponse) => {
            const result: PaymentResult = {
              paymentId: response.transaction,
              reference: response.reference,
              amount,
              currency,
              paymentMethod: 'card',
              psp: 'paystack',
              pspReference: response.trans,
              status: response.status === 'success' ? 'success' : 'pending',
              metadata: { trxref: response.trxref },
            };
            onSuccess(result);
          },
          onCancel: () => {
            onClose();
          },
          onError: (err: any) => {
            const error: PaymentError = {
              code: 'PSP_ERROR',
              message: err?.message || 'Paystack checkout error',
              recoverable: true,
              originalError: err,
            };
            onError(error);
          }
        });
        return;
      }

      // Fallback to V1 setup if no accessCode (for client-side only flows)
      const handler = (window.PaystackPop as any).setup({
        key: publicKey,
        email,
        amount, // Paystack expects amount in kobo/pesewas (smallest unit)
        currency,
        ref: reference,
        metadata,
        channels,
        callback: (response: PaystackResponse) => {
          const result: PaymentResult = {
            paymentId: response.transaction,
            reference: response.reference,
            amount,
            currency,
            paymentMethod: 'card', // Paystack handles this internally
            psp: 'paystack',
            pspReference: response.trans,
            status: response.status === 'success' ? 'success' : 'pending',
            metadata: { trxref: response.trxref },
          };
          onSuccess(result);
        },
        onClose: () => {
          onClose();
        },
      });

      handler.openIframe();
    } catch (err) {
      const error: PaymentError = {
        code: 'PSP_ERROR',
        message: 'Failed to initialize Paystack',
        recoverable: true,
        originalError: err,
      };
      onError(error);
    }
  }, [publicKey, email, amount, currency, reference, metadata, channels, onSuccess, onError, onClose]);

  useEffect(() => {
    if (autoStart && !initialized.current) {
      initialized.current = true;
      startPayment();
    }
  }, [autoStart, startPayment]);

  return (
    <div className="reevit-psp-bridge reevit-psp-bridge--paystack">
      <div className="reevit-psp-bridge__loading">
        <div className="reevit-spinner" />
        <p>Connecting to Paystack...</p>
      </div>
    </div>
  );
}

// Export utility for manual initialization
export { loadPaystackScript };
