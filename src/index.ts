/**
 * @reevit/react
 * Unified Payment Widget for React Applications
 */

// Components
export { ReevitCheckout, useReevitContext } from './components';
export { PaymentMethodSelector } from './components';
export { MobileMoneyForm } from './components';

// Hooks
export { useReevit } from './hooks';

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
  // Script loaders
  loadPaystackScript,
  loadHubtelScript,
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
  type ReevitAPIClientConfig,
  type PaymentIntentResponse,
  type PaymentDetailResponse,
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
} from './types';

// Utils
export { formatAmount, validatePhone, detectNetwork, formatPhone } from './utils';
