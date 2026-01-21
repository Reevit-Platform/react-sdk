/**
 * ProviderSelector Component
 * Displays available PSPs with accordion-style payment method selection
 */

import type { CheckoutProviderOption, PaymentMethod, ReevitTheme } from "../types";
import { cn, resolveAssetSrc } from "../utils";
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
  /** Country code for dynamic logos (e.g., 'GH', 'NG', 'KE') */
  country?: string;
  // Accordion mode props
  selectedMethod?: PaymentMethod | null;
  onMethodSelect?: (method: PaymentMethod) => void;
  renderMethodContent?: (provider: string, method: PaymentMethod) => JSX.Element | null;
}

const providerMeta: Record<string, { logo?: string; hint: string }> = {
  paystack: { logo: resolveAssetSrc(paystackLogo), hint: "Card & Mobile Money" },
  stripe: { logo: resolveAssetSrc(stripeLogo), hint: "Card payments" },
  flutterwave: { logo: resolveAssetSrc(flutterwaveLogo), hint: "Global methods" },
  hubtel: { logo: resolveAssetSrc(hubtelLogo), hint: "Mobile Money & Card" },
  monnify: { logo: resolveAssetSrc(monnifyLogo), hint: "Bank & Card" },
  mpesa: { logo: resolveAssetSrc(mpesaLogo), hint: "M-Pesa" },
};

const methodLabels: Record<PaymentMethod, string> = {
  card: "Card",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank Transfer",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

const methodIcons: Record<PaymentMethod, string> = {
  card: "💳",
  mobile_money: "📱",
  bank_transfer: "🏦",
  apple_pay: "🍎",
  google_pay: "🤖",
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
  country = 'GH',
  selectedMethod,
  onMethodSelect,
  renderMethodContent,
}: ProviderSelectorProps) {

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

          // Get country from provider's countries array
          const providerCountry = provider.countries?.[0] || country;

          const logoSrc = resolveAssetSrc(meta.logo);

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
                onClick={() => onSelect(provider.provider)}
                disabled={disabled}
                aria-expanded={isSelected}
              >
                <span className="reevit-psp-option__logo" aria-hidden="true">
                  {logoSrc ? (
                    <img
                      src={logoSrc}
                      alt=""
                      className="reevit-psp-option__logo-img"
                      loading="lazy"
                    />
                  ) : (
                    <span className="reevit-psp-option__logo-fallback">{fallbackInitial}</span>
                  )}
                </span>
                <div className="reevit-psp-option__content">
                  <span className="reevit-psp-option__name">
                    Pay with {provider.name}
                  </span>
                  <span className="reevit-psp-option__methods">
                    {formatMethods(providerMethods) || meta.hint}
                  </span>
                </div>
              </button>

              {/* Expanded Payment Methods */}
              {isSelected && onMethodSelect && (
                <div
                  className="reevit-psp-accordion__content"
                  style={theme?.selectedBorderColor ? {
                    borderTop: `1px solid ${theme.selectedBorderColor}`,
                  } : undefined}
                >
                  {/* Back button */}
                  <button
                    type="button"
                    className="reevit-psp-back-button"
                    onClick={() => onSelect('')}
                    disabled={disabled}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span>Back to providers</span>
                  </button>

                  <div className="reevit-psp-methods">
                    <PaymentMethodSelector
                      methods={providerMethods}
                      selectedMethod={selectedMethod || null}
                      onSelect={onMethodSelect}
                      disabled={disabled}
                      provider={provider.provider}
                      layout="list"
                      showLabel={false}
                      country={providerCountry}
                      selectedTheme={theme ? {
                        backgroundColor: theme.selectedBackgroundColor,
                        textColor: theme.selectedTextColor,
                        descriptionColor: theme.selectedDescriptionColor,
                        borderColor: theme.selectedBorderColor,
                      } : undefined}
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
