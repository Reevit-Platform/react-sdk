/**
 * StripeBridge.tsx
 * React component for Stripe payment integration
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { LoadingState } from '../components/LoadingState';
import { Scope } from '../components/Scope';
import { formatMoney } from '../utils';

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

interface StripeInstance {
  elements: (options?: { clientSecret: string; appearance?: StripeAppearance }) => StripeElements;
  confirmPayment: (options: {
    elements: StripeElements;
    confirmParams?: { return_url?: string };
    redirect?: 'if_required';
  }) => Promise<{ error?: StripeError; paymentIntent?: { id: string; status: string } }>;
}

interface StripeElements {
  create: (type: 'payment' | 'card', options?: Record<string, unknown>) => StripeElement;
  getElement: (type: string) => StripeElement | null;
  submit: () => Promise<{ error?: StripeError }>;
}

interface StripeElement {
  mount: (selector: string | HTMLElement) => void;
  unmount: () => void;
  on: (event: string, handler: (e: any) => void) => void;
  destroy: () => void;
}

interface StripeError {
  type: string;
  message: string;
  code?: string;
}

interface StripeAppearance {
  theme?: 'stripe' | 'night' | 'flat';
  variables?: Record<string, string>;
  rules?: Record<string, Record<string, string>>;
}

export interface StripeBridgeProps {
  publishableKey: string;
  clientSecret: string;
  amount: number;
  currency: string;
  appearance?: StripeAppearance;
  /** Use the dark Ledger palette for Stripe Elements (ignored when `appearance` is set). */
  dark?: boolean;
  onSuccess: (result: { paymentIntentId: string; status: string }) => void;
  onError: (error: { code: string; message: string }) => void;
  onReady?: () => void;
  onCancel?: () => void;
}

const STRIPE_SCRIPT_URL = 'https://js.stripe.com/v3/';
let stripeScriptPromise: Promise<void> | null = null;

export function loadStripeScript(): Promise<void> {
  // The bridge component only calls this from an effect (never during SSR), but
  // it is also exported for manual initialization, so guard against non-browser
  // environments with a clear error instead of a cryptic ReferenceError. Do this
  // before the cached promise so the server never populates it.
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error('Reevit: Stripe.js can only be loaded in a browser environment'),
    );
  }

  if (stripeScriptPromise) return stripeScriptPromise;

  if (document.getElementById('stripe-js-script')) {
    stripeScriptPromise = Promise.resolve();
    return stripeScriptPromise;
  }

  stripeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'stripe-js-script';
    script.src = STRIPE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Stripe.js'));
    document.head.appendChild(script);
  });

  return stripeScriptPromise;
}

// Ledger-themed appearance for Stripe Elements: Inter-style type, ink on paper,
// 12px radius, 48px inputs and the checkout's own input border and focus ring.
// (Stripe renders in its own iframe, so it cannot load the bundled fonts; the
// system UI face is the closest match it can use.)
const getReevitStripeAppearance = (dark: boolean): StripeAppearance => {
  const ink = dark ? '#f4f3ee' : '#151513';
  const paper = dark ? '#1a1a18' : '#f4f3ee';
  const line = dark ? 'rgba(244, 243, 238, 0.14)' : '#d3d0c6';
  const lineStrong = dark ? 'rgba(244, 243, 238, 0.32)' : '#a8a69b';
  const field = dark ? 'rgba(244, 243, 238, 0.04)' : 'rgba(255, 255, 255, 0.6)';
  const muted = dark ? '#a3a29c' : '#6b6a64';

  return {
    theme: dark ? 'night' : 'flat',
    variables: {
      colorPrimary: ink,
      colorBackground: paper,
      colorText: ink,
      colorTextSecondary: muted,
      colorTextPlaceholder: dark ? '#6f6e69' : '#9a988f',
      colorDanger: '#ef4444',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      fontSizeBase: '16px',
      fontSizeSm: '13px',
      fontWeightNormal: '400',
      fontWeightMedium: '500',
      fontWeightBold: '600',
      borderRadius: '12px',
      spacingUnit: '4px',
      spacingGridRow: '16px',
      spacingGridColumn: '12px',
    },
    rules: {
      '.Input': {
        border: `1px solid ${line}`,
        boxShadow: 'none',
        padding: '14px',
        height: '48px',
        fontSize: '16px',
        backgroundColor: field,
      },
      '.Input:hover': { border: `1px solid ${lineStrong}` },
      '.Input:focus': {
        border: `1px solid ${ink}`,
        boxShadow: `0 0 0 1px ${ink}`,
        backgroundColor: field,
      },
      '.Input--invalid': {
        border: '1px solid #ef4444',
        boxShadow: '0 0 0 1px #ef4444',
      },
      '.Label': {
        fontSize: '13px',
        fontWeight: '500',
        marginBottom: '7px',
        color: dark ? '#d9d7cf' : '#3a3935',
      },
      '.Tab': {
        border: `1px solid ${line}`,
        backgroundColor: field,
        boxShadow: 'none',
      },
      '.Tab:hover': { border: `1px solid ${lineStrong}` },
      '.Tab--selected': {
        border: `1px solid ${ink}`,
        boxShadow: `0 0 0 1px ${ink}`,
        backgroundColor: field,
      },
      '.Block': {
        border: `1px solid ${line}`,
        backgroundColor: field,
        boxShadow: 'none',
      },
      '.CheckboxInput': { border: `1px solid ${line}` },
      '.CheckboxInput--checked': { backgroundColor: ink, borderColor: ink },
    },
  };
};

