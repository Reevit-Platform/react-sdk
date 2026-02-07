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

// Inline SVG icons — consistent across all platforms, themeable via currentColor
const MethodIcons: Record<PaymentMethod, () => JSX.Element> = {
  card: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="3" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <line x1="5" y1="15" x2="9" y2="15" />
    </svg>
  ),
  mobile_money: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  bank_transfer: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M3 10h18" />
      <path d="M12 3l9 7H3l9-7z" />
      <path d="M6 10v8" />
      <path d="M10 10v8" />
      <path d="M14 10v8" />
      <path d="M18 10v8" />
    </svg>
  ),
  apple_pay: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  ),
  google_pay: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" fill="currentColor" />
    </svg>
  ),
};

// Payment method configuration
const methodConfig: Record<
  PaymentMethod,
  { label: string; description: string }
> = {
  card: {
    label: "Card",
    description: "Pay with Visa, Mastercard, or other cards",
  },
  mobile_money: {
    label: "Mobile Money",
    description: "MTN, Telecel, AirtelTigo Money",
  },
  bank_transfer: {
    label: "Bank Transfer",
    description: "Pay directly from your bank account",
  },
  apple_pay: {
    label: "Apple Pay",
    description: "Pay with Apple Pay",
  },
  google_pay: {
    label: "Google Pay",
    description: "Pay with Google Pay",
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
        GH: 'MTN, Telecel, AirtelTigo Money',
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
                  <span className="reevit-method-option__icon">
                    {MethodIcons[method]()}
                  </span>
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
