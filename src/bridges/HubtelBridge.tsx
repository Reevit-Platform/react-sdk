/**
 * Hubtel Bridge
 * Handles integration with Hubtel payment using @hubteljs/checkout npm package
 *
 * Supports two authentication methods:
 * 1. Session (recommended): Fetches base64 basicAuth from the backend session endpoint
 * 2. Basic Auth (legacy): Pass basicAuth directly (deprecated - credentials exposed)
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import CheckoutSdk from '@hubteljs/checkout';
import type { PaymentMethod, PaymentResult, PaymentError } from '../types';
import { createReevitClient } from '../api/client';

interface HubtelBridgeProps {
  paymentId: string;
  publicKey?: string;
  merchantAccount: string | number;
  amount: number;
  currency?: string;
  reference?: string;
  email?: string;
  phone?: string;
  description?: string;
  callbackUrl?: string;
  apiBaseUrl?: string;
  clientSecret?: string;
  /** Session token from server (triggers session fetch) */
  hubtelSessionToken?: string;
  /** Base64 basic auth credential (legacy - credentials exposed) */
  basicAuth?: string;
  preferredMethod?: PaymentMethod;
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
}

export function HubtelBridge({
  paymentId,
  publicKey,
  merchantAccount,
  amount,
  currency,
  reference,
  email,
  phone,
  description = 'Payment',
  callbackUrl,
  apiBaseUrl,
  clientSecret,
  hubtelSessionToken,
  basicAuth,
  preferredMethod,
  onSuccess,
  onError,
  onClose,
  autoStart = true,
}: HubtelBridgeProps) {
  const initialized = useRef(false);
  const [authValue, setAuthValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [resolvedMerchantAccount, setResolvedMerchantAccount] = useState<string | number>(merchantAccount);

  useEffect(() => {
    setResolvedMerchantAccount(merchantAccount);
  }, [merchantAccount]);

  // Fetch basicAuth if session trigger is provided, otherwise use legacy basicAuth
  useEffect(() => {
    const fetchAuth = async () => {
      if (hubtelSessionToken) {
        setIsLoading(true);
        try {
          const client = createReevitClient({ publicKey, baseUrl: apiBaseUrl });
          const { data, error } = await client.createHubtelSession(paymentId, clientSecret);
          if (error || !data?.basicAuth) {
            onError({
              code: 'SESSION_ERROR',
              message: error?.message || 'Failed to create Hubtel session',
              recoverable: true,
            });
            return;
          }
          setAuthValue(data.basicAuth);
          if (data.merchantAccount) {
            setResolvedMerchantAccount(data.merchantAccount);
          }
        } catch (err) {
          onError({
            code: 'SESSION_ERROR',
            message: 'Failed to create Hubtel session',
            recoverable: true,
            originalError: err,
          });
        } finally {
          setIsLoading(false);
        }
      } else if (basicAuth) {
        setAuthValue(basicAuth);
      }
    };

    fetchAuth();
  }, [paymentId, publicKey, apiBaseUrl, clientSecret, hubtelSessionToken, basicAuth, onError]);

  const startPayment = useCallback(async () => {
    if (isLoading || !authValue) {
      return;
    }

    try {
      const checkout = new CheckoutSdk();

      const methodPreference =
        preferredMethod === 'mobile_money' ? 'momo' : preferredMethod === 'card' ? 'card' : undefined;

      const purchaseInfo = {
        amount: amount / 100, // Convert from minor to major units
        purchaseDescription: description,
        customerPhoneNumber: phone || '',
        ...(email ? { customerEmail: email } : {}),
        clientReference: reference || `hubtel_${Date.now()}`,
        ...(methodPreference ? { paymentMethod: methodPreference } : {}),
      };

      const config = {
        branding: 'enabled' as const,
        callbackUrl: callbackUrl || window.location.href,
        merchantAccount: typeof resolvedMerchantAccount === 'string'
          ? parseInt(resolvedMerchantAccount, 10)
          : resolvedMerchantAccount,
        basicAuth: authValue || '',
        ...(methodPreference ? { paymentMethod: methodPreference } : {}),
      };

      checkout.openModal({
        purchaseInfo,
        config,
        callBacks: {
          onInit: () => console.log('Hubtel checkout initialized'),
          onPaymentSuccess: (data: any) => {
            const result: PaymentResult = {
              paymentId: (data.transactionId as string) || reference || '',
              reference: (data.clientReference as string) || reference || '',
              amount: amount,
              currency: currency || 'GHS',
              paymentMethod: preferredMethod || 'mobile_money',
              psp: 'hubtel',
              pspReference: (data.transactionId as string) || '',
              status: 'success',
            };
            onSuccess(result);
            checkout.closePopUp();
          },
          onPaymentFailure: (data: any) => {
            const error: PaymentError = {
              code: 'PAYMENT_FAILED',
              message: (data.message as string) || 'Payment failed',
              recoverable: true,
            };
            onError(error);
          },
          onLoad: () => console.log('Hubtel checkout loaded'),
          onClose: () => {
            onClose();
          },
        },
      });
    } catch (err) {
      const error: PaymentError = {
        code: 'PSP_ERROR',
        message: 'Failed to initialize Hubtel',
        recoverable: true,
        originalError: err,
      };
      onError(error);
    }
  }, [
    amount,
    reference,
    phone,
    description,
    callbackUrl,
    authValue,
    isLoading,
    preferredMethod,
    onSuccess,
    onError,
    onClose,
    resolvedMerchantAccount,
    currency,
  ]);

  useEffect(() => {
    if (autoStart && !initialized.current && !isLoading && authValue) {
      initialized.current = true;
      startPayment();
    }
  }, [autoStart, startPayment, isLoading, authValue]);

  return (
    <div className="reevit-psp-bridge reevit-psp-bridge--hubtel">
      <div className="reevit-psp-bridge__loading">
        <div className="reevit-spinner" />
        <p>Connecting to Hubtel...</p>
      </div>
    </div>
  );
}

/**
 * Opens Hubtel checkout modal directly
 * Uses the @hubteljs/checkout npm package
 */
export function openHubtelPopup(config: {
  merchantAccount: string | number;
  description: string;
  amount: number;
  clientReference?: string;
  callbackUrl?: string;
  customerPhoneNumber?: string;
  basicAuth?: string;
  preferredMethod?: PaymentMethod;
  onSuccess?: (data: Record<string, unknown>) => void;
  onError?: (data: Record<string, unknown>) => void;
  onClose?: () => void;
}): void {
  const checkout = new CheckoutSdk();

  const methodPreference =
    config.preferredMethod === 'mobile_money' ? 'momo' : config.preferredMethod === 'card' ? 'card' : undefined;

  const purchaseInfo = {
    amount: config.amount,
    purchaseDescription: config.description,
    customerPhoneNumber: config.customerPhoneNumber || '',
    clientReference: config.clientReference || `hubtel_${Date.now()}`,
    ...(methodPreference ? { paymentMethod: methodPreference } : {}),
  };

  const checkoutConfig = {
    branding: 'enabled' as const,
    callbackUrl: config.callbackUrl || window.location.href,
    merchantAccount: typeof config.merchantAccount === 'string'
      ? parseInt(config.merchantAccount, 10)
      : config.merchantAccount,
    basicAuth: config.basicAuth || '',
    ...(methodPreference ? { paymentMethod: methodPreference } : {}),
  };

  checkout.openModal({
    purchaseInfo,
    config: checkoutConfig,
    callBacks: {
      onPaymentSuccess: (data: any) => {
        config.onSuccess?.(data);
        checkout.closePopUp();
      },
      onPaymentFailure: (data: any) => {
        config.onError?.(data);
      },
      onClose: () => {
        config.onClose?.();
      },
    },
  });
}
