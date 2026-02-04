/**
 * Reevit API Client
 * 
 * Handles communication with the Reevit backend for payment operations.
 */

import type { PaymentMethod, ReevitCheckoutConfig, PaymentError } from '../types';

// API Response Types (matching backend handlers_payments.go)
export interface CreatePaymentIntentRequest {
  amount: number;
  currency: string;
  method?: string;
  country: string;
  customer_id?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  description?: string;
  policy?: {
    prefer?: string[];
    allowed_providers?: string[];
    max_amount?: number;
    blocked_bins?: string[];
    allowed_bins?: string[];
    velocity_max_per_minute?: number;
  };
}

export interface PaymentIntentResponse {
  id: string;
  org_id?: string;
  connection_id: string;
  provider: string;
  status: string;
  client_secret: string;
  psp_public_key?: string;
  psp_credentials?: {
    merchantAccount?: string | number;
    basicAuth?: string;
    [key: string]: unknown;
  };
  amount: number;
  currency: string;
  fee_amount: number;
  fee_currency: string;
  net_amount: number;
  reference?: string;
  available_psps?: Array<{
    provider: string;
    name: string;
    methods: string[];
    countries?: string[];
  }>;
  branding?: Record<string, unknown>;
}

/**
 * Response from creating a Hubtel session token.
 * The token provides secure, short-lived access to Hubtel checkout without exposing credentials.
 */
export interface HubtelSessionResponse {
  /** Short-lived session token for Hubtel checkout */
  token: string;
  /** Hubtel merchant account number */
  merchantAccount: string;
  /** Base64 basic auth for Hubtel checkout (exposes credentials) */
  basicAuth?: string;
  /** Token expiry time in seconds */
  expiresInSeconds: number;
  /** Unix timestamp when the token expires */
  expiresAt: number;
}

export interface ConfirmPaymentRequest {
  provider_ref_id: string;
  provider_data?: Record<string, unknown>;
}

export interface PaymentDetailResponse {
  id: string;
  connection_id: string;
  provider: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  fee_amount: number;
  fee_currency: string;
  net_amount: number;
  customer_id?: string;
  client_secret: string;
  provider_ref_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** Payment source type (payment_link, api, subscription) */
  source?: 'payment_link' | 'api' | 'subscription';
  /** ID of the source (payment link ID, subscription ID, etc.) */
  source_id?: string;
  /** Human-readable description of the source (e.g., payment link name) */
  source_description?: string;
}

export interface APIErrorResponse {
  code: string;
  message: string;
  details?: Record<string, string>;
}

// API Client configuration
export interface ReevitAPIClientConfig {
  /** Your Reevit public key */
  publicKey?: string;
  /** Base URL for the Reevit API (defaults to production) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

// Default API base URLs
const API_BASE_URL_PRODUCTION = 'https://api.reevit.io';
const API_BASE_URL_SANDBOX = 'https://sandbox-api.reevit.io';
const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Determines if a public key is for sandbox mode
 */
function isSandboxKey(publicKey: string): boolean {
  // Support various test/sandbox key prefixes
  return publicKey.startsWith('pk_test_') ||
    publicKey.startsWith('pk_sandbox_') ||
    publicKey.startsWith('pfk_test_') ||
    publicKey.startsWith('pfk_sandbox_');
}

/**
 * Creates a PaymentError from an API error response
 */
function createPaymentError(response: Response, errorData: APIErrorResponse): PaymentError {
  return {
    code: errorData.code || 'api_error',
    message: errorData.message || 'An unexpected error occurred',
    details: {
      httpStatus: response.status,
      ...errorData.details,
    },
  };
}

/**
 * Generates a deterministic idempotency key based on input parameters
 * Uses a simple hash function suitable for browser environments
 * Exported for use by SDK hooks (e.g., payment link flows)
 */
export function generateIdempotencyKey(params: Record<string, unknown>): string {
  // Create a stable string representation of the parameters
  const sortedKeys = Object.keys(params).sort();
  const stableString = sortedKeys
    .map(key => `${key}:${JSON.stringify(params[key])}`)
    .join('|');

  // Simple hash function (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < stableString.length; i++) {
    hash = ((hash << 5) + hash) + stableString.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to positive hex string
  const hashHex = (hash >>> 0).toString(16);

  // Add a time bucket (5-minute windows) to allow retries within a reasonable window
  // but prevent keys from being reused across completely different sessions
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));

  return `reevit_${timeBucket}_${hashHex}`;
}

/**
 * Reevit API Client
 */
