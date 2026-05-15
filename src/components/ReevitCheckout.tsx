/**
 * ReevitCheckout Component
 * Main checkout component that orchestrates the payment flow
 */

import { useEffect, useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import type { ReevitCheckoutProps, PaymentMethod, MobileMoneyFormData, PaymentError, CheckoutProviderOption } from '../types';
import { useReevit } from '../hooks/useReevit';
import { MobileMoneyForm } from './MobileMoneyForm';
import { LoadingState } from './LoadingState';
import { PaystackBridge } from '../bridges/PaystackBridge';
import { HubtelBridge } from '../bridges/HubtelBridge';
import { FlutterwaveBridge } from '../bridges/FlutterwaveBridge';
import { MonnifyBridge } from '../bridges/MonnifyBridge';
import { MPesaBridge } from '../bridges/MPesaBridge';
import { StripeBridge } from '../bridges/StripeBridge';
import { formatAmount, cn, resolveAssetSrc } from '../utils';

import flutterwaveLogo from '../assets/providers/flutterwave.png';
import hubtelLogo from '../assets/providers/hubtel.png';
import monnifyLogo from '../assets/providers/monnify.png';
import mpesaLogo from '../assets/providers/mpesa.png';
import paystackLogo from '../assets/providers/paystack.png';
import stripeLogo from '../assets/providers/stripe.png';


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

/** PSP brand logos, keyed by provider id. */
const PROVIDER_LOGOS: Record<string, string | undefined> = {
  paystack: resolveAssetSrc(paystackLogo),
  hubtel: resolveAssetSrc(hubtelLogo),
  flutterwave: resolveAssetSrc(flutterwaveLogo),
  monnify: resolveAssetSrc(monnifyLogo),
  mpesa: resolveAssetSrc(mpesaLogo),
  stripe: resolveAssetSrc(stripeLogo),
};

/** Short terminal-style code per payment method, used in the `NN / CODE` id line. */
const METHOD_CODE: Record<PaymentMethod, string> = {
  card: 'CARD',
  mobile_money: 'MOMO',
  bank_transfer: 'BANK',
  apple_pay: 'APAY',
  google_pay: 'GPAY',
};

const METHOD_NAME: Record<PaymentMethod, string> = {
  card: 'CARD',
  mobile_money: 'MOBILE MONEY',
  bank_transfer: 'BANK TRANSFER',
  apple_pay: 'APPLE PAY',
  google_pay: 'GOOGLE PAY',
};

export function ReevitCheckout({
  // Config
  publicKey,
  sessionSecret,
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
      sessionSecret,
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

  const displayAmount = paymentIntent?.amount ?? amount ?? 0;
  const displayCurrency = paymentIntent?.currency ?? currency ?? 'GHS';

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
    // IMPORTANT: Just set the state directly - do NOT call handleProviderSelect
    // which would reset and re-initialize, causing duplicate payments
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

  // NOTE: Auto-advance logic removed to allow users to see and select payment methods
  // Users must explicitly click a "Pay" button to proceed to the PSP bridge

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
      setShowPSPBridge(false);
      setMomoData(null);

      // Select the appropriate method for this provider
      // No need to re-initialize - we already have the payment intent with available_psps
      // Re-initializing would create a duplicate payment
      if (methodForInit) {
        selectMethod(methodForInit);
      }
    },
    [paymentMethods, providerOptions, selectMethod, selectedMethod, selectedProvider]
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
    } else {
      // bank_transfer and any other method route through the PSP bridge
      setShowPSPBridge(true);
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

    // The brutalist palette is intentionally fixed, but a merchant-supplied
    // button colour still drives the EXECUTE PAYMENT action surface.
    if (resolvedTheme.buttonBackgroundColor) {
      vars['--rb-accent'] = resolvedTheme.buttonBackgroundColor;
    }
    if (resolvedTheme.buttonTextColor) {
      vars['--rb-accent-text'] = resolvedTheme.buttonTextColor;
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
      Pay {formatAmount(displayAmount, displayCurrency)}
    </button>
  ) : null;

  const activeProviderId = activeProvider?.provider;
  const psp = (selectedProvider || paymentIntent?.recommendedPsp || 'paystack');
  const pspLower = psp.toLowerCase();

  // Render content based on state
  const renderContent = () => {
    // Loading / processing — shared brutalist loading screen
    if (status === 'loading') {
      return (
        <LoadingState
          marker="PREPARING"
          title="Setting up checkout"
          message="This will only take a moment"
        />
      );
    }
    if (status === 'processing') {
      return <LoadingState marker="PROCESSING" title="Confirming your payment" />;
    }

    // Success
    if (status === 'success' && result) {
      return (
        <div className="reevit-brut__state">
          <span className="reevit-brut__state-marker">SUCCESS</span>
          <div className="reevit-brut__check-block">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </div>
          <h3 className="reevit-brut__state-title">PAYMENT CAPTURED</h3>
          <p className="reevit-brut__state-sub">
            {formatAmount(displayAmount, displayCurrency)}<br />
            REF: {result.reference}
          </p>
          <div
            className="reevit-brut__countdown"
            style={{ animationDuration: `${successDelayMs}ms` }}
          />
        </div>
      );
    }

    // Error — non-recoverable
    if (status === 'failed' && error && !error.recoverable) {
      return (
        <div className="reevit-brut__state">
          <span className="reevit-brut__state-marker">DECLINED</span>
          <div className="reevit-brut__error-block">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
          <h3 className="reevit-brut__state-title">PAYMENT FAILED</h3>
          <p className="reevit-brut__state-sub">{error.message}</p>
          <button className="reevit-brut__cta" style={{ maxWidth: 260 }} onClick={handleBack}>
            <span>RETRY</span><span>&#8635;</span>
          </button>
        </div>
      );
    }

    // PSP Bridge — bridges keep their own UI, hosted inside the brutalist shell
    if (showPSPBridge) {
      const pspKey = paymentIntent?.pspPublicKey || publicKey || '';
      const bridgeMetadata = {
        ...metadata,
        org_id: paymentIntent?.orgId ?? (metadata?.org_id as string),
        payment_id: paymentIntent?.id,
        connection_id: paymentIntent?.connectionId ?? (metadata?.connection_id as string),
        customer_phone: momoData?.phone || phone,
      };

      let bridgeEl: JSX.Element;
      switch (pspLower) {
        case 'paystack':
          bridgeEl = (
            <PaystackBridge
              publicKey={pspKey}
              email={email}
              phone={momoData?.phone || phone}
              amount={displayAmount}
              currency={displayCurrency}
              reference={reference}
              accessCode={paymentIntent?.clientSecret}
              metadata={bridgeMetadata}
              channels={selectedMethod === 'mobile_money' ? ['mobile_money'] : ['card']}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onClose={handlePSPClose}
            />
          );
          break;
        case 'hubtel':
          bridgeEl = (
            <HubtelBridge
              paymentId={paymentIntent?.id || ''}
              publicKey={publicKey}
              merchantAccount={paymentIntent?.pspCredentials?.merchantAccount || ''}
              amount={displayAmount}
              currency={displayCurrency}
              reference={paymentIntent?.providerRefId || paymentIntent?.reference || reference}
              email={email}
              phone={momoData?.phone || phone}
              description={`Payment ${paymentIntent?.reference || reference || ''}`}
              callbackUrl={`${apiBaseUrl || 'https://api.reevit.io'}/v1/webhooks/incoming/hubtel`}
              hubtelSessionToken={paymentIntent?.id ? paymentIntent.id : undefined}
              clientSecret={paymentIntent?.clientSecret}
              apiBaseUrl={apiBaseUrl}
              preferredMethod={selectedMethod || undefined}
              onSuccess={handlePSPSuccess}
              onError={(err: PaymentError) => handlePSPError(err)}
              onClose={handlePSPClose}
            />
          );
          break;
        case 'flutterwave':
          bridgeEl = (
            <FlutterwaveBridge
              publicKey={pspKey}
              amount={displayAmount}
              currency={displayCurrency}
              reference={paymentIntent?.reference || reference}
              email={email}
              phone={momoData?.phone || phone}
              metadata={bridgeMetadata}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onClose={handlePSPClose}
            />
          );
          break;
        case 'monnify':
          bridgeEl = (
            <MonnifyBridge
              apiKey={pspKey}
              contractCode={(metadata?.contract_code as string) || pspKey}
              amount={displayAmount}
              currency={displayCurrency}
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
          break;
        case 'mpesa':
          bridgeEl = (
            <MPesaBridge
              apiEndpoint={`${apiBaseUrl || 'https://api.reevit.io'}/v1/payments/${paymentIntent?.id}/mpesa`}
              phoneNumber={momoData?.phone || phone || ''}
              amount={displayAmount}
              currency={displayCurrency}
              reference={paymentIntent?.reference || reference || `mpesa_${Date.now()}`}
              description={`Payment ${paymentIntent?.reference || reference || ''}`}
              headers={{ 'x-reevit-public-key': publicKey || '' }}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
            />
          );
          break;
        case 'stripe':
          bridgeEl = (
            <StripeBridge
              publishableKey={pspKey}
              clientSecret={paymentIntent?.clientSecret || ''}
              amount={displayAmount}
              currency={displayCurrency}
              onSuccess={handlePSPSuccess}
              onError={handlePSPError}
              onCancel={handlePSPClose}
            />
          );
          break;
        default:
          bridgeEl = (
            <div className="reevit-brut__state">
              <span className="reevit-brut__state-marker">UNAVAILABLE</span>
              <div className="reevit-brut__error-block">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h3 className="reevit-brut__state-title">PROVIDER NOT SUPPORTED</h3>
              <p className="reevit-brut__state-sub">{psp} is not supported</p>
              <button className="reevit-brut__cta" style={{ maxWidth: 260 }} onClick={handleBack}>
                <span>GO BACK</span><span>&#8635;</span>
              </button>
            </div>
          );
          break;
      }

      return <div className="reevit-brut__bridge">{bridgeEl}</div>;
    }

    // SELECT — processor grid + method grid + action
    const needsMomoForm = selectedMethod === 'mobile_money' && pspLower.includes('mpesa') && !phone;

    return (
      <>
        <div className="reevit-brut__body">
          <div>
            <div className="reevit-brut__section-label">PROCESSOR</div>
            {providerOptions.length === 0 ? (
              <div className="reevit-brut__methods-empty">&gt; NO PROCESSORS AVAILABLE</div>
            ) : (
              <div className="reevit-brut__providers">
                {providerOptions.map((provider) => {
                  const logo = PROVIDER_LOGOS[provider.provider.toLowerCase()];
                  return (
                    <button
                      key={provider.provider}
                      type="button"
                      className="reevit-brut__provider"
                      data-selected={activeProviderId === provider.provider}
                      disabled={isLoading}
                      onClick={() => {
                        if (provider.provider !== selectedProvider) {
                          handleProviderSelect(provider.provider);
                        }
                      }}
                    >
                      {logo ? (
                        <img className="reevit-brut__provider-logo" src={logo} alt="" />
                      ) : (
                        <span className="reevit-brut__provider-fallback">
                          {provider.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="reevit-brut__provider-name">{provider.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="reevit-brut__section-label">SELECT_METHOD</div>
            {!activeProvider || availableMethods.length === 0 ? (
              <div className="reevit-brut__methods-empty">&gt; SELECT A PROCESSOR ABOVE</div>
            ) : (
              <div className="reevit-brut__methods">
                {availableMethods.map((method, index) => (
                  <button
                    key={method}
                    type="button"
                    className={cn(
                      'reevit-brut__method',
                      availableMethods.length === 1 && 'reevit-brut__method--full'
                    )}
                    data-selected={selectedMethod === method}
                    disabled={isLoading}
                    onClick={() => handleMethodSelect(method)}
                  >
                    <span className="reevit-brut__method-id">
                      {String(index + 1).padStart(2, '0')} / {METHOD_CODE[method]}
                    </span>
                    <span className="reevit-brut__method-name">{METHOD_NAME[method]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedMethod && needsMomoForm ? (
            <MobileMoneyForm
              onSubmit={handleMomoSubmit}
              onCancel={handleBack}
              isLoading={isLoading}
              initialPhone={phone}
              hideCancel
            />
          ) : (
            <button
              type="button"
              className="reevit-brut__cta"
              onClick={handleContinue}
              disabled={!activeProvider || !selectedMethod || isLoading}
            >
              <span>MAKE PAYMENT</span>
              <span>&rarr;</span>
            </button>
          )}
        </div>

        <div className="reevit-brut__footer">
          <span>Secured by Reevit</span>
        </div>
      </>
    );
  };

  return (
    <ReevitContext.Provider value={{ publicKey: publicKey || '', amount: displayAmount, currency: displayCurrency }}>
      {trigger}

      {isOpen && (
        <div className="reevit-brut-overlay" onClick={handleClose}>
          <div
            className={cn('reevit-brut__modal', isComplete && 'reevit-brut__modal--success')}
            style={themeStyles}
            data-reevit-theme={dataTheme}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="reevit-brut__topbar">
              <div className="reevit-brut__topbar-left">
                <span className="reevit-brut__dot" />
                <span>Reevit Checkout</span>
              </div>
              <button className="reevit-brut__close" onClick={handleClose} aria-label="Close">
                [ESC]
              </button>
            </div>

            <div className="reevit-brut__header">
              <div className="reevit-brut__brand-line">
                {resolvedTheme?.logoUrl ? (
                  <img
                    src={resolvedTheme.logoUrl}
                    alt=""
                    className="reevit-brut__brand-logo"
                  />
                ) : brandName ? (
                  <span className="reevit-brut__brand-fallback">{brandName.charAt(0)}</span>
                ) : null}
                <span>MERCHANT: {(brandName || 'CHECKOUT').toUpperCase()}</span>
              </div>
              <div className="reevit-brut__amount-row">
                <div className="reevit-brut__amount">
                  <span className="reevit-brut__amount-bracket">[</span>
                  {formatAmount(displayAmount, displayCurrency)}
                  <span className="reevit-brut__amount-bracket">]</span>
                </div>
                <span className="reevit-brut__amount-tag">DUE NOW</span>
              </div>
            </div>

            {renderContent()}
          </div>
        </div>
      )}
    </ReevitContext.Provider>
  );
}
