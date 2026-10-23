/**
 * @reevit/react
 * Unified Payment Widget for React Applications
 */

// Components
export { ReevitCheckout, useReevitContext } from './components';
export { PaymentMethodSelector } from './components';
export { MobileMoneyForm } from './components';

// Hooks
export { useReevit, useDirectCharge, useDirectBank } from './hooks';
export type { DirectCharge, DirectFailure, DirectPhase, DirectBank, BankPhase } from './hooks';

// Bridges
export {
  // Existing
  PaystackBridge,
  HubtelBridge,
  FlutterwaveBridge,
  // New
  StripeBridge,
  MonnifyBridge,
  MPesaBridge,
  useMPesaStatusPolling,
  // Script loaders (Hubtel opens its hosted checkout, so it needs none)
  loadPaystackScript,
  openHubtelPopup,
  loadFlutterwaveScript,
  loadStripeScript,
  loadMonnifyScript,
} from './bridges';
export type {
  StripeBridgeProps,
  MonnifyBridgeProps,
  MPesaBridgeProps,
} from './bridges';

// API Client
export {
  ReevitAPIClient,
  createReevitClient,
  createDirectChargeClient,
  type DirectChargeApi,
  type PublicAttempt,
  type BankDetails,
  type DirectApiError,
  type ReevitAPIClientConfig,
  type PaymentIntentResponse,
  type PaymentDetailResponse,
  type CheckoutSessionSelectionRequest,
  type CheckoutSessionSelectionResponse,
} from './api';

// Types
export type {
  PaymentMethod,
  MobileMoneyNetwork,
  ReevitCheckoutConfig,
  ReevitCheckoutCallbacks,
  ReevitCheckoutProps,
  CheckoutState,
  PaymentResult,
  PaymentError,
  ReevitTheme,
  MobileMoneyFormData,
  PaymentIntent,
  PaymentSource,
  MethodOption,
  CheckoutProviderOption,
} from './types';

// Utils
export { formatAmount, validatePhone, detectNetwork, formatPhone } from './utils';
