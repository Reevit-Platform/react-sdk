/**
 * ProviderSelector Component
 * Displays available PSPs for customer selection
 */

import type { CheckoutProviderOption, PaymentMethod } from "../types";
import { cn } from "../utils";

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
}

const providerMeta: Record<string, { logo?: string; hint: string }> = {
  paystack: { logo: paystackLogo, hint: "Card & MoMo" },
  stripe: { logo: stripeLogo, hint: "Card payments" },
  flutterwave: { logo: flutterwaveLogo, hint: "Global methods" },
  hubtel: { logo: hubtelLogo, hint: "Mobile money" },
  monnify: { logo: monnifyLogo, hint: "Bank & card" },
  mpesa: { logo: mpesaLogo, hint: "M-Pesa" },
};

const methodLabels: Record<PaymentMethod, string> = {
  card: "Card",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank Transfer",
};

function formatMethods(methods: PaymentMethod[]): string {
  if (!methods.length) return "Payment methods";
  return methods.map((method) => methodLabels[method]).join(" • ");
}

export function ProviderSelector({
  providers,
  selectedProvider,
  onSelect,
  disabled = false,
}: ProviderSelectorProps) {
  return (
    <div className="reevit-psp-selector">
      <div className="reevit-psp-selector__label">Choose your payment provider</div>
      <div className="reevit-psp-selector__options">
        {providers.map((provider) => {
          const meta = providerMeta[provider.provider] || {
            logo: undefined,
            hint: "Payment methods",
          };
          const isSelected = selectedProvider === provider.provider;
          const fallbackInitial = provider.name.slice(0, 1).toUpperCase();

          return (
            <button
              key={provider.provider}
              type="button"
              className={cn(
                "reevit-psp-option",
                isSelected && "reevit-psp-option--selected",
                disabled && "reevit-psp-option--disabled",
              )}
              onClick={() => onSelect(provider.provider)}
              disabled={disabled}
              aria-pressed={isSelected}
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
                  {formatMethods(provider.methods) || meta.hint}
                </span>
              </div>
              <span className="reevit-psp-option__check" aria-hidden="true">
                {isSelected ? "Selected" : "Select"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
