import type { ReactNode } from 'react';

/** Minimal ReactNode-compatible type to avoid hard dependency on @types/react */
export type ReevitReactNode = ReactNode;

// Payment method types
export type PaymentMethod = 'card' | 'mobile_money' | 'bank_transfer' | 'apple_pay' | 'google_pay';

export type MobileMoneyNetwork = 'mtn' | 'telecel' | 'airteltigo';

/** Payment source type - indicates where the payment originated from */
export type PaymentSource = 'payment_link' | 'api' | 'subscription';

// Checkout configuration
export interface ReevitCheckoutConfig {
  /** Your Reevit public key (required for API-created intents; omit for payment links) */
  publicKey?: string;
  /** Amount in the smallest currency unit (e.g., pesewas for GHS) */
  amount: number;
  /** Currency code (e.g., 'GHS', 'NGN', 'USD') */
  currency: string;
  /** Customer email address */
  email?: string;
  /** Customer phone number (required for mobile money) */
  phone?: string;
  /** Customer name (optional, used for payment links) */
  customerName?: string;
  /** Unique reference for this transaction */
  reference?: string;
  /** Optional idempotency key to safely retry or dedupe intent creation */
  idempotencyKey?: string;
  /** Additional metadata to attach to the payment */
  metadata?: Record<string, unknown>;
  /** Custom fields for payment links (if applicable) */
  customFields?: Record<string, unknown>;
  /** Payment link code (for public checkout flows) */
  paymentLinkCode?: string;
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
  children?: ReevitReactNode;
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
  /** Delay (ms) before calling onSuccess and closing after a successful payment */
  successDelayMs?: number;
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
  /** Payment source type (payment_link, api, subscription) */
  source?: PaymentSource;
  /** ID of the source (payment link ID, subscription ID, etc.) */
  sourceId?: string;
  /** Human-readable description of the source (e.g., payment link name) */
  sourceDescription?: string;
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
  /** Primary color (main text, headings, important elements) */
  primaryColor?: string;
  /** Primary foreground color (sub text, descriptions, muted elements) */
  primaryForegroundColor?: string;
  /** Button background color */
  buttonBackgroundColor?: string;
  /** Button text color */
  buttonTextColor?: string;
  /** Background color (applies to entire checkout: header, body, footer) */
  backgroundColor?: string;
  /** Border color (borders, dividers) */
  borderColor?: string;
  /** Border radius for inputs and buttons */
  borderRadius?: string;
  /** Whether to use dark mode */
  darkMode?: boolean;
  /** Custom logo URL to display in checkout header */
  logoUrl?: string;
  /** Company or organization name to display in checkout header */
  companyName?: string;
  /** PSP selector background color */
  pspSelectorBgColor?: string;
  /** PSP selector text color */
  pspSelectorTextColor?: string;
  /** PSP selector border color */
  pspSelectorBorderColor?: string;
  /** Use border-only style for PSP selector (no filled background) */
  pspSelectorUseBorder?: boolean;
  /** Selected PSP background color */
  selectedBackgroundColor?: string;
  /** Selected PSP primary text color */
  selectedTextColor?: string;
  /** Selected PSP description/muted text color */
  selectedDescriptionColor?: string;
  /** Selected PSP border color */
  selectedBorderColor?: string;
}

// PSP configuration (internal)
export interface PSPConfig {
  id: string;
  name: string;
  supportedMethods: PaymentMethod[];
  supportedCurrencies: string[];
}

// Checkout provider options returned by the API
export interface CheckoutProviderOption {
  provider: string;
  name: string;
  methods: PaymentMethod[];
  countries?: string[];
  /** Brand colors for selected state styling */
  branding?: {
    /** Background color when selected */
    backgroundColor?: string;
    /** Primary/accent color */
    primaryColor?: string;
    /** Text color on primary background */
    primaryForegroundColor?: string;
  };
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
  /** PSP-specific credentials for client-side checkout (e.g., Hubtel's merchantAccount, basicAuth) */
  pspCredentials?: {
    /** Hubtel merchant account number */
    merchantAccount?: string | number;
    /** Hubtel basic auth header value */
    basicAuth?: string;
    /** Any other PSP-specific credential fields */
    [key: string]: unknown;
  };
  /** Amount in smallest currency unit */
  amount: number;
  /** Currency code */
  currency: string;
  /** Payment status */
  status: 'pending' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'cancelled';
  /** Recommended PSP based on routing rules */
  recommendedPsp: 'paystack' | 'hubtel' | 'flutterwave' | 'monnify' | 'mpesa' | 'stripe';
  /** Available payment methods for this intent */
  availableMethods: PaymentMethod[];
  /** Reference provided or generated */
  reference?: string;
  /** Organization ID (from Reevit backend, required for webhook routing) */
  orgId?: string;
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
  /** Available PSPs for this checkout session */
  availableProviders?: CheckoutProviderOption[];
  /** Brand theme from checkout settings */
  branding?: ReevitTheme;
}
