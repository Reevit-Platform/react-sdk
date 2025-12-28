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
  method: string;
  country: string;
  customer_id?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  description?: string;
  policy?: {
    prefer?: string[];
    max_amount?: number;
    blocked_bins?: string[];
    allowed_bins?: string[];
    velocity_max_per_minute?: number;
  };
}

export interface PaymentIntentResponse {
  id: string;
  connection_id: string;
  provider: string;
  status: string;
  client_secret: string;
  psp_public_key?: string;
  amount: number;
  currency: string;
  fee_amount: number;
  fee_currency: string;
  net_amount: number;
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
}

export interface APIErrorResponse {
  code: string;
  message: string;
  details?: Record<string, string>;
}

// API Client configuration
export interface ReevitAPIClientConfig {
  /** Your Reevit public key */
  publicKey: string;
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
 * Reevit API Client
 */
export class ReevitAPIClient {
  private readonly publicKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: ReevitAPIClientConfig) {
    this.publicKey = config.publicKey;
    this.baseUrl = config.baseUrl || (isSandboxKey(config.publicKey)
      ? API_BASE_URL_SANDBOX
      : API_BASE_URL_PRODUCTION);
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Makes an authenticated API request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data?: T; error?: PaymentError }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Generate idempotency key for POST requests
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Reevit-Key': this.publicKey,
      'X-Reevit-Client': '@reevit/react',
      'X-Reevit-Client-Version': '0.2.5',
    };

    // Add idempotency key for mutating requests
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      headers['Idempotency-Key'] = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
    method: PaymentMethod,
    country: string = 'GH'
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
      method: this.mapPaymentMethod(method),
      country,
      customer_id: config.email || (config.metadata?.customerId as string | undefined),
      phone: config.phone,
      metadata,
    };

    return this.request<PaymentIntentResponse>('POST', '/v1/payments/intents', request);
  }

  /**
   * Retrieves a payment intent by ID
   */
  async getPaymentIntent(paymentId: string): Promise<{ data?: PaymentDetailResponse; error?: PaymentError }> {
    return this.request<PaymentDetailResponse>('GET', `/v1/payments/${paymentId}`);
  }

  /**
   * Confirms a payment after PSP callback
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
