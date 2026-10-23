/**
 * ReevitCheckout Component
 * Main checkout component that orchestrates the payment flow.
 *
 * The shopper sees one list of payment methods. Reevit picks the processor:
 * the recommended one when it supports the chosen method, otherwise the first
 * connected one that does.
 */

import { useEffect, useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import type { ReevitCheckoutProps, PaymentMethod, MobileMoneyFormData, PaymentError, CheckoutProviderOption, MethodOption } from '../types';
import { useReevit } from '../hooks/useReevit';
import { useDirectCharge, FAILOVER_DONE, type DirectInput } from '../hooks/useDirectCharge';
import { useDirectBank } from '../hooks/useDirectBank';
import { createDirectChargeClient, type BankDetails, type PublicAttempt } from '../api/direct';
import { MomoWaitPanel, MomoCodePanel, MomoFailurePanel, formatPayerPhone, NETWORK_LABEL } from './DirectMomo';
import { BankDetailsPanel, BankConfirmingPanel, BankNotSeenPanel, BankFailurePanel } from './DirectBank';
import { MobileMoneyForm } from './MobileMoneyForm';
import { LoadingState } from './LoadingState';
import { MethodList, METHOD_LABEL } from './MethodList';
import { PanelHead } from './PanelHead';
import { CheckoutShell, type FooterProvider } from './CheckoutShell';
import { ReceiptPanel, FailurePanel, UnconfirmedPanel } from './ResultPanels';
import { PaystackBridge } from '../bridges/PaystackBridge';
import { HubtelBridge } from '../bridges/HubtelBridge';
import { FlutterwaveBridge } from '../bridges/FlutterwaveBridge';
import { MonnifyBridge } from '../bridges/MonnifyBridge';
import { MPesaBridge } from '../bridges/MPesaBridge';
import { StripeBridge } from '../bridges/StripeBridge';
import { formatAmount, formatMoney, getCountryFromCurrency, resolveAssetSrc } from '../utils';

import flutterwaveLogo from '../assets/providers/flutterwave.png';
import hubtelLogo from '../assets/providers/hubtel.png';
import monnifyLogo from '../assets/providers/monnify.png';
import mpesaWordmark from '../assets/providers/mpesa-wordmark.png';
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

/** Footer mark per provider. Wordmarks sit a touch shorter than icons so they read at the same weight. */
const PROVIDER_FOOTER: Record<string, { src: string | undefined; kind: 'icon' | 'word' }> = {
  paystack: { src: resolveAssetSrc(paystackLogo), kind: 'icon' },
  hubtel: { src: resolveAssetSrc(hubtelLogo), kind: 'icon' },
  flutterwave: { src: resolveAssetSrc(flutterwaveLogo), kind: 'icon' },
  monnify: { src: resolveAssetSrc(monnifyLogo), kind: 'word' },
  mpesa: { src: resolveAssetSrc(mpesaWordmark), kind: 'word' },
  stripe: { src: resolveAssetSrc(stripeLogo), kind: 'word' },
};

/** Order the method list is shown in. */
const METHOD_ORDER: PaymentMethod[] = ['card', 'mobile_money', 'bank_transfer', 'apple_pay', 'google_pay'];

/** The backend refuses a checkout-session selection past attempt 3. */
const MAX_PROMPT_ATTEMPT = 3;

type Stage = 'list' | 'phone' | 'direct' | 'bank' | 'preparing' | 'bridge';
type ViewId =
  | 'loading' | 'list' | 'phone' | 'preparing' | 'bridge' | 'processing' | 'confirming' | 'unconfirmed' | 'receipt' | 'failure'
  | 'momo' | 'momo-wait' | 'momo-code' | 'momo-fail'
  | 'bank-start' | 'bank' | 'bank-conf' | 'bank-miss' | 'bank-fail';

/** A provider that takes a method in Reevit's own screens, with its capabilities. */
interface DirectSelection {
  provider: CheckoutProviderOption;
  option: MethodOption;
}

const titleCase = (value: string) => value.replace(/^\w/, (c) => c.toUpperCase());

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
  idempotencyKey,
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

  const [stage, setStage] = useState<Stage>('list');
  const [momoData, setMomoData] = useState<MobileMoneyFormData | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [pspError, setPspError] = useState<PaymentError | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** onSuccess is delivered exactly once per payment, by the timer, Done, or closing the receipt. */
  const successDeliveredRef = useRef(false);
  /** Guards double taps while an intent is being created. */
  const pickingRef = useRef(false);
  /**
   * M-Pesa prompts sent in this checkout. The first is attempt 0; every later one
   * (a retry, or a corrected number) is a fresh intent, so it sends a fresh prompt
   * instead of replaying the failed one. The backend allows attempts 0 to 3.
   */
  const promptsSentRef = useRef(0);
  /** Bumped when the shopper backs out, so a stale intent response cannot reopen a bridge. */
  const pickTokenRef = useRef(0);

  const clearSuccessTimer = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
  }, []);

  const deliverSuccess = useCallback(
    (paymentResult: Parameters<NonNullable<typeof onSuccess>>[0]) => {
      clearSuccessTimer();
      if (!successDeliveredRef.current) {
        successDeliveredRef.current = true;
        onSuccess?.(paymentResult);
      }
      setIsOpen(false);
    },
    [clearSuccessTimer, onSuccess, setIsOpen]
  );

  const {
    status,
    paymentIntent,
    selectedMethod,
    error,
    result,
    confirmation,
    initialize,
    selectMethod,
    processPayment,
    completePayment,
    reset,
    close: closeCheckout,
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
      idempotencyKey,
      metadata,
      customFields,
      paymentLinkCode,
      paymentMethods,
      initialPaymentIntent,
    },
    apiBaseUrl,
    onSuccess: (paymentResult) => {
      successDeliveredRef.current = false;
      clearSuccessTimer();

      if (successDelayMs > 0) {
        successTimeoutRef.current = setTimeout(() => {
          successTimeoutRef.current = null;
          deliverSuccess(paymentResult);
        }, successDelayMs);
        return;
      }

      deliverSuccess(paymentResult);
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
        name: titleCase(paymentIntent.recommendedPsp),
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

  /** The union of methods across every connected provider, in display order. */
  const methodList = useMemo(
    () => METHOD_ORDER.filter((method) => providerOptions.some((provider) => provider.methods.includes(method))),
    [providerOptions]
  );

  /** Reevit's routing choice for a method: the recommended provider if it supports it, else the first that does. */
  const providerFor = useCallback(
    (method: PaymentMethod): CheckoutProviderOption | undefined => {
      const recommended = paymentIntent?.recommendedPsp?.toLowerCase();
      return (
        providerOptions.find((p) => p.provider.toLowerCase() === recommended && p.methods.includes(method)) ||
        providerOptions.find((p) => p.methods.includes(method))
      );
    },
    [paymentIntent?.recommendedPsp, providerOptions]
  );

  /**
   * Reevit's own screens take a method when a provider says `flow: direct` for it and
   * the checkout came from a server-created session (the charge route is keyed by the
   * session secret). Anything else keeps the provider's own window.
   */
  const directFor = useCallback(
    (method: PaymentMethod): DirectSelection | undefined => {
      if (!sessionSecret || (method !== 'mobile_money' && method !== 'bank_transfer')) return undefined;
      const recommended = paymentIntent?.recommendedPsp?.toLowerCase();
      const candidates = providerOptions
        .map((provider) => ({ provider, option: provider.methodOptions?.find((o) => o.method === method && o.flow === 'direct') }))
        .filter((c): c is DirectSelection => !!c.option);
      return candidates.find((c) => c.provider.provider.toLowerCase() === recommended) ?? candidates[0];
    },
    [paymentIntent?.recommendedPsp, providerOptions, sessionSecret]
  );
  const directSelection = useMemo(() => directFor('mobile_money'), [directFor]);
  const bankSelection = useMemo(() => directFor('bank_transfer'), [directFor]);

  // The only method is mobile money: skip the list and ask for the number.
  const soleMethod = methodList.length === 1 ? methodList[0] : null;
  const soleProvider = soleMethod ? providerFor(soleMethod) : undefined;
  const soleDirect = soleMethod === 'mobile_money' && !!directSelection;
  const soleBank = soleMethod === 'bank_transfer' && !!bankSelection;
  const directPhone = !soleDirect && soleMethod === 'mobile_money' && !!soleProvider?.provider.toLowerCase().includes('mpesa');
  const activeStage: Stage = stage === 'list' && soleDirect ? 'direct' : stage === 'list' && soleBank ? 'bank' : stage === 'list' && directPhone ? 'phone' : stage;

  const directApi = useMemo(() => createDirectChargeClient({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  /** "MTN MoMo · 024 412 8890", kept for the receipt only; the number is not handed to the merchant. */
  const receiptMethodRef = useRef<string | null>(null);
  const charge = useDirectCharge({
    api: directApi,
    sessionSecret,
    provider: directSelection?.provider.provider ?? '',
    onSuccess: (attempt: PublicAttempt, input: DirectInput | null) => {
      const label = input?.network ? NETWORK_LABEL[input.network] : undefined;
      receiptMethodRef.current = input && label ? `${label} · ${formatPayerPhone(input.phone)}` : null;
      completePayment({
        paymentId: attempt.id,
        reference: reference || '',
        amount: attempt.amount,
        currency: attempt.currency,
        paymentMethod: 'mobile_money',
        psp: directSelection?.provider.provider ?? attempt.provider_display ?? '',
        pspReference: attempt.id,
        status: 'success',
        metadata: { backend_status: attempt.status, rerouted: attempt.rerouted, receipt_url: attempt.receipt_url, network: input?.network },
      });
    },
    onFailure: (failure) => onError?.({ code: failure.code, message: failure.message, recoverable: failure.retryable }),
  });
  /** "Bank transfer · Wema Bank", kept for the receipt only. */
  const receiptBankRef = useRef<string | null>(null);
  const bank = useDirectBank({
    api: directApi,
    sessionSecret,
    provider: bankSelection?.provider.provider ?? '',
    onSuccess: (attempt: PublicAttempt, details: BankDetails | null) => {
      receiptBankRef.current = details?.bank ? `Bank transfer · ${details.bank}` : null;
      completePayment({
        paymentId: attempt.id,
        reference: reference || '',
        amount: attempt.amount,
        currency: attempt.currency,
        paymentMethod: 'bank_transfer',
        psp: bankSelection?.provider.provider ?? attempt.provider_display ?? '',
        pspReference: attempt.id,
        status: 'success',
        metadata: { backend_status: attempt.status, rerouted: attempt.rerouted, receipt_url: attempt.receipt_url },
      });
    },
    onFailure: (failure) => onError?.({ code: failure.code, message: failure.message, recoverable: failure.retryable }),
  });
  const resetCharge = useCallback(() => {
    charge.reset();
    bank.reset();
  }, [bank.reset, charge.reset]);

  // Bank transfer asks for nothing from the shopper: the account is requested as soon as the screen opens.
  const startBank = bank.start;
  const bankPhase = bank.phase;
  useEffect(() => {
    if (isOpen && activeStage === 'bank' && bankPhase === 'idle' && paymentIntent && !!bankSelection) void startBank();
  }, [activeStage, bankPhase, bankSelection, isOpen, paymentIntent, startBank]);

  // Initialize when opened
  useEffect(() => {
    // Only initialize if opened and NOT in controlled mode with an initial intent
    if (isOpen && status === 'idle' && !initialPaymentIntent) {
      initialize();
    }
  }, [isOpen, status, initialize, initialPaymentIntent]);

  // Open modal
  const handleOpen = useCallback(() => {
    if (controlledIsOpen !== undefined) return; // Don't auto-open if controlled
    setIsOpen(true);
    setStage('list');
    setMomoData(null);
    setSelectedProvider(null);
    setPspError(null);
    setConfirmLeave(false);
    resetCharge();
  }, [controlledIsOpen, resetCharge, setIsOpen]);

  // Close modal
  const handleClose = useCallback(() => {
    clearSuccessTimer();
    pickTokenRef.current += 1;
    closeCheckout();
    setIsOpen(false);
    setStage('list');
    setMomoData(null);
    setSelectedProvider(null);
    setPspError(null);
    setConfirmLeave(false);
    resetCharge();
  }, [clearSuccessTimer, closeCheckout, resetCharge, setIsOpen]);

  // Closing from outside (a controlled `isOpen`) must also stop any prompt being followed.
  useEffect(() => {
    if (!isOpen) resetCharge();
  }, [isOpen, resetCharge]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    };
  }, []);

  /**
   * Create (or reuse) a method-specific intent, then hand off to the provider.
   *
   * Paystack's resumeTransaction() can only reopen the transaction represented
   * by its access code; it cannot change that transaction's payment channels.
   * The first intent is created before the shopper picks a method so that the
   * widget can show what is available. Create/reuse a method-specific intent
   * before opening the provider, otherwise Paystack defaults that first intent
   * to card even when the shopper picked Mobile Money.
   */
  const proceed = useCallback(
    async (method: PaymentMethod, provider: CheckoutProviderOption, buyer?: { phone: string; attempt: number }) => {
      if (pickingRef.current) return;
      pickingRef.current = true;
      const token = ++pickTokenRef.current;

      setSelectedProvider(provider.provider);
      selectMethod(method);
      setStage('preparing');

      try {
        if (!initialPaymentIntent) {
          const intent = await initialize(method, {
            allowedProviders: [provider.provider],
            phone: buyer?.phone,
            attempt: buyer?.attempt,
          });
          if (token !== pickTokenRef.current) return;
          if (!intent) {
            setStage('list');
            return;
          }
        }
        setStage('bridge');
      } finally {
        pickingRef.current = false;
      }
    },
    [initialPaymentIntent, initialize, selectMethod]
  );

  // A row was tapped: route to a provider and carry on.
  const handlePick = useCallback(
    (method: PaymentMethod) => {
      if (pickingRef.current) return;
      const provider = providerFor(method);
      if (!provider) {
        onError?.({
          code: 'UNSUPPORTED_CHECKOUT_SELECTION',
          message: 'No connected provider supports this payment method.',
          recoverable: true,
        });
        return;
      }

      const direct = directFor(method);
      if (direct && method === 'bank_transfer') {
        // Reevit's own screens: the account appears at once. A live account is shown again, never replaced.
        setSelectedProvider(direct.provider.provider);
        selectMethod(method);
        setStage('bank');
        return;
      }
      if (direct) {
        // Reevit's own screens: the number first, then the prompt. An earlier prompt keeps being watched.
        setSelectedProvider(direct.provider.provider);
        selectMethod(method);
        charge.useAnotherNumber();
        setStage('direct');
        return;
      }

      if (method === 'mobile_money' && provider.provider.toLowerCase().includes('mpesa')) {
        // M-Pesa is the one in-widget mobile money flow: ask for the number first.
        setSelectedProvider(provider.provider);
        selectMethod(method);
        setStage('phone');
        return;
      }

      void proceed(method, provider);
    },
    [charge, directFor, onError, proceed, providerFor, selectMethod]
  );

  // Mobile money number submitted (M-Pesa)
  const handleMomoSubmit = useCallback(
    (data: MobileMoneyFormData) => {
      const provider = providerFor('mobile_money');
      if (!provider) return;
      const attempt = promptsSentRef.current;
      if (attempt > MAX_PROMPT_ATTEMPT) {
        onError?.({
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many attempts. Please close this window and start again.',
          recoverable: false,
        });
        return;
      }
      promptsSentRef.current += 1;
      setMomoData(data);
      void proceed('mobile_money', provider, { phone: data.phone, attempt });
    },
    [onError, providerFor, proceed]
  );

  // Mobile money number submitted on Reevit's own form.
  const handleDirectSubmit = useCallback(
    (data: MobileMoneyFormData) => {
      const networks = directSelection?.option.networks ?? [];
      void charge.start({ phone: data.phone, network: networks.includes(data.network) ? data.network : undefined });
    },
    [charge, directSelection]
  );

  // Handle PSP callback
  const handlePSPSuccess = useCallback(
    (pspResult: any) => {
      processPayment({ ...pspResult, momoData });
    },
    [processPayment, momoData]
  );

  // A provider window failed outright: report it and show the failure panel.
  const handlePSPError = useCallback(
    (err: any) => {
      pickTokenRef.current += 1;
      setStage('list');
      setPspError(err as PaymentError);
      onError?.(err);
    },
    [onError]
  );

  // The provider window was dismissed: back to the list.
  const handlePSPClose = useCallback(() => {
    pickTokenRef.current += 1;
    setStage('list');
  }, []);

  // Back chevron on a detail panel
  const handlePanelBack = useCallback(() => {
    pickTokenRef.current += 1;
    // Leaving mobile money mid-prompt: back to a clean form, the prompt still watched.
    charge.useAnotherNumber();
    setStage('list');
    setSelectedProvider(null);
  }, [charge]);

  // "Try again" on the failure panel
  const handleBack = useCallback(async () => {
    pickTokenRef.current += 1;
    setPspError(null);
    setMomoData(null);
    setStage('list');
    setSelectedProvider(null);
    if (status === 'failed') {
      await reset();
      // A checkout that never loaded has nothing to go back to; load it again.
      if (!paymentIntent && !initialPaymentIntent) {
        await initialize();
      }
    }
  }, [initialPaymentIntent, initialize, paymentIntent, reset, status]);

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
    if (!resolvedTheme) return undefined;
    const vars: Record<string, string> = {};

    // The Ledger palette is fixed, but a merchant-supplied button colour still
    // drives the primary action.
    if (resolvedTheme.buttonBackgroundColor) {
      vars['--rv-cta-bg'] = resolvedTheme.buttonBackgroundColor;
    }
    if (resolvedTheme.buttonTextColor) {
      vars['--rv-cta-fg'] = resolvedTheme.buttonTextColor;
    }

    return Object.keys(vars).length > 0 ? vars : undefined;
  }, [resolvedTheme]);
  const brandName = resolvedTheme?.companyName;
  const themeMode = resolvedTheme?.darkMode;
  const dataTheme = useMemo<'light' | 'dark' | undefined>(() => {
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

  const psp = (selectedProvider || paymentIntent?.recommendedPsp || 'paystack');
  const pspLower = psp.toLowerCase();
  const pspName = providerOptions.find((p) => p.provider.toLowerCase() === pspLower)?.name || titleCase(psp);
  const country = getCountryFromCurrency(displayCurrency);
  // The merchant's own order reference. A backend reference that is only the payment/provider id is noise.
  const intentRef = paymentIntent?.reference;
  const orderRef = reference || (intentRef && intentRef !== paymentIntent?.id && intentRef !== paymentIntent?.providerRefId ? intentRef : undefined);

  // Which view is on screen
  const showFailure = (status === 'failed' && !!error) || !!pspError;
  let view: ViewId;
  if (status === 'success' && result) view = 'receipt';
  else if (showFailure) view = 'failure';
  else if (confirmation === 'unconfirmed') view = 'unconfirmed';
  else if (confirmation === 'confirming') view = 'confirming';
  else if (status === 'processing') view = 'processing';
  else if (!paymentIntent) view = 'loading';
  else if (activeStage === 'bank') {
    view =
      bank.phase === 'confirming' ? 'bank-conf'
      : bank.phase === 'notSeen' ? 'bank-miss'
      : bank.phase === 'failed' && bank.failure ? 'bank-fail'
      : (bank.phase === 'details' || bank.phase === 'expired') && bank.details ? 'bank'
      : 'bank-start';
  }
  else if (activeStage === 'direct') {
    view =
      charge.phase === 'waiting' ? 'momo-wait'
      : charge.phase === 'code' || charge.phase === 'submitting' ? 'momo-code'
      : charge.phase === 'failed' && charge.failure ? 'momo-fail'
      : 'momo';
  }
  else if (activeStage === 'preparing') view = 'preparing';
  else if (activeStage === 'bridge') view = 'bridge';
  else if (activeStage === 'phone') view = 'phone';
  else view = 'list';

  // Slide direction: forward into a detail panel, back to the list, fade otherwise.
  // Decided once per view so a later re-render never restarts the animation.
  // Waiting for the intent and showing the provider's own opening line are one panel to the eye.
  const panelView: ViewId = view === 'preparing' ? 'bridge' : view;
  const directionRef = useRef<{ view: ViewId; direction: 'forward' | 'back' | 'fade' }>({ view: panelView, direction: 'fade' });
  if (directionRef.current.view !== panelView) {
    const from = directionRef.current.view;
    const isDetail = (v: ViewId) => v === 'phone' || v === 'preparing' || v === 'bridge' || v === 'momo' || v === 'bank-start' || v === 'bank';
    const isPrompt = (v: ViewId) => v === 'momo-wait' || v === 'momo-code' || v === 'momo-fail' || v === 'bank-conf' || v === 'bank-miss' || v === 'bank-fail';
    directionRef.current = {
      view: panelView,
      direction:
        (panelView === 'list' && (isDetail(from) || isPrompt(from))) || ((panelView === 'momo' || panelView === 'bank') && isPrompt(from))
          ? 'back'
          : isDetail(panelView) && from === 'list' ? 'forward' : 'fade',
    };
  }
  const direction = directionRef.current.direction;

  // A payment is in flight while a provider window is open or the result is being confirmed.
  const inFlight =
    view === 'bridge' || view === 'processing' || view === 'momo-wait' || view === 'momo-code' ||
    (view === 'bank' && bank.phase !== 'expired') || view === 'bank-conf' || view === 'bank-miss';

  const finishReceipt = useCallback(() => {
    if (result) deliverSuccess(result);
  }, [deliverSuccess, result]);

  const requestClose = useCallback(() => {
    if (view === 'receipt') {
      finishReceipt();
      return;
    }
    if (inFlight) {
      setConfirmLeave(true);
      return;
    }
    handleClose();
  }, [finishReceipt, handleClose, inFlight, view]);

  // The confirmation only makes sense while a payment is still in flight.
  useEffect(() => {
    if (confirmLeave && !inFlight) setConfirmLeave(false);
  }, [confirmLeave, inFlight]);

  const footerProvider = useMemo<FooterProvider | null>(() => {
    const recommended = paymentIntent?.recommendedPsp?.toLowerCase();
    const id = (
      selectedProvider ||
      providerOptions.find((p) => p.provider.toLowerCase() === recommended)?.provider ||
      providerOptions[0]?.provider ||
      ''
    ).toLowerCase();
    const mark = PROVIDER_FOOTER[id];
    if (!mark?.src) return null;
    return { id, name: titleCase(id), src: mark.src, kind: mark.kind };
  }, [paymentIntent?.recommendedPsp, providerOptions, selectedProvider]);

  const methodLabel = selectedMethod ? METHOD_LABEL[selectedMethod] : 'Payment';
  const amountText = formatMoney(displayAmount, displayCurrency);

  const announce = {
    loading: 'Preparing checkout',
    list: 'Choose a payment method',
    phone: 'Mobile money',
    momo: 'Mobile money',
    'momo-wait': 'Waiting for your approval',
    'momo-code': 'Enter your code',
    'momo-fail': charge.failure?.title ?? 'Payment failed',
    'bank-start': 'Getting account details',
    bank: bank.phase === 'expired' ? 'Account details expired' : 'Bank transfer',
    'bank-conf': 'Confirming your transfer',
    'bank-miss': 'We haven’t seen it yet',
    'bank-fail': bank.failure?.title ?? 'Payment failed',
    preparing: `Opening ${pspName}`,
    bridge: `Opening ${pspName}`,
    processing: 'Processing payment',
    confirming: 'Confirming your payment',
    unconfirmed: 'Still confirming this payment',
    receipt: 'Payment received',
    failure: 'Payment failed',
  }[view];

  // Render content based on state
  const renderBridge = () => {
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
      case 'hubtel':
        return (
          <HubtelBridge
            paymentId={paymentIntent?.id || ''}
            publicKey={publicKey}
            amount={displayAmount}
            currency={displayCurrency}
            reference={paymentIntent?.providerRefId || paymentIntent?.reference || reference}
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
      case 'monnify':
        return (
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
      case 'mpesa':
        return (
          <MPesaBridge
            // A new payment is a new prompt: start its poll from scratch.
            key={paymentIntent?.id}
            paymentId={paymentIntent?.id || ''}
            clientSecret={paymentIntent?.clientSecret}
            publicKey={publicKey}
            apiBaseUrl={apiBaseUrl}
            phoneNumber={momoData?.phone || phone || ''}
            reference={paymentIntent?.reference || reference}
            onChangeNumber={() => setStage('phone')}
            onRetry={momoData ? () => handleMomoSubmit(momoData) : undefined}
            onSuccess={handlePSPSuccess}
            // The bridge shows its own failure panel, so only report the failure.
            onError={(err) => onError?.(err as PaymentError)}
          />
        );
      case 'stripe':
        return (
          <StripeBridge
            publishableKey={pspKey}
            clientSecret={paymentIntent?.clientSecret || ''}
            amount={displayAmount}
            currency={displayCurrency}
            dark={dataTheme === 'dark'}
            onSuccess={handlePSPSuccess}
            // Card typos are shown inline by the bridge; only a failed load replaces the form.
            onError={(err) => {
              if (err.code === 'STRIPE_INIT_ERROR' || err.code === 'NOT_INITIALIZED') handlePSPError(err);
              else onError?.(err as PaymentError);
            }}
          />
        );
      default:
        return (
          <div className="reevit-result" data-reevit="failure">
            <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
              <span className="reevit-fail-dot" aria-hidden="true" />
              Provider not supported
            </h2>
            <p className="reevit-text">{psp} is not supported.</p>
            <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={handlePanelBack}>
              Go back
            </button>
          </div>
        );
    }
  };

  const renderContent = () => {
    switch (view) {
      case 'loading':
        return <LoadingState title="Preparing checkout" />;
      case 'processing':
        return <LoadingState title="Processing payment" message="Please don’t close this window." />;
      case 'confirming':
        return <LoadingState title="Confirming your payment" message="This can take a minute. You don’t need to pay again." />;
      case 'unconfirmed':
        return <UnconfirmedPanel onDone={handleClose} />;
      case 'receipt':
        return result ? (
          <ReceiptPanel
            reference={result.reference || result.paymentId}
            method={(result.paymentMethod === 'mobile_money' && receiptMethodRef.current) || (result.paymentMethod === 'bank_transfer' && receiptBankRef.current) || METHOD_LABEL[result.paymentMethod] || methodLabel}
            provider={providerOptions.find((p) => p.provider.toLowerCase() === result.psp?.toLowerCase())?.name || titleCase(result.psp || pspName)}
            merchantName={brandName || 'Checkout'}
            orderRef={orderRef}
            amountText={amountText}
            note={result.metadata?.rerouted === true ? FAILOVER_DONE : undefined}
            onDone={finishReceipt}
          />
        ) : null;
      case 'failure':
        return (
          <FailurePanel
            title={paymentIntent ? 'Payment failed' : 'Couldn’t start checkout'}
            message={pspError?.message || error?.message || 'Something went wrong. Please try again.'}
            onRetry={handleBack}
          />
        );
      case 'phone':
        return (
          <>
            <PanelHead title="Mobile money" onBack={directPhone ? undefined : handlePanelBack} />
            <MobileMoneyForm
              mode="mpesa"
              initialPhone={momoData?.phone || phone}
              submitLabel={`Pay ${amountText}`}
              hideCancel
              onSubmit={handleMomoSubmit}
            />
          </>
        );
      case 'momo': {
        const option = directSelection?.option;
        const mpesa = option ? option.networks.length === 1 && option.networks[0] === 'mpesa' : displayCurrency === 'KES';
        return (
          <>
            <PanelHead title="Mobile money" onBack={soleDirect ? undefined : handlePanelBack} />
            <MobileMoneyForm
              mode={mpesa ? 'mpesa' : 'network'}
              networks={mpesa ? undefined : option?.networks}
              initialPhone={charge.input?.phone || momoData?.phone || phone}
              submitLabel={`Pay ${amountText}`}
              hideCancel
              isLoading={charge.phase === 'starting'}
              notice={charge.formNotice}
              onSubmit={handleDirectSubmit}
            />
          </>
        );
      }
      case 'momo-wait': {
        const action = charge.attempt?.next_action;
        return (
          <MomoWaitPanel
            charge={charge}
            phoneText={charge.input ? formatPayerPhone(charge.input.phone) : action?.phone_masked ?? ''}
            network={charge.input?.network ?? action?.network ?? (displayCurrency === 'KES' ? 'mpesa' : undefined)}
          />
        );
      }
      case 'momo-code':
        return <MomoCodePanel key={`${charge.attempt?.id}:${charge.codeKind}`} charge={charge} />;
      case 'momo-fail':
        return charge.failure ? (
          <MomoFailurePanel
            charge={charge}
            failure={charge.failure}
            canChooseAnother={methodList.length > 1}
            onChooseAnother={handlePanelBack}
            onClose={handleClose}
          />
        ) : null;
      case 'bank-start':
        return (
          <>
            <PanelHead title="Bank transfer" onBack={soleBank ? undefined : handlePanelBack} />
            <LoadingState variant="line" title="Getting account details…" />
          </>
        );
      case 'bank':
        return bank.details ? (
          <BankDetailsPanel
            bank={bank}
            details={bank.details}
            currency={displayCurrency}
            amountText={formatMoney(bank.details.amount || displayAmount, displayCurrency)}
            onBack={soleBank ? undefined : handlePanelBack}
          />
        ) : null;
      case 'bank-conf':
        return <BankConfirmingPanel />;
      case 'bank-miss':
        return <BankNotSeenPanel bank={bank} />;
      case 'bank-fail':
        return bank.failure ? (
          <BankFailurePanel
            bank={bank}
            failure={bank.failure}
            canChooseAnother={methodList.length > 1}
            onChooseAnother={handlePanelBack}
            onClose={handleClose}
          />
        ) : null;
      case 'preparing':
        return (
          <>
            {pspLower !== 'mpesa' && <PanelHead title={methodLabel} onBack={handlePanelBack} />}
            <LoadingState variant="line" title={`Opening ${pspName}…`} />
          </>
        );
      case 'bridge':
        // M-Pesa's own waiting/failed panels carry the heading and the way back.
        return (
          <>
            {pspLower !== 'mpesa' && <PanelHead title={methodLabel} onBack={handlePSPClose} />}
            {renderBridge()}
          </>
        );
      default:
        return <MethodList methods={methodList} country={country} onPick={handlePick} />;
    }
  };

  return (
    <ReevitContext.Provider value={{ publicKey: publicKey || '', amount: displayAmount, currency: displayCurrency }}>
      {trigger}

      {isOpen && (
        <CheckoutShell
          theme={dataTheme}
          style={themeStyles}
          brandName={brandName || 'Checkout'}
          hasBrandName={!!brandName}
          logoUrl={resolvedTheme?.logoUrl}
          amountText={amountText}
          orderRef={orderRef}
          footerProvider={footerProvider}
          viewKey={panelView}
          announce={announce}
          confirmOpen={confirmLeave}
          onRequestClose={requestClose}
          onStay={() => setConfirmLeave(false)}
          onLeave={handleClose}
        >
          <div
            key={panelView}
            className={`reevit-panel reevit-panel--${direction}`}
            data-reevit="panel"
            data-step={panelView}
          >
            {renderContent()}
          </div>
        </CheckoutShell>
      )}
    </ReevitContext.Provider>
  );
}
