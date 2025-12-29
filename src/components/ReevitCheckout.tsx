/**
 * ReevitCheckout Component
 * Main checkout component that orchestrates the payment flow
 */

import { useEffect, useState, useCallback, createContext, useContext } from 'react';
import type { ReevitCheckoutProps, PaymentMethod, MobileMoneyFormData } from '../types';
import { useReevit } from '../hooks/useReevit';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { MobileMoneyForm } from './MobileMoneyForm';
import { PaystackBridge } from '../bridges/PaystackBridge';
import { formatAmount, createThemeVariables, cn } from '../utils';

// Context for nested components
interface ReevitContextValue {
  publicKey: string;
  amount: number;
  currency: string;
}

const ReevitContext = createContext<ReevitContextValue | null>(null);

export function useReevitContext() {
  const context = useContext(ReevitContext);
  if (!context) {
    throw new Error('useReevitContext must be used within ReevitCheckout');
  }
  return context;
}

export function ReevitCheckout({
  // Config
  publicKey,
  amount,
  currency,
  email = '',
  phone = '',
  reference,
  metadata,
  paymentMethods = ['card', 'mobile_money'],
  initialPaymentIntent,
  // Callbacks
  onSuccess,
  onError,
  onClose,
  onStateChange,
  // UI
  children,
  autoOpen = false,
  isOpen: controlledIsOpen,
  onOpenChange,
  theme,
  apiBaseUrl,
}: ReevitCheckoutProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(autoOpen);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const setIsOpen = useCallback(
    (value: boolean) => {
      if (onOpenChange) {
        onOpenChange(value);
      } else {
        setInternalIsOpen(value);
      }
    },
    [onOpenChange]
  );

  const [showPSPBridge, setShowPSPBridge] = useState(false);
  const [momoData, setMomoData] = useState<MobileMoneyFormData | null>(null);

  const {
    status,
    paymentIntent,
    selectedMethod,
    error,
    result,
    initialize,
    selectMethod,
    processPayment,
    reset,
    close: closeCheckout,
    isLoading,
    isComplete,
  } = useReevit({
    config: {
      publicKey,
      amount,
      currency,
      email,
      phone,
      reference,
      metadata,
      paymentMethods,
      initialPaymentIntent,
    },
    apiBaseUrl,
    onSuccess: (result) => {
      onSuccess?.(result);
      // Keep modal open briefly to show success
      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    },
    onError,
    onClose: () => {
      setIsOpen(false);
      onClose?.();
    },
    onStateChange,
  });

  // Initialize when opened
  useEffect(() => {
    // Only initialize if opened and NOT in controlled mode with an initial intent
    if (isOpen && status === 'idle' && !initialPaymentIntent) {
      initialize();
    }
  }, [isOpen, status, initialize, initialPaymentIntent]);

  // Handle auto-advance logic
  useEffect(() => {
    // Only auto-advance if we have a selected method AND an intent
    if (isOpen && selectedMethod && paymentIntent && !showPSPBridge) {
      // For card, auto-advance if we have an intent
      if (selectedMethod === 'card') {
        setShowPSPBridge(true);
      }
      // For MoMo, auto-advance only if we have an intent AND a phone number
      else if (selectedMethod === 'mobile_money' && (momoData?.phone || phone)) {
        setShowPSPBridge(true);
      }
    }
  }, [isOpen, selectedMethod, showPSPBridge, paymentIntent, momoData, phone]);

  // Open modal
  const handleOpen = useCallback(() => {
    if (controlledIsOpen !== undefined) return; // Don't auto-open if controlled
    setIsOpen(true);
    setShowPSPBridge(false);
    setMomoData(null);
  }, [controlledIsOpen, setIsOpen]);

  // Close modal
  const handleClose = useCallback(() => {
    closeCheckout();
    setIsOpen(false);
    setShowPSPBridge(false);
    setMomoData(null);
  }, [closeCheckout, setIsOpen]);

  // Handle payment method selection
  const handleMethodSelect = useCallback(
    (method: PaymentMethod) => {
      selectMethod(method);
    },
    [selectMethod]
  );

  // Handle continue after method selection
  const handleContinue = useCallback(() => {
    if (!selectedMethod) return;

    if (selectedMethod === 'card') {
      // For card payments, show PSP bridge (Paystack popup)
      setShowPSPBridge(true);
    }
    // Mobile money form is already shown when selected
  }, [selectedMethod]);

  // Handle mobile money form submission
  const handleMomoSubmit = useCallback(
    (data: MobileMoneyFormData) => {
      setMomoData(data);
      setShowPSPBridge(true);
    },
    []
  );

  // Handle PSP callback
  const handlePSPSuccess = useCallback(
    (pspResult: any) => {
      processPayment({ ...pspResult, momoData });
    },
    [processPayment, momoData]
  );

  const handlePSPError = useCallback(
    (error: any) => {
      setShowPSPBridge(false);
      onError?.(error);
    },
    [onError]
  );

  const handlePSPClose = useCallback(() => {
    setShowPSPBridge(false);
  }, []);

  // Back button handler
  const handleBack = useCallback(() => {
    reset();
    setMomoData(null);
    setShowPSPBridge(false);
  }, [reset]);

  // Theme styles
  const themeStyles = theme ? createThemeVariables(theme as unknown as Record<string, string | undefined>) : {};

  // Render trigger
  // If in controlled mode (isOpen is provided), we don't attach an onClick to children
  // because the parent controls when the modal opens (usually after an API call).
  const isControlled = controlledIsOpen !== undefined;

  const trigger = children ? (
    <span onClick={isControlled ? undefined : handleOpen} role={isControlled ? undefined : "button"} tabIndex={isControlled ? undefined : 0}>
      {children}
    </span>
  ) : !isControlled ? (
    <button className="reevit-trigger-btn" onClick={handleOpen}>
      Pay {formatAmount(amount, currency)}
    </button>
  ) : null;

  // Render content based on state
  const renderContent = () => {
    // Loading state
    if (status === 'loading' || status === 'processing') {
      return (
        <div className="reevit-loading">
          <div className="reevit-spinner" />
          <p>{status === 'loading' ? 'Preparing checkout...' : 'Processing payment...'}</p>
        </div>
      );
    }

    // Success state
    if (status === 'success' && result) {
      return (
        <div className="reevit-success">
          <div className="reevit-success__icon">✓</div>
          <h3>Payment Successful</h3>
          <p>Reference: {result.reference}</p>
        </div>
      );
    }

    // Error state (only if not recoverable)
    if (status === 'failed' && error && !error.recoverable) {
      return (
        <div className="reevit-error">
          <div className="reevit-error__icon">✕</div>
          <h3>Payment Failed</h3>
          <p>{error.message}</p>
          <button className="reevit-btn reevit-btn--primary" onClick={handleBack}>
            Try Again
          </button>
        </div>
      );
    }

    // PSP Bridge (Paystack popup)
    if (showPSPBridge) {
      // Use PSP public key from payment intent if available, otherwise fall back to Reevit public key
      const pspKey = paymentIntent?.pspPublicKey || publicKey;
      return (
        <PaystackBridge
          publicKey={pspKey}
          email={email}
          phone={momoData?.phone || phone}
          amount={paymentIntent?.amount ?? amount}
          currency={paymentIntent?.currency ?? currency}
          reference={reference}
          accessCode={paymentIntent?.clientSecret}
          metadata={{
            ...metadata,
            // Override with correct payment intent ID for webhook routing
            // This ensures Paystack webhook includes the correct ID to find the payment
            payment_id: paymentIntent?.id,
            connection_id: paymentIntent?.connectionId ?? (metadata?.connection_id as string),
            customer_phone: momoData?.phone || phone,
          }}
          channels={selectedMethod === 'mobile_money' ? ['mobile_money'] : ['card']}
          onSuccess={handlePSPSuccess}
          onError={handlePSPError}
          onClose={handlePSPClose}
        />
      );
    }

    // Mobile money form
    if (selectedMethod === 'mobile_money' && !showPSPBridge) {
      return (
        <MobileMoneyForm
          onSubmit={handleMomoSubmit}
          onCancel={handleBack}
          isLoading={isLoading}
          initialPhone={phone}
        />
      );
    }

    // Method selection
    return (
      <div className="reevit-method-step">
        <PaymentMethodSelector
          methods={paymentMethods}
          selectedMethod={selectedMethod}
          onSelect={handleMethodSelect}
          disabled={isLoading}
        />

        {selectedMethod && selectedMethod !== 'mobile_money' && (
          <div className="reevit-method-step__actions">
            <button
              className="reevit-btn reevit-btn--primary"
              onClick={handleContinue}
              disabled={isLoading}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <ReevitContext.Provider value={{ publicKey, amount, currency }}>
      {trigger}

      {isOpen && (
        <div className="reevit-overlay" onClick={handleClose}>
          <div
            className={cn('reevit-modal', isComplete && 'reevit-modal--success')}
            style={themeStyles}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="reevit-modal__header">
              <div className="reevit-modal__branding">
                <img
                  src="https://i.imgur.com/bzUR5Lm.png"
                  alt="Reevit"
                  className="reevit-modal__logo"
                />
              </div>
              <button
                className="reevit-modal__close"
                onClick={handleClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Amount display */}
            <div className="reevit-modal__amount">
              <span className="reevit-modal__amount-label">Amount</span>
              <span className="reevit-modal__amount-value">
                {formatAmount(amount, currency)}
              </span>
            </div>

            {/* Content */}
            <div className="reevit-modal__content">
              {renderContent()}
            </div>

            {/* Footer */}
            <div className="reevit-modal__footer">
              <span className="reevit-modal__secured">
                🔒 Secured by Reevit
              </span>
            </div>
          </div>
        </div>
      )}
    </ReevitContext.Provider>
  );
}
