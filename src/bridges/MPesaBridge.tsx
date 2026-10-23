/**
 * MPesaBridge.tsx
 * React component for M-Pesa STK Push (Kenya/Tanzania).
 *
 * Creating the payment is what sends the STK push: the server pushes the prompt
 * to the number the payment was created with. This bridge only waits. It polls
 * the public confirm-intent route and ends the flow on `succeeded` or on a
 * final failure, never on `pending`.
 *
 * Phase 0 stopgap: replaced by the Phase 1 status endpoint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReevitAPIClient } from '@reevit/core';
import { Scope } from '../components/Scope';
import { pollPaymentStatus } from '../utils/pollPaymentStatus';

/** Poll every 4 s, and give up after 2 min (the prompt expires on the handset around then). */
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 120_000;

export interface MPesaBridgeProps {
  /** The payment the STK push was sent for. */
  paymentId: string;
  /** The payment's client secret, for the public confirm-intent route. */
  clientSecret?: string;
  /** Public key, used only when there is no client secret. */
  publicKey?: string;
  /** API base URL (defaults to production). */
  apiBaseUrl?: string;
  /** Customer phone number in format 254XXXXXXXXX */
  phoneNumber: string;
  /** Merchant order reference, passed back with the result. */
  reference?: string;
  /** Called once the payment has succeeded. */
  onSuccess: (result: { transactionId: string; reference: string; pspReference: string }) => void;
  /** Called when the payment fails or no approval arrives in time. */
  onError: (error: { code: string; message: string; recoverable: boolean }) => void;
  /** Starts a new prompt to the same number. Shown as "Try again" on the failure panel. */
  onRetry?: () => void;
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

type Failure = { kind: 'declined' | 'timeout' };

const FAILURE_COPY: Record<Failure['kind'], { title: string; message: string; code: string }> = {
  declined: {
    title: 'Payment not approved',
    message: 'The M-Pesa request was declined or cancelled.',
    code: 'PAYMENT_DECLINED',
  },
  timeout: {
    title: 'No response in time',
    message: 'We didn’t get an approval from your phone.',
    code: 'PAYMENT_TIMEOUT',
  },
};

export function MPesaBridge({
  paymentId,
  clientSecret,
  publicKey,
  apiBaseUrl,
  phoneNumber,
  reference,
  onSuccess,
  onError,
  onRetry,
  onChangeNumber,
}: MPesaBridgeProps) {
  const [failure, setFailure] = useState<Failure | null>(null);

  // The effect below must restart only when the payment changes, not on every render.
  const callbacks = useRef({ onSuccess, onError });
  callbacks.current = { onSuccess, onError };

  useEffect(() => {
    const controller = new AbortController();
    const client = new ReevitAPIClient({ publicKey, baseUrl: apiBaseUrl });

    void pollPaymentStatus({
      check: () => (clientSecret ? client.confirmPaymentIntent(paymentId, clientSecret) : client.confirmPayment(paymentId)),
      signal: controller.signal,
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
    }).then((outcome) => {
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'succeeded') {
        const pspReference = (outcome.data.provider_ref_id as string | undefined) || paymentId;
        callbacks.current.onSuccess({ transactionId: pspReference, reference: reference || '', pspReference });
        return;
      }
      const kind: Failure['kind'] = outcome.kind === 'timeout' ? 'timeout' : 'declined';
      setFailure({ kind });
      callbacks.current.onError({ code: FAILURE_COPY[kind].code, message: FAILURE_COPY[kind].message, recoverable: true });
    });

    return () => controller.abort();
  }, [paymentId, clientSecret, publicKey, apiBaseUrl, reference]);

  const shownPhone = formatKenyaPhone(phoneNumber);

  if (failure) {
    const copy = FAILURE_COPY[failure.kind];
    return (
      <Scope>
        <div className="reevit-result" data-reevit="failure" data-failure={failure.kind}>
          <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
            <span className="reevit-fail-dot" aria-hidden="true" />
            {copy.title}
          </h2>
          <p className="reevit-text">{copy.message}</p>
          {onRetry && (
            <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={onRetry}>Try again</button>
          )}
          {onChangeNumber && (
            <button type="button" className="reevit-cta-secondary" onClick={onChangeNumber}>Use another number</button>
          )}
        </div>
      </Scope>
    );
  }

  return (
    <Scope>
      <div className="reevit-wait" data-reevit="mpesa-waiting" data-payment-id={paymentId}>
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
