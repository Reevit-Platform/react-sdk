/**
 * MobileMoneyForm Component
 * Collects the mobile money phone number and network. The network is
 * auto-selected from the number's prefix as the user types, and can also
 * be picked manually.
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

const networks: { id: MobileMoneyNetwork; name: string }[] = [
  { id: 'mtn', name: 'MTN' },
  { id: 'telecel', name: 'Telecel' },
  { id: 'airteltigo', name: 'AirtelTigo' },
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

  // Auto-select the network that matches the number's prefix as it's typed.
  // The user can still override by tapping a network button.
  useEffect(() => {
    const detected = detectNetwork(phone) as MobileMoneyNetwork | null;
    if (detected) {
      setNetwork(detected);
    }
  }, [phone]);

  useEffect(() => {
    if (touched && phone) {
      if (!validatePhone(phone)) {
        setError('Enter a valid mobile money number');
      } else if (network && !validatePhone(phone, network)) {
        setError("This number doesn't match the selected network");
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

      if (!phone || !validatePhone(phone)) {
        setError('Enter a valid mobile money number');
        return;
      }

      if (!network) {
        setError('Select your mobile money network');
        return;
      }

      if (!validatePhone(phone, network)) {
        setError("This number doesn't match the selected network");
        return;
      }

      onSubmit({ phone, network });
    },
    [phone, network, onSubmit]
  );

  const isValid = !!phone && !!network && validatePhone(phone, network);

  return (
    <form className="reevit-brut__momo" onSubmit={handleSubmit}>
      <div className="reevit-brut__field">
        <label htmlFor="reevit-phone" className="reevit-brut__field-label">
          Phone number
        </label>
        <input
          id="reevit-phone"
          type="tel"
          className={cn('reevit-brut__input', !!error && 'reevit-brut__input--error')}
          placeholder="024 XXX XXXX"
          value={phone}
          onChange={handlePhoneChange}
          onBlur={() => setTouched(true)}
          disabled={isLoading}
          autoComplete="tel"
        />
        {phone && !error && (
          <div className="reevit-brut__input-note">{formatPhone(phone)}</div>
        )}
        {error && <div className="reevit-brut__input-error">{error}</div>}
      </div>

      <div className="reevit-brut__field">
        <span className="reevit-brut__field-label">Select network</span>
        <div className="reevit-brut__networks">
          {networks.map((n) => (
            <button
              key={n.id}
              type="button"
              className="reevit-brut__network"
              data-selected={network === n.id}
              onClick={() => setNetwork(n.id)}
              disabled={isLoading}
            >
              {n.name}
            </button>
          ))}
        </div>
      </div>

      <div className="reevit-brut__momo-actions">
        {!hideCancel && (
          <button
            type="button"
            className="reevit-brut__cta reevit-brut__cta--ghost"
            onClick={onCancel}
            disabled={isLoading}
          >
            <span>BACK</span>
          </button>
        )}
        <button
          type="submit"
          className="reevit-brut__cta"
          disabled={!isValid || isLoading}
        >
          {isLoading ? (
            <span>PLEASE WAIT</span>
          ) : (
            <>
              <span>CONTINUE</span>
              <span>&rarr;</span>
            </>
          )}
        </button>
      </div>

      <p className="reevit-brut__momo-hint">
        You will receive a USSD prompt on your phone to authorize the payment.
      </p>
    </form>
  );
}