export function StripeBridge({
  publishableKey,
  clientSecret,
  amount,
  currency,
  appearance,
  dark = false,
  onSuccess,
  onError,
  onReady,
  onCancel,
}: StripeBridgeProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripeElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const initStripe = async () => {
      try {
        await loadStripeScript();

        if (!mounted || !window.Stripe) {
          throw new Error('Stripe not available');
        }

        stripeRef.current = window.Stripe(publishableKey);

        // Use provided appearance or fall back to Reevit default theme
        const stripeAppearance = appearance || getReevitStripeAppearance(dark);

        elementsRef.current = stripeRef.current.elements({
          clientSecret,
          appearance: stripeAppearance,
        });

        paymentElementRef.current = elementsRef.current.create('payment');

        if (containerRef.current) {
          paymentElementRef.current.mount(containerRef.current);
        }

        paymentElementRef.current.on('ready', () => {
          if (mounted) {
            setIsLoading(false);
            onReady?.();
          }
        });

        paymentElementRef.current.on('change', (event: any) => {
          if (event.error) {
            setError(event.error.message);
          } else {
            setError(null);
          }
        });
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to initialize Stripe';
          setError(message);
          setIsLoading(false);
          onError({ code: 'STRIPE_INIT_ERROR', message });
        }
      }
    };

    initStripe();

    return () => {
      mounted = false;
      paymentElementRef.current?.destroy();
    };
  }, [publishableKey, clientSecret, appearance, dark, onReady, onError]);

  const handleSubmit = useCallback(async () => {
    if (!stripeRef.current || !elementsRef.current) {
      onError({ code: 'NOT_INITIALIZED', message: 'Stripe not initialized' });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Validate the form first
      const { error: submitError } = await elementsRef.current.submit();
      if (submitError) {
        setError(submitError.message);
        onError({ code: submitError.code || 'VALIDATION_ERROR', message: submitError.message });
        setIsSubmitting(false);
        return;
      }

      // Confirm the payment
      const { error: confirmError, paymentIntent } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
      });

      if (confirmError) {
        setError(confirmError.message);
        onError({ code: confirmError.code || 'PAYMENT_ERROR', message: confirmError.message });
      } else if (paymentIntent) {
        onSuccess({
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      setError(message);
      onError({ code: 'UNKNOWN_ERROR', message });
    } finally {
      setIsSubmitting(false);
    }
  }, [onSuccess, onError]);

  const formattedAmount = formatMoney(amount, currency);

  return (
    <Scope dark={dark}>
      <div className="reevit-stripe-bridge" data-reevit="stripe">
        {isLoading && <LoadingState variant="line" title="Opening Stripe…" />}

        <div
          ref={containerRef}
          className="reevit-stripe-element"
          style={{ display: isLoading ? 'none' : 'block' }}
        />

        {error && !isLoading && (
          <p className="reevit-error" role="alert">{error}</p>
        )}

        {!isLoading && (
          <>
            <button
              type="button"
              className="reevit-cta"
              data-reevit="cta"
              onClick={handleSubmit}
              disabled={isLoading || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="reevit-spin" aria-hidden="true" />
                  <span>Processing…</span>
                </>
              ) : (
                <>Pay {formattedAmount}</>
              )}
            </button>

            {onCancel && (
              <button
                type="button"
                className="reevit-cta-secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </Scope>
  );
}
