/**
 * PaymentMethodSelector Component
 * Displays available payment methods for user selection
 */

import type { PaymentMethod } from "../types";
import { cn, getMethodLogos } from "../utils";

interface PaymentMethodSelectorProps {
  methods: PaymentMethod[];
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  disabled?: boolean;
  provider?: string;
  layout?: 'grid' | 'list';
  showLabel?: boolean;
  /** Country code for dynamic logos (e.g., 'GH', 'NG', 'KE') */
  country?: string;
  /** Selected theme colors for method items */
  selectedTheme?: {
    backgroundColor?: string;
    textColor?: string;
    descriptionColor?: string;
    borderColor?: string;
  };
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
  country = 'GH',
  selectedTheme,
}: PaymentMethodSelectorProps) {
  const getMethodLabel = (method: PaymentMethod, psp?: string): string => {
    const config = methodConfig[method];
    return config.label;
  };

  const getMethodDescription = (method: PaymentMethod, psp?: string, countryCode?: string): string => {
    const c = (countryCode || country).toUpperCase();

    if (method === 'mobile_money') {
      const mobileMoneyDescriptions: Record<string, string> = {
        GH: 'MTN, Vodafone Cash, AirtelTigo Money',
        KE: 'M-Pesa, Airtel Money',
        NG: 'MTN MoMo, Airtel Money',
        ZA: 'Mobile Money',
      };
      return mobileMoneyDescriptions[c] || 'Mobile Money';
    }

    if (method === 'card') {
      return 'Pay with Visa, Mastercard, or other cards';
    }

    if (method === 'bank_transfer') {
      return 'Pay directly from your bank account';
    }

    return '';
  };

  const isGrid = layout === 'grid';

  return (
    <div className={cn("reevit-method-selector", isGrid && "reevit-method-selector--grid")}>
      {showLabel && <div className="reevit-method-selector__label">Select payment method</div>}
      <div
        className={cn(
          "reevit-method-selector__options",
          isGrid ? "reevit-method-selector__options--grid" : "reevit-method-selector__options--list"
        )}
        style={selectedTheme?.backgroundColor ? { backgroundColor: selectedTheme.backgroundColor } : undefined}
      >
        {methods.map((method, index) => {
          const config = methodConfig[method];
          const isSelected = selectedMethod === method;
          const methodLabel = getMethodLabel(method, provider);
          const methodDescription = getMethodDescription(method, provider);
          const logos = getMethodLogos(country, method);

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
                animationDelay: `${index * 0.05}s`,
                borderBottomColor: selectedTheme?.borderColor,
              }}
              onClick={() => onSelect(method)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              <span className="reevit-method-option__icon-wrapper">
                {logos.length > 0 ? (
                  <span className="reevit-method-option__logos">
                    {logos.slice(0, 3).map((logo, i) => (
                      <img
                        key={i}
                        src={logo}
                        alt=""
                        className="reevit-method-option__logo-img"
                      />
                    ))}
                  </span>
                ) : (
                  <span className="reevit-method-option__icon">{config.icon}</span>
                )}
              </span>
              <div className="reevit-method-option__content">
                <span className="reevit-method-option__label" style={selectedTheme?.textColor ? { color: selectedTheme.textColor } : undefined}>
                  {methodLabel}
                </span>
                {!isGrid && (
                  <span className="reevit-method-option__description" style={selectedTheme?.descriptionColor ? { color: selectedTheme.descriptionColor } : undefined}>
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
