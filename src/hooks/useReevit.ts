/**
 * useReevit hook
 * Core hook for managing Reevit checkout state and API interactions
 */

import { useCallback, useReducer, useEffect, useRef } from 'react';
import type {
  ReevitCheckoutConfig,
  CheckoutState,
  PaymentMethod,
  PaymentResult,
  PaymentError,
  PaymentIntent,
  ReevitTheme,
  CheckoutProviderOption,
} from '../types';
import { generateReference } from '../utils';
import { ReevitAPIClient, type PaymentIntentResponse } from '../api';

// State shape
interface ReevitState {
  status: CheckoutState;
  paymentIntent: PaymentIntent | null;
  selectedMethod: PaymentMethod | null;
  error: PaymentError | null;
  result: PaymentResult | null;
}

// Actions
type ReevitAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; payload: PaymentIntent }
  | { type: 'INIT_ERROR'; payload: PaymentError }
  | { type: 'SELECT_METHOD'; payload: PaymentMethod }
  | { type: 'PROCESS_START' }
  | { type: 'PROCESS_SUCCESS'; payload: PaymentResult }
  | { type: 'PROCESS_ERROR'; payload: PaymentError }
  | { type: 'RESET' }
  | { type: 'CLOSE' };

// Initial state
const initialState: ReevitState = {
  status: 'idle',
  paymentIntent: null,
  selectedMethod: null,
  error: null,
  result: null,
};

const DEFAULT_PUBLIC_API_BASE_URL = 'https://api.reevit.io';

function buildPaymentLinkError(response: Response, data: any): PaymentError {
  return {
    code: data?.code || 'payment_link_error',
    message: data?.message || 'Payment link request failed',
    recoverable: true,
    details: {
      httpStatus: response.status,
      ...(data?.details || {}),
    },
  };
}

// Reducer
function reevitReducer(state: ReevitState, action: ReevitAction): ReevitState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, status: 'loading', error: null };
    case 'INIT_SUCCESS':
      return {
        ...state,
        status: 'ready',
        paymentIntent: action.payload,
        selectedMethod:
          action.payload.availableMethods?.length === 1 ? action.payload.availableMethods[0] : null,
      };
    case 'INIT_ERROR':
      return { ...state, status: 'failed', error: action.payload };
    case 'SELECT_METHOD':
      return { ...state, status: 'method_selected', selectedMethod: action.payload };
    case 'PROCESS_START':
      return { ...state, status: 'processing', error: null };
    case 'PROCESS_SUCCESS':
      return { ...state, status: 'success', result: action.payload };
    case 'PROCESS_ERROR':
      return { ...state, status: 'failed', error: action.payload };
    case 'RESET':
      return { ...initialState, status: 'ready', paymentIntent: state.paymentIntent };
    case 'CLOSE':
      return { ...state, status: 'closed' };
    default:
      return state;
  }
}

interface UseReevitOptions {
  config: ReevitCheckoutConfig;
  onSuccess?: (result: PaymentResult) => void;
  onError?: (error: PaymentError) => void;
  onClose?: () => void;
  onStateChange?: (state: CheckoutState) => void;
  /** Custom API base URL (for testing or self-hosted deployments) */
  apiBaseUrl?: string;
}

/**
 * Maps PSP provider names from backend to PSP type used by bridges
 */
function mapProviderToPsp(provider: string): 'paystack' | 'hubtel' | 'flutterwave' | 'monnify' | 'mpesa' | 'stripe' {
  const providerLower = provider.toLowerCase();
  if (providerLower.includes('paystack')) return 'paystack';
  if (providerLower.includes('hubtel')) return 'hubtel';
  if (providerLower.includes('flutterwave')) return 'flutterwave';
  if (providerLower.includes('monnify')) return 'monnify';
  if (providerLower.includes('mpesa') || providerLower.includes('m-pesa')) return 'mpesa';
  if (providerLower.includes('stripe')) return 'stripe';
  // Default to paystack if unknown
  return 'paystack';
}

function normalizeProviderMethod(method: string): PaymentMethod | null {
  const normalized = method.toLowerCase().trim();
  if (normalized === 'card') return 'card';
  if (normalized === 'mobile_money' || normalized === 'momo' || normalized === 'mobilemoney') return 'mobile_money';
  if (normalized === 'bank' || normalized === 'bank_transfer' || normalized === 'transfer') return 'bank_transfer';
  return null;
}