export class ReevitAPIClient {
  private readonly publicKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: ReevitAPIClientConfig) {
    this.publicKey = config.publicKey || '';
    this.baseUrl = config.baseUrl || (config.publicKey && isSandboxKey(config.publicKey)
      ? API_BASE_URL_SANDBOX
      : API_BASE_URL_PRODUCTION);
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Makes an authenticated API request
   * @param idempotencyKey Optional deterministic idempotency key for the request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<{ data?: T; error?: PaymentError }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Generate idempotency key for POST requests
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Reevit-Client': '@reevit/react',
      'X-Reevit-Client-Version': '0.5.9',
    };
    if (this.publicKey) {
      headers['X-Reevit-Key'] = this.publicKey;
    }

    // Add idempotency key for mutating requests
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      // Use provided deterministic key, or generate one based on request body
      headers['Idempotency-Key'] = idempotencyKey ||
        (body ? generateIdempotencyKey(body as Record<string, unknown>) : `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`);
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          error: createPaymentError(response, responseData as APIErrorResponse),
        };
      }

      return { data: responseData as T };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return {
            error: {
              code: 'request_timeout',
              message: 'The request timed out. Please try again.',
            },
          };
        }

        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
          return {
            error: {
              code: 'network_error',
              message: 'Unable to connect to Reevit. Please check your internet connection.',
            },
          };
        }
      }

      return {
        error: {
          code: 'unknown_error',
          message: 'An unexpected error occurred. Please try again.',
        },
      };
    }
  }

  /**
   * Creates a payment intent
   */
  async createPaymentIntent(
    config: ReevitCheckoutConfig,
    method?: PaymentMethod,
    country: string = 'GH',
    options?: { preferredProviders?: string[]; allowedProviders?: string[] }
  ): Promise<{ data?: PaymentIntentResponse; error?: PaymentError }> {
    // Build metadata with customer_email for PSP providers that require it
    const metadata: Record<string, unknown> = { ...config.metadata };
    if (config.email) {
      metadata.customer_email = config.email;
    }
    if (config.phone) {
      metadata.customer_phone = config.phone;
    }

    const request: CreatePaymentIntentRequest = {
      amount: config.amount,
      currency: config.currency,
      country,
      customer_id: config.email || (config.metadata?.customerId as string | undefined),
      phone: config.phone,
      metadata,
    };

    if (method) {
      request.method = this.mapPaymentMethod(method);
    }

    if (options?.preferredProviders?.length || options?.allowedProviders?.length) {
      request.policy = {
        prefer: options?.preferredProviders,
        allowed_providers: options?.allowedProviders,
      };
    }

    // Generate a deterministic idempotency key based on payment parameters
    // This ensures that duplicate requests for the same payment return the same intent
    const idempotencyKey = config.idempotencyKey || generateIdempotencyKey({
      amount: config.amount,
      currency: config.currency,
      customer: config.email || config.metadata?.customerId || '',
      reference: config.reference || '',
      method: method || '',
      provider: options?.preferredProviders?.[0] || options?.allowedProviders?.[0] || '',
      publicKey: this.publicKey,
    });

    return this.request<PaymentIntentResponse>('POST', '/v1/payments/intents', request, idempotencyKey);
  }

  /**
   * Retrieves a payment intent by ID
   */
  async getPaymentIntent(paymentId: string): Promise<{ data?: PaymentDetailResponse; error?: PaymentError }> {
    return this.request<PaymentDetailResponse>('GET', `/v1/payments/${paymentId}`);
  }

  /**
   * Confirms a payment intent after PSP callback (public endpoint)
   */
  async confirmPaymentIntent(paymentId: string, clientSecret: string): Promise<{ data?: PaymentDetailResponse; error?: PaymentError }> {
    return this.request<PaymentDetailResponse>('POST', `/v1/payments/${paymentId}/confirm-intent?client_secret=${clientSecret}`);
  }

  /**
   * Confirms a payment after PSP callback (authenticated endpoint)
   */
  async confirmPayment(paymentId: string): Promise<{ data?: PaymentDetailResponse; error?: PaymentError }> {
    return this.request<PaymentDetailResponse>('POST', `/v1/payments/${paymentId}/confirm`);
  }

  /**
   * Cancels a payment intent
   */
  async cancelPaymentIntent(paymentId: string): Promise<{ data?: PaymentDetailResponse; error?: PaymentError }> {
    return this.request<PaymentDetailResponse>('POST', `/v1/payments/${paymentId}/cancel`);
  }

  /**
   * Creates a Hubtel session token for secure checkout.
   * This endpoint generates a short-lived token that maps to Hubtel credentials server-side,
   * avoiding exposure of sensitive credentials to the client.
   *
   * @param paymentId - The payment intent ID for Hubtel checkout
   * @returns Hubtel session with token, merchant account, and expiry information
   */
  async createHubtelSession(
    paymentId: string,
    clientSecret?: string
  ): Promise<{ data?: HubtelSessionResponse; error?: PaymentError }> {
    const query = clientSecret ? `?client_secret=${encodeURIComponent(clientSecret)}` : '';
    return this.request<HubtelSessionResponse>('POST', `/v1/payments/hubtel/sessions/${paymentId}${query}`);
  }

  /**
   * Maps SDK payment method to backend format
   */
  private mapPaymentMethod(method: PaymentMethod): string {
    switch (method) {
      case 'card':
        return 'card';
      case 'mobile_money':
        return 'mobile_money';
      case 'bank_transfer':
        return 'bank_transfer';
      default:
        return method;
    }
  }
}

/**
 * Creates a new Reevit API client instance
 */
export function createReevitClient(config: ReevitAPIClientConfig): ReevitAPIClient {
  return new ReevitAPIClient(config);
}
