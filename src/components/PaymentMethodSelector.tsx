/**
 * PaymentMethodSelector Component
 * Displays available payment methods for user selection
 */

import type { PaymentMethod } from '../types';
import { cn } from '../utils';

interface PaymentMethodSelectorProps {
  methods: PaymentMethod[];
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  disabled?: boolean;
}

// Payment method configuration
const methodConfig: Record<PaymentMethod, { label: string; icon: string; description: string }> = {
  card: {
    label: 'Card',
    icon: '💳',
    description: 'Pay with Visa, Mastercard, or other cards',
  },
  mobile_money: {
    label: 'Mobile Money',
    icon: '📱',
    description: 'MTN, Vodafone Cash, AirtelTigo Money',
  },
  bank_transfer: {
    label: 'Bank Transfer',
    icon: '🏦',
    description: 'Pay directly from your bank account',
  },
};

export function PaymentMethodSelector({
  methods,
  selectedMethod,
  onSelect,
  disabled = false,
}: PaymentMethodSelectorProps) {
  return (
    <div className="reevit-method-selector">
      <div className="reevit-method-selector__label">Select payment method</div>
      <div className="reevit-method-selector__options">
        {methods.map((method) => {
          const config = methodConfig[method];
          const isSelected = selectedMethod === method;

          return (
            <button
              key={method}
              type="button"
              className={cn(
                'reevit-method-option',
                isSelected && 'reevit-method-option--selected',
                disabled && 'reevit-method-option--disabled'
              )}
              onClick={() => onSelect(method)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              <span className="reevit-method-option__icon">{config.icon}</span>
              <div className="reevit-method-option__content">
                <span className="reevit-method-option__label">{config.label}</span>
                <span className="reevit-method-option__description">{config.description}</span>
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