function mapAvailableProviders(
  providers?: Array<{ provider: string; name: string; methods: string[]; countries?: string[] }>
): CheckoutProviderOption[] | undefined {
  if (!providers || providers.length === 0) return undefined;

  return providers
    .map((provider) => {
      const methods = provider.methods
        .map((method) => normalizeProviderMethod(method))
        .filter(Boolean) as PaymentMethod[];

      return {
        provider: provider.provider,
        name: provider.name,
        methods,
        countries: provider.countries,
      };
    })
    .filter((provider) => provider.methods.length > 0);
}

function normalizeBranding(branding?: Record<string, unknown>): ReevitTheme {
  if (!branding) {
    return {};
  }

  const raw = branding as Record<string, unknown>;
  const theme: Record<string, unknown> = { ...raw };
  const getString = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const getBoolean = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

  const setIf = (key: string, value: unknown) => {
    if (value !== undefined) {
      theme[key] = value;
    }
  };

  setIf('logoUrl', getString(raw.logoUrl ?? raw.logo_url));
  setIf('companyName', getString(raw.companyName ?? raw.company_name));
  setIf('primaryColor', getString(raw.primaryColor ?? raw.primary_color));
  setIf('primaryForegroundColor', getString(raw.primaryForegroundColor ?? raw.primary_foreground_color));
  setIf('backgroundColor', getString(raw.backgroundColor ?? raw.background_color));
  setIf('surfaceColor', getString(raw.surfaceColor ?? raw.surface_color));
  setIf('textColor', getString(raw.textColor ?? raw.text_color));
  setIf('mutedTextColor', getString(raw.mutedTextColor ?? raw.muted_text_color));
  setIf('borderRadius', getString(raw.borderRadius ?? raw.border_radius));
  setIf('fontFamily', getString(raw.fontFamily ?? raw.font_family));
  setIf('darkMode', getBoolean(raw.darkMode ?? raw.dark_mode));
  setIf('pspSelectorBgColor', getString(raw.pspSelectorBgColor ?? raw.psp_selector_bg_color));
  setIf('pspSelectorTextColor', getString(raw.pspSelectorTextColor ?? raw.psp_selector_text_color));
  setIf('pspSelectorBorderColor', getString(raw.pspSelectorBorderColor ?? raw.psp_selector_border_color));
  setIf('pspSelectorUseBorder', getBoolean(raw.pspSelectorUseBorder ?? raw.psp_selector_use_border));

  return theme as ReevitTheme;
}


/**
 * Maps backend payment intent response to SDK PaymentIntent type
 */
function mapToPaymentIntent(
  response: PaymentIntentResponse,
  config: ReevitCheckoutConfig
): PaymentIntent {
  return {
    id: response.id,
    clientSecret: response.client_secret,
    pspPublicKey: response.psp_public_key,
    amount: response.amount,
    currency: response.currency,
    status: response.status as 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled',
    recommendedPsp: mapProviderToPsp(response.provider),
    availableMethods: config.paymentMethods || ['card', 'mobile_money'],
    reference: response.reference || response.id, // Use backend reference or fallback to ID
    connectionId: response.connection_id,
    provider: response.provider,
    feeAmount: response.fee_amount,
    feeCurrency: response.fee_currency,
    netAmount: response.net_amount,
    metadata: config.metadata,
    availableProviders: mapAvailableProviders(response.available_psps),
    branding: normalizeBranding(response.branding as Record<string, unknown> | undefined),
  };
}

