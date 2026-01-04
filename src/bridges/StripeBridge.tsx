/**
 * StripeBridge.tsx
 * React component for Stripe payment integration
 */

import { useEffect, useState, useCallback, useRef } from 'react';

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
  onSuccess: (result: { paymentIntentId: string; status: string }) => void;
  onError: (error: { code: string; message: string }) => void;
  onReady?: () => void;
  onCancel?: () => void;
}

const STRIPE_SCRIPT_URL = 'https://js.stripe.com/v3/';
let stripeScriptPromise: Promise<void> | null = null;

export function loadStripeScript(): Promise<void> {
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

// Default Reevit-themed appearance for Stripe Elements
const getReevitStripeAppearance = (): StripeAppearance => {
  // Check if we're in dark mode
  const isDarkMode = typeof window !== 'undefined' && 
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  
  return {
    theme: isDarkMode ? 'night' : 'stripe',
    variables: {
      colorPrimary: isDarkMode ? '#fafafa' : '#171717',
      colorBackground: isDarkMode ? '#171717' : '#ffffff',
      colorText: isDarkMode ? '#fafafa' : '#171717',
      colorTextSecondary: isDarkMode ? '#a3a3a3' : '#737373',
      colorTextPlaceholder: isDarkMode ? '#737373' : '#a3a3a3',
      colorDanger: '#dc2626',
      fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSizeBase: '14px',
      fontSizeSm: '12px',
      fontSizeLg: '16px',
      fontWeightNormal: '400',
      fontWeightMedium: '500',
      fontWeightBold: '600',
      borderRadius: '10px',
      spacingUnit: '4px',
      spacingGridRow: '16px',
      spacingGridColumn: '16px',
    },
    rules: {
      '.Input': {
        border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e5e5e5',
        boxShadow: 'none',
        padding: '12px 14px',
        fontSize: '14px',
        backgroundColor: isDarkMode ? '#262626' : '#ffffff',
      },
      '.Input:focus': {
        border: isDarkMode ? '1px solid #a3a3a3' : '1px solid #737373',
        boxShadow: 'none',
        backgroundColor: isDarkMode ? '#262626' : '#fafafa',
      },
      '.Input--invalid': {
        border: '1px solid #dc2626',
        boxShadow: 'none',
      },
      '.Label': {
        fontSize: '12px',
        fontWeight: '500',
        marginBottom: '6px',
        color: isDarkMode ? '#a3a3a3' : '#737373',
        textTransform: 'none',
        letterSpacing: '0.02em',
      },
      '.Tab': {
        border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e5e5e5',
        backgroundColor: 'transparent',
        borderRadius: '10px',
        padding: '12px 14px',
      },
      '.Tab:hover': {
        border: isDarkMode ? '1px solid #a3a3a3' : '1px solid #737373',
        backgroundColor: isDarkMode ? '#262626' : '#fafafa',
      },
      '.Tab--selected': {
        border: isDarkMode ? '1px solid #fafafa' : '1px solid #171717',
        backgroundColor: isDarkMode ? '#262626' : '#fafafa',
      },
      '.TabIcon': {
        marginRight: '8px',
      },
      '.Block': {
        border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e5e5e5',
        borderRadius: '10px',
        backgroundColor: isDarkMode ? '#262626' : '#ffffff',
        padding: '12px 14px',
      },
      '.CheckboxInput': {
        border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e5e5e5',
      },
      '.CheckboxInput--checked': {
        backgroundColor: isDarkMode ? '#fafafa' : '#171717',
        borderColor: isDarkMode ? '#fafafa' : '#171717',
      },
    },
  };
};

export function StripeBridge({
  publishableKey,
  clientSecret,
  amount,
  currency,
  appearance,
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
        const stripeAppearance = appearance || getReevitStripeAppearance();

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
  }, [publishableKey, clientSecret, appearance, onReady, onError]);

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

  // Format the amount for display
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);

  return (
    <div className="reevit-stripe-bridge">
      {isLoading && (
        <div className="reevit-stripe-loading">
          <div className="reevit-spinner" />
          <p>Loading secure payment form...</p>
        </div>
      )}

      <div
        ref={containerRef}
        className="reevit-stripe-element"
        style={{ display: isLoading ? 'none' : 'block', minHeight: '200px' }}
      />

      {error && !isLoading && (
        <div className="reevit-stripe-error">
          <p>{error}</p>
        </div>
      )}

      {!isLoading && (
        <div className="reevit-stripe-actions">
          <button
            type="button"
            className="reevit-submit-btn"
            onClick={handleSubmit}
            disabled={isLoading || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="reevit-spinner" style={{ width: '16px', height: '16px' }} />
                <span>Processing...</span>
              </>
            ) : (
              <>Pay {formattedAmount}</>
            )}
          </button>

          {onCancel && (
            <button
              type="button"
              className="reevit-cancel-btn"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
