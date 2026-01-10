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
  layout?: 'grid' | 'list';
  showLabel?: boolean;
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
  layout = 'list',
  showLabel = true,
}: PaymentMethodSelectorProps) {
  const getMethodLabel = (method: PaymentMethod, psp?: string): string => {
    const config = methodConfig[method];
    return config.label;
  };

  const getMethodDescription = (method: PaymentMethod, psp?: string): string => {
    const config = methodConfig[method];

    // Hubtel handles everything internally, no need for extra description
    if (psp?.toLowerCase().includes("hubtel")) {
      return config.description;
    }

    return config.description;
  };

  const isGrid = layout === 'grid';

  return (
    <div className={cn("reevit-method-selector", isGrid && "reevit-method-selector--grid")}>
      {showLabel && <div className="reevit-method-selector__label">Select payment method</div>}
      <div className={cn(
        "reevit-method-selector__options",
        isGrid ? "reevit-method-selector__options--grid" : "reevit-method-selector__options--list"
      )}>
        {methods.map((method, index) => {
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
                isGrid ? "reevit-method-option--grid" : "reevit-method-option--list",
                isSelected && "reevit-method-option--selected",
                disabled && "reevit-method-option--disabled",
              )}
              style={{
                animationDelay: `${index * 0.05}s`
              }}
              onClick={() => onSelect(method)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              <span className="reevit-method-option__icon-wrapper">
                <span className="reevit-method-option__icon">{config.icon}</span>
              </span>
              <div className="reevit-method-option__content">
                <span className="reevit-method-option__label">{methodLabel}</span>
                {!isGrid && (
                  <span className="reevit-method-option__description">
                    {methodDescription}
                  </span>
                )}
              </div>
              {!isGrid && isSelected && (
                <span className="reevit-method-option__check">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </span>
              )}
              {!isGrid && !isSelected && (
                <span className="reevit-method-option__chevron">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
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