export function useReevit(options: UseReevitOptions) {
  const { config, onSuccess, onError, onClose, onStateChange, apiBaseUrl } = options;
  const [state, dispatch] = useReducer(reevitReducer, {
    ...initialState,
    status: config.initialPaymentIntent ? 'ready' : 'idle',
    paymentIntent: config.initialPaymentIntent || null,
    selectedMethod:
      config.initialPaymentIntent?.availableMethods?.length === 1
        ? config.initialPaymentIntent.availableMethods[0]
        : null,
  });

  // Create API client ref (stable across re-renders)
  const apiClientRef = useRef<ReevitAPIClient | null>(null);

  // Guard against duplicate initialize() calls (React StrictMode)
  const initializingRef = useRef(!!config.initialPaymentIntent);

  // Update state if config.initialPaymentIntent changes
  useEffect(() => {
    if (config.initialPaymentIntent) {
      if (!state.paymentIntent || state.paymentIntent.id !== config.initialPaymentIntent.id) {
        dispatch({ type: 'INIT_SUCCESS', payload: config.initialPaymentIntent });
        initializingRef.current = true;
      }
    }
  }, [config.initialPaymentIntent, state.paymentIntent?.id]);

  // Initialize API client
  if (!apiClientRef.current) {
    apiClientRef.current = new ReevitAPIClient({
      publicKey: config.publicKey,
      baseUrl: apiBaseUrl,
    });
  }

  // Notify on state changes
  useEffect(() => {
    onStateChange?.(state.status);
  }, [state.status, onStateChange]);

  // Initialize payment intent
  const initialize = useCallback(
    async (
      method?: PaymentMethod,
      options?: { preferredProvider?: string; allowedProviders?: string[] }
    ) => {
      // Guard against duplicate calls (especially in React StrictMode)
      if (initializingRef.current) {
        return;
      }
      initializingRef.current = true;

      dispatch({ type: 'INIT_START' });

      try {
        const apiClient = apiClientRef.current;
        if (!apiClient) {
          initializingRef.current = false;
          throw new Error('API client not initialized');
        }

        // Generate reference if not provided
        const reference = config.reference || generateReference();

        // Determine country from currency (can be enhanced with IP detection)
        const country = detectCountryFromCurrency(config.currency);

        // Select payment method to send to backend
        const defaultMethod =
          config.paymentMethods && config.paymentMethods.length === 1
            ? config.paymentMethods[0]
            : undefined;
        const paymentMethod = method ?? defaultMethod;

        let data: PaymentIntentResponse | undefined;
        let error: PaymentError | undefined;

        if (config.paymentLinkCode) {
          const response = await fetch(
            `${apiBaseUrl || DEFAULT_PUBLIC_API_BASE_URL}/v1/pay/${config.paymentLinkCode}/pay`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
              },
              body: JSON.stringify({
                amount: config.amount,
                email: config.email || '',
                name: config.customerName || '',
                phone: config.phone || '',
                method: paymentMethod,
                country,
                provider: options?.preferredProvider || options?.allowedProviders?.[0],
                custom_fields: config.customFields,
              }),
            }
          );

          const responseData = await response.json().catch(() => ({}));
          if (!response.ok) {
            error = buildPaymentLinkError(response, responseData);
          } else {
            data = responseData as PaymentIntentResponse;
          }
        } else {
          const result = await apiClient.createPaymentIntent(
            { ...config, reference },
            paymentMethod,
            country,
            {
              preferredProviders: options?.preferredProvider ? [options.preferredProvider] : undefined,
              allowedProviders: options?.allowedProviders,
            }
          );
          data = result.data;
          error = result.error;
        }

        if (error) {
          dispatch({ type: 'INIT_ERROR', payload: error });
          onError?.(error);
          return;
        }

        if (!data) {
          const noDataError: PaymentError = {
            code: 'INIT_FAILED',
            message: 'No data received from API',
            recoverable: true,
          };
          dispatch({ type: 'INIT_ERROR', payload: noDataError });
          onError?.(noDataError);
          initializingRef.current = false;
          return;
        }

        // Map response to PaymentIntent
        const paymentIntent = mapToPaymentIntent(data, { ...config, reference });

        dispatch({ type: 'INIT_SUCCESS', payload: paymentIntent });
        // Don't reset initializingRef here - once initialized, stay initialized until reset()
      } catch (err) {
        const error: PaymentError = {
          code: 'INIT_FAILED',
          message: err instanceof Error ? err.message : 'Failed to initialize checkout',
          recoverable: true,
          originalError: err,
        };
        dispatch({ type: 'INIT_ERROR', payload: error });
        onError?.(error);
        initializingRef.current = false;
      }
    },
    [config, onError, apiBaseUrl]
  );

  // Select payment method
  const selectMethod = useCallback((method: PaymentMethod) => {
    dispatch({ type: 'SELECT_METHOD', payload: method });
  }, []);

  // Process payment - called after PSP bridge returns success
  const processPayment = useCallback(
    async (paymentData: Record<string, unknown>) => {
      if (!state.paymentIntent || !state.selectedMethod) {
        return;
      }

      dispatch({ type: 'PROCESS_START' });

      try {
        const apiClient = apiClientRef.current;
        if (!apiClient) {
          throw new Error('API client not initialized');
        }

        // Confirm the payment with the backend
        // If we have a clientSecret, use the public confirm-intent endpoint
        const clientSecret = state.paymentIntent.clientSecret;
        const { data, error } = clientSecret
          ? await apiClient.confirmPaymentIntent(state.paymentIntent.id, clientSecret)
          : await apiClient.confirmPayment(state.paymentIntent.id);

        if (error) {
          console.error('[useReevit] Confirmation error:', error);
          dispatch({ type: 'PROCESS_ERROR', payload: error });
          onError?.(error);
          return;
        }

        // Build successful payment result
        const result: PaymentResult = {
          paymentId: state.paymentIntent.id,
          reference: (paymentData.reference as string) ||
            (state.paymentIntent.metadata?.reference as string) || '',
          amount: state.paymentIntent.amount,
          currency: state.paymentIntent.currency,
          paymentMethod: state.selectedMethod,
          psp: state.paymentIntent.recommendedPsp,
          pspReference: (paymentData.pspReference as string) ||
            (data?.provider_ref_id as string) || '',
          status: data?.status === 'succeeded' ? 'success' : 'pending',
          metadata: { ...paymentData, backend_status: data?.status },
        };

        if (result.status === 'success') {
          dispatch({ type: 'PROCESS_SUCCESS', payload: result });
          onSuccess?.(result);
        } else {
          // If still pending but PSP reported success, we treat it as success for the UI
          // but we can pass the real status in metadata
          dispatch({ type: 'PROCESS_SUCCESS', payload: result });
          onSuccess?.(result);
        }
      } catch (err) {
        const error: PaymentError = {
          code: 'PAYMENT_FAILED',
          message: err instanceof Error ? err.message : 'Payment failed. Please try again.',
          recoverable: true,
          originalError: err,
        };
        dispatch({ type: 'PROCESS_ERROR', payload: error });
        onError?.(error);
      }
    },
    [state.paymentIntent, state.selectedMethod, onSuccess, onError]
  );

  // Handle PSP bridge success (called by PSP bridge components)
  const handlePspSuccess = useCallback(
    async (pspData: Record<string, unknown>) => {
      await processPayment(pspData);
    },
    [processPayment]
  );

  // Handle PSP bridge failure
  const handlePspError = useCallback(
    (error: PaymentError) => {
      dispatch({ type: 'PROCESS_ERROR', payload: error });
      onError?.(error);
    },
    [onError]
  );

  // Reset checkout
  const reset = useCallback(() => {
    initializingRef.current = false;
    dispatch({ type: 'RESET' });
  }, []);

  // Close checkout
  const close = useCallback(async () => {
    // Cancel the payment intent if it exists and is still pending
    if (state.paymentIntent && state.status !== 'success') {
      try {
        const apiClient = apiClientRef.current;
        if (apiClient) {
          await apiClient.cancelPaymentIntent(state.paymentIntent.id);
        }
      } catch {
        // Silently ignore cancel errors
      }
    }

    dispatch({ type: 'CLOSE' });
    onClose?.();
  }, [onClose, state.paymentIntent, state.status]);

  return {
    // State
    status: state.status,
    paymentIntent: state.paymentIntent,
    selectedMethod: state.selectedMethod,
    error: state.error,
    result: state.result,

    // Actions
    initialize,
    selectMethod,
    processPayment,
    handlePspSuccess,
    handlePspError,
    reset,
    close,

    // Computed
    isLoading: state.status === 'loading' || state.status === 'processing',
    isReady: state.status === 'ready' || state.status === 'method_selected',
    isComplete: state.status === 'success',
    canRetry: state.error?.recoverable ?? false,
  };
}

/**
 * Detects country code from currency
 * This is a simple heuristic; in production, you might use IP geolocation
 */
function detectCountryFromCurrency(currency: string): string {
  const currencyToCountry: Record<string, string> = {
    GHS: 'GH', // Ghana
    NGN: 'NG', // Nigeria
    KES: 'KE', // Kenya
    UGX: 'UG', // Uganda
    TZS: 'TZ', // Tanzania
    ZAR: 'ZA', // South Africa
    XOF: 'CI', // Côte d'Ivoire (CFA)
    XAF: 'CM', // Cameroon (CFA)
    USD: 'US', // United States
    EUR: 'DE', // Europe (default to Germany)
    GBP: 'GB', // United Kingdom
  };

  return currencyToCountry[currency.toUpperCase()] || 'GH';
}
