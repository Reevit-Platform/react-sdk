/**
 * MonnifyBridge.tsx
 * React component for Monnify payment integration (Nigeria)
 */

import { useEffect, useCallback, useState } from 'react';

declare global {
  interface Window {
    MonnifySDK?: {
      initialize: (config: MonnifyConfig) => void;
    };
  }
}

interface MonnifyConfig {
  amount: number;
  currency: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  customerMobileNumber?: string;
  apiKey: string;
  contractCode: string;
  paymentDescription?: string;
  isTestMode?: boolean;
  metadata?: Record<string, unknown>;
  onComplete: (response: MonnifyResponse) => void;
  onClose: () => void;
}

interface MonnifyResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  message: string;
  transactionReference: string;
  paymentReference: string;
  authorizedAmount?: number;
  paymentStatus?: string;
}

export interface MonnifyBridgeProps {
  apiKey: string;
  contractCode: string;
  amount: number;
  currency: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paymentDescription?: string;
  isTestMode?: boolean;
  metadata?: Record<string, unknown>;
  autoOpen?: boolean;
  onSuccess: (result: {
    transactionReference: string;
    paymentReference: string;
    amount: number;
  }) => void;
  onError: (error: { code: string; message: string }) => void;
  onClose?: () => void;
}

const MONNIFY_SCRIPT_URL = 'https://sdk.monnify.com/plugin/monnify.js';
let monnifyScriptPromise: Promise<void> | null = null;

export function loadMonnifyScript(): Promise<void> {
  if (monnifyScriptPromise) return monnifyScriptPromise;

  if (document.getElementById('monnify-sdk-script')) {
    monnifyScriptPromise = Promise.resolve();
    return monnifyScriptPromise;
  }

  monnifyScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'monnify-sdk-script';
    script.src = MONNIFY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Monnify SDK'));
    document.head.appendChild(script);
  });

  return monnifyScriptPromise;
}

export function MonnifyBridge({
  apiKey,
  contractCode,
  amount,
  currency,
  reference,
  customerName,
  customerEmail,
  customerPhone,
  paymentDescription,
  isTestMode = false,
  metadata,
  autoOpen = true,
  onSuccess,
  onError,
  onClose,
}: MonnifyBridgeProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const openMonnify = useCallback(async () => {
    try {
      await loadMonnifyScript();

      if (!window.MonnifySDK) {
        throw new Error('Monnify SDK not available');
      }

      window.MonnifySDK.initialize({
        amount,
        currency: currency || 'NGN',
        reference,
        customerName,
        customerEmail,
        customerMobileNumber: customerPhone,
        apiKey,
        contractCode,
        paymentDescription: paymentDescription || 'Payment',
        isTestMode,
        metadata,
        onComplete: (response: MonnifyResponse) => {
          if (response.status === 'SUCCESS') {
            onSuccess({
              transactionReference: response.transactionReference,
              paymentReference: response.paymentReference,
              amount: response.authorizedAmount || amount,
            });
          } else {
            onError({
              code: 'MONNIFY_PAYMENT_FAILED',
              message: response.message || 'Payment was not successful',
            });
          }
        },
        onClose: () => {
          onClose?.();
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open Monnify';
      onError({ code: 'MONNIFY_INIT_ERROR', message });
    }
  }, [
    amount, currency, reference, customerName, customerEmail, customerPhone,
    apiKey, contractCode, paymentDescription, isTestMode, metadata,
    onSuccess, onError, onClose
  ]);

  useEffect(() => {
    const init = async () => {
      try {
        await loadMonnifyScript();
        setIsReady(true);
        setIsLoading(false);

        if (autoOpen) {
          openMonnify();
        }
      } catch (err) {
        setIsLoading(false);
        const message = err instanceof Error ? err.message : 'Failed to load Monnify';
        onError({ code: 'MONNIFY_LOAD_ERROR', message });
      }
    };

    init();
  }, [autoOpen, openMonnify, onError]);

  if (isLoading) {
    return (
      <div className="reevit-monnify-bridge">
        <div className="reevit-monnify-loading">
          <div className="reevit-spinner" />
          <p>Loading Monnify checkout...</p>
        </div>
      </div>
    );
  }

  if (!autoOpen && isReady) {
    return (
      <div className="reevit-monnify-bridge">
        <button
          type="button"
          className="reevit-submit-btn"
          onClick={openMonnify}
        >
          Pay with Monnify
        </button>
      </div>
    );
  }

  return null;
}
