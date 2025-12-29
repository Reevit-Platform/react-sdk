/**
 * Reevit React SDK Types
 * Core type definitions for the unified payment widget
 */

// Payment method types
export type PaymentMethod = 'card' | 'mobile_money' | 'bank_transfer';

export type MobileMoneyNetwork = 'mtn' | 'vodafone' | 'airteltigo';

// Checkout configuration
export interface ReevitCheckoutConfig {
  /** Your Reevit public key (pk_live_xxx or pk_test_xxx) */
  publicKey: string;
  /** Amount in the smallest currency unit (e.g., pesewas for GHS) */
  amount: number;
  /** Currency code (e.g., 'GHS', 'NGN', 'USD') */
  currency: string;
  /** Customer email address */
  email?: string;
  /** Customer phone number (required for mobile money) */
  phone?: string;
  /** Unique reference for this transaction */
  reference?: string;
  /** Additional metadata to attach to the payment */
  metadata?: Record<string, unknown>;
  /** Payment methods to display */
  paymentMethods?: PaymentMethod[];
  /** Optional existing payment intent to use instead of creating a new one */
  initialPaymentIntent?: PaymentIntent;
}

// Checkout callbacks
export interface ReevitCheckoutCallbacks {
  /** Called when payment is successful */
  onSuccess?: (result: PaymentResult) => void;
  /** Called when payment fails */
  onError?: (error: PaymentError) => void;
  /** Called when user closes the checkout */
  onClose?: () => void;
  /** Called when checkout state changes */
  onStateChange?: (state: CheckoutState) => void;
}

// Combined props for ReevitCheckout component
export interface ReevitCheckoutProps extends ReevitCheckoutConfig, ReevitCheckoutCallbacks {
  /** Custom trigger element */
  children?: React.ReactNode;
  /** Whether to open automatically */
  autoOpen?: boolean;
  /** Controlled open state */
  isOpen?: boolean;
  /** Callback for open state changes */
  onOpenChange?: (isOpen: boolean) => void;
  /** Custom theme */
  theme?: ReevitTheme;
  /** Custom API base URL (for testing or self-hosted deployments) */
  apiBaseUrl?: string;
}

// Checkout state machine
export type CheckoutState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'method_selected'
  | 'processing'
  | 'success'
  | 'failed'
  | 'closed';

// Payment result after successful payment
export interface PaymentResult {
  /** Unique payment ID from Reevit */
  paymentId: string;
  /** Reference provided or generated */
  reference: string;
  /** Amount paid in smallest currency unit */
  amount: number;
  /** Currency code */
  currency: string;
  /** Payment method used */
  paymentMethod: PaymentMethod;
  /** PSP that processed the payment */
  psp: string;
  /** PSP's transaction reference */
  pspReference: string;
  /** Payment status */
  status: 'success' | 'pending';
  /** Any additional data from the PSP */
  metadata?: Record<string, unknown>;
}

// Payment error
export interface PaymentError {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether the error is recoverable (user can retry) */
  recoverable?: boolean;
  /** Original error from PSP if available */
  originalError?: unknown;
  /** Additional error details */
  details?: Record<string, unknown>;
}

// Theme customization
export interface ReevitTheme {
  /** Primary brand color */
  primaryColor?: string;
  /** Background color */
  backgroundColor?: string;
  /** Text color */
  textColor?: string;
  /** Border radius for inputs and buttons */
  borderRadius?: string;
  /** Font family to use */
  fontFamily?: string;
  /** Whether to use dark mode */
  darkMode?: boolean;
}

// PSP configuration (internal)
export interface PSPConfig {
  id: string;
  name: string;
  supportedMethods: PaymentMethod[];
  supportedCurrencies: string[];
}

// Mobile money form data
export interface MobileMoneyFormData {
  phone: string;
  network: MobileMoneyNetwork;
}

// Card form data (note: actual card data never touches our code)
export interface CardFormData {
  /** Token from PSP's hosted fields */
  token: string;
  /** Last 4 digits for display */
  last4?: string;
  /** Card brand (visa, mastercard, etc.) */
  brand?: string;
}

// Payment intent from Reevit API
export interface PaymentIntent {
  /** Unique payment intent ID */
  id: string;
  /** Client secret for authenticating client-side operations */
  clientSecret: string;
  /** PSP's public key for client-side SDK initialization */
  pspPublicKey?: string;
  /** Amount in smallest currency unit */
  amount: number;
  /** Currency code */
  currency: string;
  /** Payment status */
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  /** Recommended PSP based on routing rules */
  recommendedPsp: 'paystack' | 'hubtel' | 'flutterwave';
  /** Available payment methods for this intent */
  availableMethods: PaymentMethod[];
  /** Reference provided or generated */
  reference?: string;
  /** Connection ID (from Reevit backend) */
  connectionId?: string;
  /** Provider name (from backend) */
  provider?: string;
  /** Fee amount charged by PSP */
  feeAmount?: number;
  /** Fee currency */
  feeCurrency?: string;
  /** Net amount after fees */
  netAmount?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
