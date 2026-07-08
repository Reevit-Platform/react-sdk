/**
 * Paystack Bridge
 * Handles integration with Paystack popup checkout
 */

import { useEffect, useCallback, useRef } from 'react';
import type { PaymentResult, PaymentError } from '../types';
import { LoadingState } from '../components/LoadingState';

declare global {
  interface Window {
    PaystackPop?: PaystackPopConstructor;
  }
}

// Paystack Inline v2 (js.paystack.co/v2/inline.js). The v1-style
// `PaystackPop.setup()` compat shim SILENTLY DROPS unknown keys — including
// snake_case `access_code` (v2 only recognises camelCase `accessCode`) — so a
// setup() call with an access code creates a brand-new transaction instead of
// resuming the backend-initialized one. Always use the v2 instance API.
interface PaystackPopConstructor {
  new (): PaystackPopInstance;
}

interface PaystackPopInstance {
  newTransaction: (config: PaystackTransactionConfig) => void;
  resumeTransaction: (accessCode: string, callbacks?: PaystackCallbacks) => void;
}

interface PaystackCallbacks {
  onSuccess?: (response: PaystackResponse) => void;
  onCancel?: () => void;
  onError?: (error: { message?: string }) => void;
}

interface PaystackTransactionConfig extends PaystackCallbacks {
  key: string;
  email: string;
  phone?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
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
  // The bridge component only calls this from an effect (never during SSR), but
  // it is also exported for manual initialization, so guard against non-browser
  // environments with a clear error instead of a cryptic ReferenceError.
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error('Reevit: Paystack script can only be loaded in a browser environment'),
    );
  }

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

      // Validate required parameters before attempting to load Paystack.
      // With an access code the transaction already exists at Paystack, so the
      // popup only needs the code itself — key/email/amount live server-side.
      if (!publicKey && !accessCode) {
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

      const handleTransactionComplete = (response: PaystackResponse) => {
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
      };

      const callbacks: PaystackCallbacks = {
        onSuccess: handleTransactionComplete,
        onCancel: () => {
          console.log('[PaystackBridge] Modal closed');
          onClose();
        },
        onError: (err) => {
          onError({
            code: 'PSP_ERROR',
            message: err?.message || 'Paystack checkout failed',
            recoverable: true,
            originalError: err,
          });
        },
      };

      const popup = new window.PaystackPop();

      if (accessCode) {
        // Resume the transaction the Reevit backend initialized — this is what
        // ties the popup charge to the payment the backend polls/verifies.
        // (Passing snake_case `access_code` through setup() is silently
        // ignored by inline v2 and mints an unrelated transaction.)
        popup.resumeTransaction(accessCode, callbacks);
      } else {
        popup.newTransaction({
          key: publicKey,
          email,
          phone,
          amount,
          currency,
          reference,
          metadata,
          channels,
          ...callbacks,
        });
      }
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

  return <LoadingState marker="PAYMENT GATEWAY" title="Connecting to Paystack" />;
}

// Export utility for manual initialization
export { loadPaystackScript };