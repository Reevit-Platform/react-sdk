/**
 * MPesaBridge.tsx
 * React component for M-Pesa STK Push integration (Kenya/Tanzania)
 * 
 * Note: M-Pesa uses server-to-server STK Push initiated by the backend.
 * This component handles the UI flow while the customer approves on their phone.
 */

import { useState, useCallback } from 'react';
import { LoadingState } from '../components/LoadingState';

export interface MPesaBridgeProps {
  /** API endpoint to initiate STK Push (your backend) */
  apiEndpoint: string;
  /** Customer phone number in format 254XXXXXXXXX */
  phoneNumber: string;
  /** Amount to charge */
  amount: number;
  /** Currency (KES or TZS) */
  currency: string;
  /** Unique transaction reference */
  reference: string;
  /** Payment description */
  description?: string;
  /** Called when STK Push is successfully sent */
  onInitiated?: (checkoutRequestId: string) => void;
  /** Called when payment is confirmed (via webhook/polling) */
  onSuccess: (result: { transactionId: string; reference: string }) => void;
  /** Called on error */
  onError: (error: { code: string; message: string }) => void;
  /** Custom headers for API calls (e.g., authorization) */
  headers?: Record<string, string>;
}

type MPesaState = 'idle' | 'initiating' | 'waiting' | 'success' | 'failed';

export function MPesaBridge({
  apiEndpoint,
  phoneNumber,
  amount,
  currency,
  reference,
  description,
  onInitiated,
  onSuccess,
  onError,
  headers = {},
}: MPesaBridgeProps) {
  const [state, setState] = useState<MPesaState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);

  const initiateSTKPush = useCallback(async () => {
    setState('initiating');
    setError(null);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          amount,
          currency,
          reference,
          description: description || `Payment ${reference}`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed: ${response.status}`);
      }

      const data = await response.json();
      const requestId = data.checkout_request_id || data.checkoutRequestId || data.transaction_id;

      setCheckoutRequestId(requestId);
      setState('waiting');
      onInitiated?.(requestId);

      // Note: Success will come via webhook or polling on parent component
      // This bridge just handles the UI for initiating the push
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate M-Pesa payment';
      setError(message);
      setState('failed');
      onError({ code: 'MPESA_INIT_ERROR', message });
    }
  }, [apiEndpoint, phoneNumber, amount, currency, reference, description, headers, onInitiated, onError]);

  const handleRetry = useCallback(() => {
    setState('idle');
    setError(null);
    initiateSTKPush();
  }, [initiateSTKPush]);

  // Idle state - show initiate button
  if (state === 'idle') {
    return (
      <div className="reevit-brut__state">
        <span className="reevit-brut__state-marker">PAYMENT GATEWAY</span>
        <div className="reevit-brut__icon-box">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <path d="M10.5 18.5h3" />
          </svg>
        </div>
        <h3 className="reevit-brut__state-title">Pay with M-Pesa</h3>
        <p className="reevit-brut__state-sub">
          You'll get a prompt on your phone to authorize the payment
        </p>
        <div className="reevit-brut__phone">{phoneNumber}</div>
        <button type="button" className="reevit-brut__cta" onClick={initiateSTKPush}>
          <span>SEND PAYMENT REQUEST</span>
          <span>&rarr;</span>
        </button>
      </div>
    );
  }

  // Initiating state - show loading
  if (state === 'initiating') {
    return (
      <LoadingState
        marker="PAYMENT GATEWAY"
        title="Connecting to M-Pesa"
        message="Sending a payment request to your phone"
      />
    );
  }

  // Waiting state - customer should check their phone
  if (state === 'waiting') {
    return (
      <div className="reevit-brut__state">
        <span className="reevit-brut__state-marker">AWAITING CONFIRMATION</span>
        <div className="reevit-brut__bars">
          <span /><span /><span /><span /><span />
        </div>
        <h3 className="reevit-brut__state-title">Check your phone</h3>
        <p className="reevit-brut__state-sub">
          A payment request was sent to {phoneNumber}
        </p>
        <ol className="reevit-brut__steps">
          <li>Open the M-Pesa prompt on your phone</li>
          <li>Enter your M-Pesa PIN to authorize</li>
          <li>Wait for confirmation</li>
        </ol>
        {checkoutRequestId && (
          <div className="reevit-brut__phone">REF: {checkoutRequestId}</div>
        )}
      </div>
    );
  }

  // Failed state - show error and retry
  if (state === 'failed') {
    return (
      <div className="reevit-brut__state">
        <span className="reevit-brut__state-marker">DECLINED</span>
        <div className="reevit-brut__error-block">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
        <h3 className="reevit-brut__state-title">Payment request failed</h3>
        <p className="reevit-brut__state-sub">
          {error || 'Something went wrong. Please try again.'}
        </p>
        <button
          type="button"
          className="reevit-brut__cta"
          style={{ maxWidth: 260 }}
          onClick={handleRetry}
        >
          <span>TRY AGAIN</span>
          <span>&#8635;</span>
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Hook for M-Pesa payment status polling
 * Use this to check payment status after STK Push is initiated
 */
export function useMPesaStatusPolling(
  statusEndpoint: string,
  checkoutRequestId: string | null,
  options: {
    interval?: number;
    maxAttempts?: number;
    headers?: Record<string, string>;
    onSuccess: (result: { transactionId: string }) => void;
    onFailed: (error: { message: string }) => void;
    onTimeout: () => void;
  }
) {
  const { interval = 5000, maxAttempts = 24, headers = {}, onSuccess, onFailed, onTimeout } = options;

  const startPolling = useCallback(async () => {
    if (!checkoutRequestId) return;

    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        onTimeout();
        return;
      }

      try {
        const response = await fetch(`${statusEndpoint}?checkout_request_id=${checkoutRequestId}`, {
          headers,
        });

        if (!response.ok) {
          attempts++;
          setTimeout(poll, interval);
          return;
        }

        const data = await response.json();

        if (data.status === 'success' || data.status === 'completed') {
          onSuccess({ transactionId: data.transaction_id || data.mpesa_receipt });
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          onFailed({ message: data.message || 'Payment failed or was cancelled' });
        } else {
          // Still pending, continue polling
          attempts++;
          setTimeout(poll, interval);
        }
      } catch {
        attempts++;
        setTimeout(poll, interval);
      }
    };

    poll();
  }, [checkoutRequestId, statusEndpoint, interval, maxAttempts, headers, onSuccess, onFailed, onTimeout]);

  return { startPolling };
}
