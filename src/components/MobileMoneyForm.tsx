/**
 * MobileMoneyForm Component
 * Form for collecting mobile money payment details
 */

import { useState, useEffect, useCallback } from 'react';
import type { MobileMoneyNetwork, MobileMoneyFormData } from '../types';
import { validatePhone, detectNetwork, formatPhone, cn } from '../utils';

interface MobileMoneyFormProps {
  onSubmit: (data: MobileMoneyFormData) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  initialPhone?: string;
  hideCancel?: boolean;
}

const networks: { id: MobileMoneyNetwork; name: string; color: string }[] = [
  { id: 'mtn', name: 'MTN', color: '#FFCC00' },
  { id: 'vodafone', name: 'Vodafone', color: '#E60000' },
  { id: 'airteltigo', name: 'AirtelTigo', color: '#E4002B' },
];

export function MobileMoneyForm({
  onSubmit,
  onCancel,
  isLoading = false,
  initialPhone = '',
  hideCancel = false,
}: MobileMoneyFormProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [network, setNetwork] = useState<MobileMoneyNetwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Auto-detect network from phone number
  useEffect(() => {
    if (phone.length >= 3) {
      const detected = detectNetwork(phone);
      if (detected) {
        setNetwork(detected as MobileMoneyNetwork);
      }
    }
  }, [phone]);

  // Validate on change
  useEffect(() => {
    if (touched && phone) {
      if (!validatePhone(phone)) {
        setError('Please enter a valid Ghana phone number');
      } else if (network && !validatePhone(phone, network)) {
        setError(`This number doesn't match the selected network`);
      } else {
        setError(null);
      }
    }
  }, [phone, network, touched]);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9+]/g, '');
    setPhone(value);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);

      if (!phone || !network) {
        setError('Please enter your phone number and select a network');
        return;
      }

      if (!validatePhone(phone, network)) {
        setError('Invalid phone number for selected network');
        return;
      }

      onSubmit({ phone, network });
    },
    [phone, network, onSubmit]
  );

  const isValid = phone && network && validatePhone(phone, network);

  return (
    <form className="reevit-momo-form" onSubmit={handleSubmit}>
      <div className="reevit-momo-form__field">
        <label htmlFor="reevit-phone" className="reevit-momo-form__label">
          Phone Number
        </label>
        <input
          id="reevit-phone"
          type="tel"
          className={cn('reevit-momo-form__input', !!error && 'reevit-momo-form__input--error')}
          placeholder="024 XXX XXXX"
          value={phone}
          onChange={handlePhoneChange}
          onBlur={() => setTouched(true)}
          disabled={isLoading}
          autoComplete="tel"
        />
        {phone && !error && (
          <div className="reevit-momo-form__formatted">{formatPhone(phone)}</div>
        )}
        {error && <div className="reevit-momo-form__error">{error}</div>}
      </div>

      <div className="reevit-momo-form__field">
        <label className="reevit-momo-form__label">Select Network</label>
        <div className="reevit-momo-form__networks">
          {networks.map((n) => (
            <button
              key={n.id}
              type="button"
              className={cn(
                'reevit-network-btn',
                network === n.id && 'reevit-network-btn--selected'
              )}
              style={{ '--network-color': n.color } as React.CSSProperties}
              onClick={() => setNetwork(n.id)}
              disabled={isLoading}
            >
              {n.name}
            </button>
          ))}
        </div>
      </div>

      <div className="reevit-momo-form__actions">
        {!hideCancel && (
          <button
            type="button"
            className="reevit-btn reevit-btn--secondary"
            onClick={onCancel}
            disabled={isLoading}
          >
            Back
          </button>
        )}
        <button
          type="submit"
          className="reevit-btn reevit-btn--primary"
          disabled={!isValid || isLoading}
        >
          {isLoading ? (
            <span className="reevit-spinner" />
          ) : (
            'Continue'
          )}
        </button>
      </div>

      <p className="reevit-momo-form__hint">
        You will receive a USSD prompt on your phone to authorize the payment.
      </p>
    </form>
  );
}
