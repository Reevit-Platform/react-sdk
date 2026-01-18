/**
 * ReevitCheckout Component
 * Main checkout component that orchestrates the payment flow
 */

import { useEffect, useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import type { ReevitCheckoutProps, PaymentMethod, MobileMoneyFormData, PaymentError, PaymentResult, CheckoutProviderOption } from '../types';
import { useReevit } from '../hooks/useReevit';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { MobileMoneyForm } from './MobileMoneyForm';
import { ProviderSelector } from './ProviderSelector';
import { PaystackBridge } from '../bridges/PaystackBridge';
import { HubtelBridge } from '../bridges/HubtelBridge';
import { FlutterwaveBridge } from '../bridges/FlutterwaveBridge';
import { MonnifyBridge } from '../bridges/MonnifyBridge';
import { MPesaBridge } from '../bridges/MPesaBridge';
import { StripeBridge } from '../bridges/StripeBridge';
import { formatAmount, createThemeVariables, cn, getCountryFromCurrency } from '../utils';


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

const pspNames: Record<string, string> = {
  hubtel: "Hubtel",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  monnify: "Monnify",
  mpesa: "M-Pesa",
  stripe: "Stripe",
};

export function ReevitCheckout({
  // Config
  publicKey,
  amount,
  currency,
  email = '',
  phone = '',
  customerName,
  reference,
  metadata,
  customFields,
  paymentLinkCode,
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
  successDelayMs = 5000,
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
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      customerName,
      reference,
      metadata,
      customFields,
      paymentLinkCode,
      paymentMethods,
      initialPaymentIntent,
    },
    apiBaseUrl,
    onSuccess: (result) => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }

      if (successDelayMs > 0) {
        successTimeoutRef.current = setTimeout(() => {
          onSuccess?.(result);
          setIsOpen(false);
          successTimeoutRef.current = null;
        }, successDelayMs);
        return;
      }

      onSuccess?.(result);
      setIsOpen(false);
    },
    onError,
    onClose: () => {
      setIsOpen(false);
      onClose?.();
    },
    onStateChange,
  });

  const providerOptions = useMemo<CheckoutProviderOption[]>(() => {
    const available = paymentIntent?.availableProviders ?? [];
    const fallbackProvider = paymentIntent?.recommendedPsp
      ? [{
        provider: paymentIntent.recommendedPsp,
        name: paymentIntent.recommendedPsp.replace(/^\w/, (c) => c.toUpperCase()),
        methods: paymentMethods,
      }]
      : [];
    const options = available.length > 0 ? available : fallbackProvider;

    return options
      .map((provider) => {
        const methods = provider.methods && provider.methods.length > 0 ? provider.methods : paymentMethods;
        const sanitizedMethods = provider.provider.toLowerCase().includes('hubtel')
          ? methods.filter((method) => method === 'card' || method === 'mobile_money')
          : methods;
        const filteredMethods = sanitizedMethods.filter((method) => paymentMethods.includes(method));
        return {
          ...provider,
          methods: filteredMethods,
        };
      })
      .filter((provider) => provider.methods.length > 0);
  }, [paymentIntent, paymentMethods]);

  const activeProvider = providerOptions.find((provider) => provider.provider === selectedProvider) || providerOptions[0];
  const availableMethods = activeProvider?.methods && activeProvider.methods.length > 0
    ? activeProvider.methods
    : paymentMethods;

  // Initialize when opened
  useEffect(() => {
    // Only initialize if opened and NOT in controlled mode with an initial intent
    if (isOpen && status === 'idle' && !initialPaymentIntent) {
      initialize();
    }
  }, [isOpen, status, initialize, initialPaymentIntent]);

  useEffect(() => {
    if (providerOptions.length === 0) {
      return;
    }

    // If we have a selected provider that's still valid, keep it
    if (selectedProvider && providerOptions.some((provider) => provider.provider === selectedProvider)) {
      return;
    }

    // Only auto-select if there's exactly one provider (no choice needed)
    if (providerOptions.length === 1) {
      setSelectedProvider(providerOptions[0].provider);
    }
    // Otherwise, don't auto-select - let user choose
  }, [providerOptions, selectedProvider]);

  useEffect(() => {
    if (!activeProvider || !selectedMethod) {
      return;
    }

    if (!activeProvider.methods.includes(selectedMethod)) {
      selectMethod(activeProvider.methods[0]);
    }
  }, [activeProvider, selectedMethod, selectMethod]);

  // Handle auto-advance logic
  useEffect(() => {
    // Only auto-advance if we have a selected method AND an intent
    if (isOpen && selectedMethod && paymentIntent && !showPSPBridge) {
      const psp = (selectedProvider || paymentIntent.recommendedPsp || 'paystack').toLowerCase();
      const needsPhone = psp.includes('mpesa');

      // For card, auto-advance if we have an intent
      if (selectedMethod === 'card') {
        setShowPSPBridge(true);
      }
      // For mobile money, auto-advance only if we have an intent AND phone if required
      else if (selectedMethod === 'mobile_money') {
        if (!needsPhone || (momoData?.phone || phone)) {
          setShowPSPBridge(true);
        }
      }
    }
  }, [isOpen, selectedMethod, showPSPBridge, paymentIntent, momoData, phone, selectedProvider]);

  // Open modal
  const handleOpen = useCallback(() => {
    if (controlledIsOpen !== undefined) return; // Don't auto-open if controlled
    setIsOpen(true);
    setShowPSPBridge(false);
    setMomoData(null);
    setSelectedProvider(null);
  }, [controlledIsOpen, setIsOpen]);

  // Close modal
  const handleClose = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    closeCheckout();
    setIsOpen(false);
    setShowPSPBridge(false);
    setMomoData(null);
    setSelectedProvider(null);
  }, [closeCheckout, setIsOpen]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    };
  }, []);

  // Handle payment method selection
  const handleMethodSelect = useCallback(
    (method: PaymentMethod) => {
      selectMethod(method);
    },
    [selectMethod]
  );

  const handleProviderSelect = useCallback(
    async (provider: string) => {
      // Toggle behavior - clicking same PSP collapses it
      if (provider === selectedProvider) {
        setSelectedProvider(null);
        await reset();
        setShowPSPBridge(false);
        setMomoData(null);
        return;
      }

      const providerMethods =
        providerOptions.find((option) => option.provider === provider)?.methods || paymentMethods;
      const methodForInit = selectedMethod && providerMethods.includes(selectedMethod)
        ? selectedMethod
        : providerMethods[0] || paymentMethods[0];

      setSelectedProvider(provider);
      await reset();
      setShowPSPBridge(false);
      setMomoData(null);
      initialize(methodForInit, { preferredProvider: provider, allowedProviders: [provider] });
    },
    [initialize, paymentMethods, providerOptions, reset, selectedMethod, selectedProvider]
  );

  // Handle continue after method selection
  const handleContinue = useCallback(() => {
    if (!selectedMethod) return;

    if (selectedMethod === 'card') {
      // For card payments, show PSP bridge (Paystack popup)
      setShowPSPBridge(true);
    } else if (selectedMethod === 'mobile_money') {
      const psp = (selectedProvider || paymentIntent?.recommendedPsp || 'paystack').toLowerCase();
      const needsPhone = psp.includes('mpesa');

      if (!needsPhone || (momoData?.phone || phone)) {
        setShowPSPBridge(true);
      }
    }
  }, [selectedMethod, selectedProvider, paymentIntent, momoData, phone]);

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
  const handleBack = useCallback(async () => {
    await reset();
    setMomoData(null);
    setShowPSPBridge(false);
  }, [reset]);

  // Theme styles
  const resolvedTheme = useMemo(() => {
    if (!theme && !paymentIntent?.branding) {
      return undefined;
    }
    return {
      ...(paymentIntent?.branding || {}),
      ...(theme || {}),
    };
  }, [paymentIntent?.branding, theme]);

  const themeStyles = useMemo(() => {
    if (!resolvedTheme) return {};
    const vars: Record<string, string> = {};

    // Background color applies to entire checkout (header, body, footer)
    if (resolvedTheme.backgroundColor) {
      vars['--reevit-background'] = resolvedTheme.backgroundColor;
      vars['--reevit-surface'] = resolvedTheme.backgroundColor;
    }

    // Primary color for main text, headings, important elements
    if (resolvedTheme.primaryColor) {
      vars['--reevit-text'] = resolvedTheme.primaryColor;
    }

    // Primary foreground for sub text, descriptions, muted elements
    if (resolvedTheme.primaryForegroundColor) {
      vars['--reevit-text-secondary'] = resolvedTheme.primaryForegroundColor;
      vars['--reevit-muted'] = resolvedTheme.primaryForegroundColor;
    }

    // Border color for borders and dividers
    if (resolvedTheme.borderColor) {
      vars['--reevit-border'] = resolvedTheme.borderColor;
    }

    if (resolvedTheme.borderRadius) {
      vars['--reevit-radius'] = resolvedTheme.borderRadius;
      vars['--reevit-radius-lg'] = resolvedTheme.borderRadius;
    }

    return vars;
  }, [resolvedTheme]);
  const brandName = resolvedTheme?.companyName;
  const themeMode = resolvedTheme?.darkMode;
  const dataTheme = useMemo(() => {
    if (typeof themeMode === 'boolean') {
      return themeMode ? 'dark' : 'light';
    }
    if (typeof document !== 'undefined') {
      if (document.documentElement.classList.contains('dark')) return 'dark';
      if (document.documentElement.classList.contains('light')) return 'light';
    }
    return undefined;
  }, [themeMode]);

  // Render trigger
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
        <div className="reevit-loading reevit-animate-fade-in">
          <div className="reevit-spinner" />
          <p>{status === 'loading' ? 'Preparing checkout...' : 'Processing payment...'}</p>
        </div>
      );
    }

    // Success state
    if (status === 'success' && result) {
      return (
        <div className="reevit-success reevit-animate-scale-in">
          <div className="reevit-success__icon-wrapper">
            <div className="reevit-success__icon-circle">
              <svg className="reevit-success__checkmark" viewBox="0 0 52 52">
                <circle className="reevit-success__checkmark-circle" cx="26" cy="26" r="25" fill="none" />
                <path className="reevit-success__checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
              </svg>
            </div>
          </div>
          <h3 className="reevit-success__title">Payment Successful!</h3>
          <p className="reevit-success__amount">{formatAmount(amount, currency)}</p>
          <p className="reevit-success__reference">Reference: {result.reference}</p>
          <p className="reevit-success__redirect">Redirecting in a moment...</p>
        </div>
      );
    }

    // Error state
    if (status === 'failed' && error && !error.recoverable) {
      return (
        <div className="reevit-error reevit-animate-fade-in">
          <div className="reevit-error__icon">✕</div>
          <h3>Payment Failed</h3>
          <p>{error.message}</p>
          <button className="reevit-btn reevit-btn--primary" onClick={handleBack}>
            Try Again
          </button>
        </div>
      );
    }

    const psp = selectedProvider || paymentIntent?.recommendedPsp || 'paystack';
    const pspLower = psp.toLowerCase();

    // PSP Bridge
    if (showPSPBridge) {
      const pspKey = paymentIntent?.pspPublicKey || publicKey || '';
      const bridgeMetadata = {
        ...metadata,
        org_id: paymentIntent?.orgId ?? (metadata?.org_id as string),
        payment_id: paymentIntent?.id,
        connection_id: paymentIntent?.connectionId ?? (metadata?.connection_id as string),
        customer_phone: momoData?.phone || phone,
      };

      switch (pspLower) {
        case 'paystack':
          return (
            <PaystackBridge
              publicKey={pspKey}
              email={email}
              phone={momoData?.phone || phone}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              reference={reference}
              accessCode={paymentIntent?.clientSecret}
              metadata={bridgeMetadata}
              channels={selectedMethod === 'mobile_money' ? ['mobile_money'] : ['card']}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onClose={handlePSPClose}
            />
          );
        case 'hubtel':
          return (
            <HubtelBridge
              paymentId={paymentIntent?.id || ''}
              publicKey={publicKey}
              merchantAccount={paymentIntent?.pspCredentials?.merchantAccount || ''}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              reference={paymentIntent?.reference || reference}
              email={email}
              phone={momoData?.phone || phone}
              description={`Payment ${paymentIntent?.reference || reference || ''}`}
              hubtelSessionToken={paymentIntent?.id ? paymentIntent.id : undefined}
              clientSecret={paymentIntent?.clientSecret}
              apiBaseUrl={apiBaseUrl}
              preferredMethod={selectedMethod || undefined}
              onSuccess={handlePSPSuccess}
              onError={(err: PaymentError) => handlePSPError(err)}
              onClose={handlePSPClose}
            />
          );
        case 'flutterwave':
          return (
            <FlutterwaveBridge
              publicKey={pspKey}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              reference={paymentIntent?.reference || reference}
              email={email}
              phone={momoData?.phone || phone}
              metadata={bridgeMetadata}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onClose={handlePSPClose}
            />
          );
        case 'monnify':
          return (
            <MonnifyBridge
              apiKey={pspKey}
              contractCode={(metadata?.contract_code as string) || pspKey}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              reference={paymentIntent?.reference || reference || `monnify_${Date.now()}`}
              customerName={(metadata?.customer_name as string) || email}
              customerEmail={email}
              customerPhone={momoData?.phone || phone}
              metadata={bridgeMetadata}
              onSuccess={(res) => handlePSPSuccess({ ...res, psp: 'monnify' })}
              onError={handlePSPError}
              onClose={handlePSPClose}
            />
          );
        case 'mpesa':
          return (
            <MPesaBridge
              apiEndpoint={`${apiBaseUrl || 'https://api.reevit.io'}/v1/payments/${paymentIntent?.id}/mpesa`}
              phoneNumber={momoData?.phone || phone || ''}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              reference={paymentIntent?.reference || reference || `mpesa_${Date.now()}`}
              description={`Payment ${paymentIntent?.reference || reference || ''}`}
              headers={{ 'x-reevit-public-key': publicKey || '' }}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
            />
          );
        case 'stripe':
          return (
            <StripeBridge
              publishableKey={pspKey}
              clientSecret={paymentIntent?.clientSecret || ''}
              amount={paymentIntent?.amount ?? amount}
              currency={paymentIntent?.currency ?? currency}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onCancel={handlePSPClose}
            />
          );
        default:
          return (
            <div className="reevit-error">
              <div className="reevit-error__icon">⚠️</div>
              <h3>Provider Not Supported</h3>
              <p>Provider ({psp}) is not supported.</p>
              <button className="reevit-btn reevit-btn--primary" onClick={handleBack}>Go Back</button>
            </div>
          );
      }
    }

    const renderMethodContent = (provider: string, method: PaymentMethod) => {
      const pspLower = provider.toLowerCase();
      const needsPhone = pspLower.includes('mpesa');

      if (method === 'card') {
        return (
          <div className="reevit-inline-action reevit-animate-fade-in">
            <p className="reevit-inline-action__hint">You'll be redirected to complete your card payment securely.</p>
            <button className="reevit-btn reevit-btn--primary" onClick={handleContinue} disabled={isLoading}>Pay with Card</button>
          </div>
        );
      }

      if (method === 'mobile_money') {
        if (needsPhone && !phone) {
          return (
            <div className="reevit-inline-action reevit-animate-fade-in">
              <MobileMoneyForm onSubmit={handleMomoSubmit} onCancel={handleBack} isLoading={isLoading} initialPhone={phone} hideCancel />
            </div>
          );
        }
        return (
          <div className="reevit-inline-action reevit-animate-fade-in">
            <p className="reevit-inline-action__hint">
              {pspLower.includes('hubtel')
                ? 'Opens the Hubtel checkout with Mobile Money selected.'
                : `Continue to pay securely with Mobile Money via ${pspNames[pspLower] || pspLower.charAt(0).toUpperCase() + pspLower.slice(1)}.`}
            </p>
            <button className="reevit-btn reevit-btn--primary" onClick={handleContinue} disabled={isLoading}>
              {pspLower.includes('hubtel') ? 'Continue with Hubtel' : 'Pay with Mobile Money'}
            </button>
          </div>
        );
      }
      return null;
    };

    if (providerOptions.length > 1) {
      return (
        <div className="reevit-method-step reevit-animate-slide-up">
          <ProviderSelector
            providers={providerOptions}
            selectedProvider={selectedProvider}
            onSelect={handleProviderSelect}
            disabled={isLoading}
            theme={resolvedTheme}
            country={getCountryFromCurrency(currency)}
            selectedMethod={selectedMethod}
            onMethodSelect={handleMethodSelect}
            renderMethodContent={renderMethodContent}
          />
        </div>
      );
    }

    return (
      <div className="reevit-method-step reevit-animate-slide-up">
        <PaymentMethodSelector
          methods={availableMethods}
          selectedMethod={selectedMethod}
          onSelect={handleMethodSelect}
          disabled={isLoading}
          provider={psp}
          layout="list"
          showLabel={false}
          country={getCountryFromCurrency(currency)}
          selectedTheme={resolvedTheme ? {
            backgroundColor: resolvedTheme.selectedBackgroundColor,
            textColor: resolvedTheme.selectedTextColor,
            descriptionColor: resolvedTheme.selectedDescriptionColor,
            borderColor: resolvedTheme.selectedBorderColor,
          } : undefined}
        />

        {selectedMethod && (
          <div className="reevit-method-step__actions reevit-animate-slide-up">
            {selectedMethod === 'mobile_money' && pspLower.includes('mpesa') && !phone ? (
              <MobileMoneyForm onSubmit={handleMomoSubmit} onCancel={() => selectMethod(null as any)} isLoading={isLoading} initialPhone={phone} />
            ) : (
              <div className="reevit-card-info reevit-animate-fade-in">
                <p className="reevit-info-text">
                  {selectedMethod === 'card'
                    ? 'You will be redirected to complete your card payment securely.'
                    : pspLower.includes('hubtel')
                      ? 'Opens the Hubtel checkout with Mobile Money selected.'
                      : `Continue to pay securely via ${pspNames[pspLower] || pspLower.charAt(0).toUpperCase() + pspLower.slice(1)}.`}
                </p>
                <button
                  className="reevit-btn reevit-btn--primary"
                  onClick={handleContinue}
                  disabled={isLoading}
                >
                  {selectedMethod === 'card'
                    ? 'Pay with Card'
                    : pspLower.includes('hubtel')
                      ? 'Continue with Hubtel'
                      : 'Pay with Mobile Money'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <ReevitContext.Provider value={{ publicKey: publicKey || '', amount, currency }}>
      {trigger}

      {isOpen && (
        <div className="reevit-overlay" onClick={handleClose}>
          <div
            className={cn('reevit-modal', isComplete && 'reevit-modal--success')}
            style={themeStyles}
            data-reevit-theme={dataTheme}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="reevit-modal__header">
              <div className="reevit-modal__branding">
                {resolvedTheme?.logoUrl && (
                  <img
                    src={resolvedTheme.logoUrl}
                    alt={brandName || ""}
                    className="reevit-modal__logo"
                  />
                )}
                {brandName && <span className="reevit-modal__brand-name">{brandName}</span>}
              </div>
              <button className="reevit-modal__close" onClick={handleClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="reevit-modal__amount">
              <span className="reevit-modal__amount-label">Amount</span>
              <span className="reevit-modal__amount-value">{formatAmount(amount, currency)}</span>
            </div>

            <div className="reevit-modal__content">
              {renderContent()}
            </div>

            <div className="reevit-modal__footer">
              <span className="reevit-modal__secured">🔒 Secured by Reevit</span>
            </div>
          </div>
        </div>
      )}
    </ReevitContext.Provider>
  );
}
