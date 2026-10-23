/**
 * MPesaBridge.tsx
 * React component for M-Pesa STK Push integration (Kenya/Tanzania)
 * 
 * Note: M-Pesa uses server-to-server STK Push initiated by the backend.
 * This component handles the UI flow while the customer approves on their phone.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { LoadingState } from '../components/LoadingState';
import { Scope } from '../components/Scope';

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
  /** Send the STK Push on mount instead of waiting for the "Send payment request" button. */
  autoStart?: boolean;
  /** Shows a "Use another number" action while waiting or after a failure. */
  onChangeNumber?: () => void;
}

/** 254722334455 -> "+254 722 334 455". Anything else is shown as given. */
function formatKenyaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) {
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return phone;
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
  autoStart = false,
  onChangeNumber,
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

  // The checkout has already collected the number on its own screen, so it
  // starts the push straight away instead of asking for a second tap.
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      initiateSTKPush();
    }
  }, [autoStart, initiateSTKPush]);

  const shownPhone = formatKenyaPhone(phoneNumber);

  // Idle state - show initiate button
  if (state === 'idle') {
    return (
      <Scope>
        <div className="reevit-wait" data-reevit="bridge-idle">
          <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">Pay with M-Pesa</h2>
          <p className="reevit-text">
            We’ll send a prompt to <span className="reevit-mono">{shownPhone}</span>.
          </p>
          <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={initiateSTKPush}>
            Send payment request
          </button>
        </div>
      </Scope>
    );
  }

  // Initiating state - show loading
  if (state === 'initiating') {
    return <LoadingState variant="line" title="Sending a prompt to your phone…" />;
  }

  // Waiting state - customer should check their phone
  if (state === 'waiting') {
    return (
      <Scope>
        <div className="reevit-wait" data-reevit="mpesa-waiting" data-request-id={checkoutRequestId ?? undefined}>
          <span className="reevit-spin reevit-spin--lg" aria-hidden="true" />
          <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">Approve on your phone</h2>
          <p className="reevit-text">
            Check <span className="reevit-mono">{shownPhone}</span> for an M-Pesa prompt.
          </p>
          <p className="reevit-status" data-reevit="status" role="status" aria-live="polite">Waiting for your approval…</p>
          {onChangeNumber && (
            <div className="reevit-links">
              <button type="button" className="reevit-link" data-reevit="change-number" onClick={onChangeNumber}>Use another number</button>
            </div>
          )}
        </div>
      </Scope>
    );
  }

  // Failed state - show error and retry
  if (state === 'failed') {
    return (
      <Scope>
        <div className="reevit-result" data-reevit="failure">
          <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
            <span className="reevit-fail-dot" aria-hidden="true" />
            Payment request failed
          </h2>
          <p className="reevit-text">{error || 'Something went wrong. Please try again.'}</p>
          <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={handleRetry}>Try again</button>
          {onChangeNumber && (
            <button type="button" className="reevit-cta-secondary" onClick={onChangeNumber}>Use another number</button>
          )}
        </div>
      </Scope>
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
