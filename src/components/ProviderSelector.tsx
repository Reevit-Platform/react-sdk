/**
 * ProviderSelector Component
 * Displays available PSPs with accordion-style payment method selection
 */

import type { CheckoutProviderOption, PaymentMethod, ReevitTheme } from "../types";
import { cn } from "../utils";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

import flutterwaveLogo from "../assets/providers/flutterwave.png";
import hubtelLogo from "../assets/providers/hubtel.png";
import monnifyLogo from "../assets/providers/monnify.png";
import mpesaLogo from "../assets/providers/mpesa.png";
import paystackLogo from "../assets/providers/paystack.png";
import stripeLogo from "../assets/providers/stripe.png";

interface ProviderSelectorProps {
  providers: CheckoutProviderOption[];
  selectedProvider: string | null;
  onSelect: (provider: string) => void;
  disabled?: boolean;
  theme?: ReevitTheme;
  // Accordion mode props
  selectedMethod?: PaymentMethod | null;
  onMethodSelect?: (method: PaymentMethod) => void;
  renderMethodContent?: (provider: string, method: PaymentMethod) => React.ReactNode;
}

const providerMeta: Record<string, { logo?: string; hint: string }> = {
  paystack: { logo: paystackLogo, hint: "Card & Mobile Money" },
  stripe: { logo: stripeLogo, hint: "Card payments" },
  flutterwave: { logo: flutterwaveLogo, hint: "Global methods" },
  hubtel: { logo: hubtelLogo, hint: "Mobile Money & Card" },
  monnify: { logo: monnifyLogo, hint: "Bank & Card" },
  mpesa: { logo: mpesaLogo, hint: "M-Pesa" },
};

const methodLabels: Record<PaymentMethod, string> = {
  card: "Card",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank Transfer",
};

const methodIcons: Record<PaymentMethod, string> = {
  card: "💳",
  mobile_money: "📱",
  bank_transfer: "🏦",
};

function formatMethods(methods: PaymentMethod[]): string {
  if (!methods.length) return "Payment methods";
  return methods.map((method) => methodLabels[method]).join(", ");
}

function sanitizeMethods(providerId: string, methods: PaymentMethod[]): PaymentMethod[] {
  if (providerId.toLowerCase().includes("hubtel")) {
    return methods.filter((method) => method === "card" || method === "mobile_money");
  }
  return methods;
}

export function ProviderSelector({
  providers,
  selectedProvider,
  onSelect,
  disabled = false,
  theme,
  selectedMethod,
  onMethodSelect,
  renderMethodContent,
}: ProviderSelectorProps) {
  // PSP selector styling from theme
  const useBorder = theme?.pspSelectorUseBorder ?? false;
  const bgColor = theme?.pspSelectorBgColor || "#0a0a0a";
  const textColor = theme?.pspSelectorTextColor || "#ffffff";
  const borderColor = theme?.pspSelectorBorderColor || "#374151";

  const getOptionStyle = (isSelected: boolean) => {
    if (useBorder) {
      return {
        backgroundColor: "transparent",
        border: `2px solid ${isSelected ? borderColor : "#374151"}`,
        color: isSelected ? textColor : "var(--reevit-text)",
      };
    }
    return {
      backgroundColor: isSelected ? bgColor : "transparent",
      border: `2px solid ${isSelected ? bgColor : "#374151"}`,
      color: isSelected ? textColor : "var(--reevit-text)",
    };
  };

  return (
    <div className="reevit-psp-selector">
      <div className="reevit-psp-selector__label">Select payment provider</div>
      <div className="reevit-psp-selector__options">
        {providers.map((provider) => {
          const meta = providerMeta[provider.provider] || {
            logo: undefined,
            hint: "Payment methods",
          };
          const providerMethods = sanitizeMethods(provider.provider, provider.methods);
          const isSelected = selectedProvider === provider.provider;
          const fallbackInitial = provider.name.slice(0, 1).toUpperCase();
          const optionStyle = getOptionStyle(isSelected);

          return (
            <div key={provider.provider} className="reevit-psp-accordion">
              {/* PSP Header */}
              <button
                type="button"
                className={cn(
                  "reevit-psp-option",
                  isSelected && "reevit-psp-option--selected",
                  disabled && "reevit-psp-option--disabled",
                )}
                style={optionStyle}
                onClick={() => onSelect(provider.provider)}
                disabled={disabled}
                aria-expanded={isSelected}
              >
                <span className="reevit-psp-option__logo" aria-hidden="true">
                  {meta.logo ? (
                    <img
                      src={meta.logo}
                      alt=""
                      className="reevit-psp-option__logo-img"
                      loading="lazy"
                    />
                  ) : (
                    <span className="reevit-psp-option__logo-fallback">{fallbackInitial}</span>
                  )}
                </span>
                <div className="reevit-psp-option__content">
                  <span className="reevit-psp-option__name">{provider.name}</span>
                  <span className="reevit-psp-option__methods">
                    {formatMethods(providerMethods) || meta.hint}
                  </span>
                </div>
              </button>

              {/* Expanded Payment Methods */}
              {isSelected && onMethodSelect && (
                <div className="reevit-psp-accordion__content">
                  <div className="reevit-psp-methods">
                    <PaymentMethodSelector
                      methods={providerMethods}
                      selectedMethod={selectedMethod || null}
                      onSelect={onMethodSelect}
                      disabled={disabled}
                      provider={provider.provider}
                      layout="list"
                      showLabel={false}
                    />
                  </div>

                  {/* Inline content for selected method */}
                  {selectedMethod && renderMethodContent && (
                    <div className="reevit-psp-accordion__method-content">
                      {renderMethodContent(provider.provider, selectedMethod)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
