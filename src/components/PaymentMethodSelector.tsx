/**
 * PaymentMethodSelector Component
 * Displays available payment methods for user selection
 */

import type { PaymentMethod } from "../types";
import { cn } from "../utils";

interface PaymentMethodSelectorProps {
  methods: PaymentMethod[];
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  disabled?: boolean;
  provider?: string;
}

// Human-readable PSP names
const pspNames: Record<string, string> = {
  hubtel: "Hubtel",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  monnify: "Monnify",
  mpesa: "M-Pesa",
  stripe: "Stripe",
};

// Payment method configuration
const methodConfig: Record<
  PaymentMethod,
  { label: string; icon: string; description: string }
> = {
  card: {
    label: "Card",
    icon: "💳",
    description: "Pay with Visa, Mastercard, or other cards",
  },
  mobile_money: {
    label: "Mobile Money",
    icon: "📱",
    description: "MTN, Vodafone Cash, AirtelTigo Money",
  },
  bank_transfer: {
    label: "Bank Transfer",
    icon: "🏦",
    description: "Pay directly from your bank account",
  },
};

export function PaymentMethodSelector({
  methods,
  selectedMethod,
  onSelect,
  disabled = false,
  provider,
}: PaymentMethodSelectorProps) {
  const getMethodLabel = (method: PaymentMethod, psp?: string): string => {
    const config = methodConfig[method];

    // For Hubtel, show "Pay with Hubtel" instead of card/mobile_money options
    if (psp?.toLowerCase().includes("hubtel") && method === "mobile_money") {
      return `Pay with ${pspNames[psp.toLowerCase()] || "Hubtel"}`;
    }

    return config.label;
  };

  const getMethodDescription = (method: PaymentMethod, psp?: string): string => {
    const config = methodConfig[method];

    // Hubtel handles everything internally, no need for extra description
    if (psp?.toLowerCase().includes("hubtel")) {
      return "Card, Mobile Money, and Bank Transfer";
    }

    return config.description;
  };

  return (
    <div className="reevit-method-selector">
      <div className="reevit-method-selector__label">Select payment method</div>
      <div className="reevit-method-selector__options">
        {methods.map((method) => {
          const config = methodConfig[method];
          const isSelected = selectedMethod === method;
          const methodLabel = getMethodLabel(method, provider);
          const methodDescription = getMethodDescription(method, provider);

          return (
            <button
              key={method}
              type="button"
              className={cn(
                "reevit-method-option",
                isSelected && "reevit-method-option--selected",
                disabled && "reevit-method-option--disabled",
              )}
              onClick={() => onSelect(method)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              <span className="reevit-method-option__icon">{config.icon}</span>
              <div className="reevit-method-option__content">
                <span className="reevit-method-option__label">{methodLabel}</span>
                <span className="reevit-method-option__description">
                  {methodDescription}
                </span>
              </div>
              {isSelected && (
                <span className="reevit-method-option__check">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M16.667 5L7.5 14.167 3.333 10"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
