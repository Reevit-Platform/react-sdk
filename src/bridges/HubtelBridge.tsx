/**
 * Hubtel Bridge
 * Handles integration with Hubtel payment using @hubteljs/checkout npm package
 */

import { useEffect, useCallback, useRef } from 'react';
import CheckoutSdk from '@hubteljs/checkout';
import type { PaymentResult, PaymentError } from '../types';

interface HubtelBridgeProps {
  merchantAccount: string | number;
  amount: number;
  currency?: string;
  reference?: string;
  email?: string;
  phone?: string;
  description?: string;
  callbackUrl?: string;
  basicAuth?: string;
  onSuccess: (result: PaymentResult) => void;
  onError: (error: PaymentError) => void;
  onClose: () => void;
  autoStart?: boolean;
}

export function HubtelBridge({
  merchantAccount,
  amount,
  reference,
  phone,
  description = 'Payment',
  callbackUrl,
  basicAuth,
  onSuccess,
  onError,
  onClose,
  autoStart = true,
}: HubtelBridgeProps) {
  const initialized = useRef(false);
  const checkoutRef = useRef<InstanceType<typeof CheckoutSdk> | null>(null);

  const startPayment = useCallback(async () => {
    try {
      // Initialize the Checkout SDK
      const checkout = new CheckoutSdk();
      checkoutRef.current = checkout;

      const purchaseInfo = {
        amount: amount / 100, // Convert from minor to major units
        purchaseDescription: description,
        customerPhoneNumber: phone || '',
        clientReference: reference || `hubtel_${Date.now()}`,
      };

      const config = {
        branding: 'enabled' as const,
        callbackUrl: callbackUrl || window.location.href,
        merchantAccount: typeof merchantAccount === 'string' ? parseInt(merchantAccount, 10) : merchantAccount,
        basicAuth: basicAuth || '',
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
              currency: 'GHS',
              paymentMethod: 'mobile_money',
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
  }, [merchantAccount, amount, reference, phone, description, callbackUrl, basicAuth, onSuccess, onError, onClose]);

  useEffect(() => {
    if (autoStart && !initialized.current) {
      initialized.current = true;
      startPayment();
    }
  }, [autoStart, startPayment]);

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
  onSuccess?: (data: Record<string, unknown>) => void;
  onError?: (data: Record<string, unknown>) => void;
  onClose?: () => void;
}): void {
  const checkout = new CheckoutSdk();

  const purchaseInfo = {
    amount: config.amount,
    purchaseDescription: config.description,
    customerPhoneNumber: config.customerPhoneNumber || '',
    clientReference: config.clientReference || `hubtel_${Date.now()}`,
  };

  const checkoutConfig = {
    branding: 'enabled' as const,
    callbackUrl: config.callbackUrl || window.location.href,
    merchantAccount: typeof config.merchantAccount === 'string'
      ? parseInt(config.merchantAccount, 10)
      : config.merchantAccount,
    basicAuth: config.basicAuth || '',
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
