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
  phone?: string;
  amount?: number;
  currency?: string;
  ref?: string;
  access_code?: string;
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
  phone?: string;
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
  phone,
  amount,
  currency = 'GHS',
  reference,
  accessCode,
  metadata,
  channels = ['card', 'mobile_money'],
  onSuccess,
  onError,
  onClose,
  autoStart = true,
}: PaystackBridgeProps) {
  const initialized = useRef(false);

  const startPayment = useCallback(async () => {
    try {
      console.log('[PaystackBridge] Starting payment', {
        hasPublicKey: !!publicKey,
        email,
        amount,
        reference,
        hasAccessCode: !!accessCode,
      });

      // Validate required parameters before attempting to load Paystack
      if (!publicKey) {
        throw new Error('Paystack public key is required but was empty');
      }
      if (!email && !accessCode) {
        throw new Error('Email is required for Paystack payments when no access code is provided');
      }
      if (!amount && !accessCode) {
        throw new Error('Valid amount is required for Paystack payments when no access code is provided');
      }

      await loadPaystackScript();

      if (!window.PaystackPop) {
        throw new Error('Paystack script loaded but PaystackPop not available');
      }

      const setupConfig: PaystackConfig = {
        key: publicKey,
        email,
        phone,
        amount,
        currency,
        ref: reference,
        access_code: accessCode,
        metadata,
        channels,
        callback: (response: PaystackResponse) => {
          console.log('[PaystackBridge] Callback received', response);
          // Determine the payment method used
          let usedMethod: any = 'card';
          if (channels && channels.length === 1) {
            usedMethod = channels[0];
          } else if (response.message?.toLowerCase().includes('mobile money')) {
            usedMethod = 'mobile_money';
          }

          const result: PaymentResult = {
            paymentId: response.reference, // Use the reference as paymentId because we set it to Reevit's UUID
            reference: response.reference,
            amount,
            currency,
            paymentMethod: usedMethod,
            psp: 'paystack',
            pspReference: response.transaction, // Paystack's internal transaction ID
            status: response.status === 'success' ? 'success' : 'pending',
            metadata: {
              ...response,
              trxref: response.trxref,
              paystack_transaction_id: response.transaction,
              paystack_trans: response.trans
            },
          };
          onSuccess(result);
        },
        onClose: () => {
          console.log('[PaystackBridge] Modal closed');
          onClose();
        },
      };

      const handler = window.PaystackPop.setup(setupConfig);

      handler.openIframe();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize Paystack';
      const error: PaymentError = {
        code: 'PSP_ERROR',
        message: errorMessage,
        recoverable: true,
        originalError: err,
      };
      onError(error);
    }
  }, [publicKey, email, amount, currency, reference, accessCode, metadata, channels, onSuccess, onError, onClose]);

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