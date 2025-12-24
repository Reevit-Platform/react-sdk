/**
 * MPesaBridge.tsx
 * React component for M-Pesa STK Push integration (Kenya/Tanzania)
 * 
 * Note: M-Pesa uses server-to-server STK Push initiated by the backend.
 * This component handles the UI flow while the customer approves on their phone.
 */

import { useState, useCallback } from 'react';

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
      <div className="reevit-mpesa-bridge">
        <div className="reevit-mpesa-info">
          <div className="reevit-mpesa-icon">📱</div>
          <h3>Pay with M-Pesa</h3>
          <p>You will receive a prompt on your phone to complete the payment.</p>
          <p className="reevit-mpesa-phone">Phone: {phoneNumber}</p>
        </div>
        <button
          type="button"
          className="reevit-submit-btn reevit-mpesa-btn"
          onClick={initiateSTKPush}
        >
          Send Payment Request
        </button>
      </div>
    );
  }

  // Initiating state - show loading
  if (state === 'initiating') {
    return (
      <div className="reevit-mpesa-bridge">
        <div className="reevit-mpesa-loading">
          <div className="reevit-spinner reevit-spinner--large" />
          <p>Sending payment request to your phone...</p>
        </div>
      </div>
    );
  }

  // Waiting state - customer should check their phone
  if (state === 'waiting') {
    return (
      <div className="reevit-mpesa-bridge">
        <div className="reevit-mpesa-waiting">
          <div className="reevit-mpesa-phone-icon">📲</div>
          <h3>Check Your Phone</h3>
          <p>
            An M-Pesa payment request has been sent to <strong>{phoneNumber}</strong>.
          </p>
          <ol className="reevit-mpesa-steps">
            <li>Check for the M-Pesa prompt on your phone</li>
            <li>Enter your M-Pesa PIN to authorize</li>
            <li>Wait for confirmation</li>
          </ol>
          <div className="reevit-mpesa-waiting-indicator">
            <div className="reevit-spinner" />
            <span>Waiting for payment confirmation...</span>
          </div>
          {checkoutRequestId && (
            <p className="reevit-mpesa-ref">Request ID: {checkoutRequestId}</p>
          )}
        </div>
      </div>
    );
  }

  // Failed state - show error and retry
  if (state === 'failed') {
    return (
      <div className="reevit-mpesa-bridge">
        <div className="reevit-mpesa-error">
          <div className="reevit-error-icon">⚠️</div>
          <h3>Payment Request Failed</h3>
          <p>{error || 'Something went wrong. Please try again.'}</p>
          <button
            type="button"
            className="reevit-retry-btn"
            onClick={handleRetry}
          >
            Try Again
          </button>
        </div>
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
