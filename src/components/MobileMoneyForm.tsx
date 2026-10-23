/**
 * MobileMoneyForm
 * Collects the mobile money number. Two layouts:
 *  - `network` (Ghana): number + network picker. The network is auto-selected
 *    from the number's prefix as it is typed and can be overridden.
 *  - `mpesa` (Kenya): +254 prefix, M-Pesa mark, no network choice. The submitted
 *    phone is normalised to `254XXXXXXXXX`, which is what the M-Pesa bridge sends.
 */

import { useState, useCallback, useId } from 'react';
import type { MobileMoneyNetwork, MobileMoneyFormData } from '../types';
import { validatePhone, detectNetwork, cn, getMethodMarks } from '../utils';
import { Scope } from './Scope';

interface MobileMoneyFormProps {
  onSubmit: (data: MobileMoneyFormData) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  initialPhone?: string;
  /** Hide the secondary Back button (the panel header already has one). */
  hideCancel?: boolean;
  mode?: 'network' | 'mpesa';
  /** Primary button label, e.g. "Pay GHS 755.00". */
  submitLabel?: string;
}

const NETWORKS: { id: Exclude<MobileMoneyNetwork, 'mpesa'>; name: string }[] = [
  { id: 'mtn', name: 'MTN' },
  { id: 'telecel', name: 'Telecel' },
  { id: 'airteltigo', name: 'AirtelTigo' },
];

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** 0244128890 -> "024 412 8890". International input (+233…) is left as typed. */
function formatLocal(value: string): string {
  if (value.startsWith('+')) return '+' + digitsOf(value).slice(0, 12);
  const d = digitsOf(value).slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
}

/** National part of a Kenyan number: strips +254 / 254 / a leading 0, keeps 9 digits. */
function nationalKenya(value: string): string {
  let d = digitsOf(value);
  if (d.startsWith('254')) d = d.slice(3);
  return d.replace(/^0/, '').slice(0, 9);
}

const formatKenya = (value: string) => (nationalKenya(value).match(/.{1,3}/g) || []).join(' ');

export function MobileMoneyForm({
  onSubmit,
  onCancel,
  isLoading = false,
  initialPhone = '',
  hideCancel = false,
  mode = 'network',
  submitLabel = 'Continue',
}: MobileMoneyFormProps) {
  const mpesa = mode === 'mpesa';
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const networkErrorId = `${inputId}-network-error`;

  const [phone, setPhone] = useState(() => (mpesa ? formatKenya(initialPhone) : formatLocal(initialPhone)));
  const [network, setNetwork] = useState<MobileMoneyNetwork | null>(() => {
    if (mpesa) return 'mpesa';
    return initialPhone ? (detectNetwork(initialPhone) as MobileMoneyNetwork | null) : null;
  });
  // Detection only overrides the choice when the number's operator changes, so a
  // manual pick survives further typing within the same operator.
  const [lastDetected, setLastDetected] = useState<string | null>(() => (!mpesa && initialPhone ? detectNetwork(initialPhone) : null));
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (mpesa) {
      setPhone(formatKenya(e.target.value));
      return;
    }
    const next = formatLocal(e.target.value.replace(/[^0-9+]/g, ''));
    setPhone(next);
    const detected = detectNetwork(next.replace(/\s/g, ''));
    if (detected && detected !== lastDetected) {
      setNetwork(detected as MobileMoneyNetwork);
      setNetworkError(null);
    }
    setLastDetected(detected);
  }, [mpesa, lastDetected]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (mpesa) {
        const national = nationalKenya(phone);
        if (national.length !== 9 || !/^[17]/.test(national)) {
          setError('Enter a valid M-Pesa number');
          return;
        }
        onSubmit({ phone: `254${national}`, network: 'mpesa' });
        return;
      }

      const raw = phone.replace(/\s/g, '');
      if (!raw || !validatePhone(raw)) {
        setError('Enter a 10-digit number, like 024 412 8890');
        return;
      }
      if (!network) {
        setNetworkError('Choose your network');
        return;
      }
      if (!validatePhone(raw, network)) {
        setError('This number doesn’t match the selected network');
        return;
      }
      onSubmit({ phone: raw, network });
    },
    [mpesa, phone, network, onSubmit]
  );

  const logos = mpesa ? [] : getMethodMarks('GH', 'mobile_money');
  const suffix = mpesa ? getMethodMarks('KE', 'mobile_money')[0] : undefined;

  return (
    <Scope>
      <form className="reevit-form" data-reevit="momo-form" onSubmit={handleSubmit} noValidate>
        <div className="reevit-field">
          <label htmlFor={inputId}>{mpesa ? 'M-Pesa number' : 'Mobile money number'}</label>
          <div className={cn('reevit-input', mpesa && 'reevit-input--prefixed', !!error && 'reevit-input--invalid')}>
            {mpesa && <span className="reevit-prefix" aria-hidden="true">+254</span>}
            <input
              id={inputId}
              type="tel"
              inputMode="tel"
              className="reevit-mono"
              autoComplete="tel-national"
              placeholder={mpesa ? '712 345 678' : '024 412 8890'}
              value={phone}
              onChange={handlePhoneChange}
              disabled={isLoading}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              data-first=""
            />
            {suffix && (
              <span className="reevit-suffix" aria-hidden="true">
                <img src={suffix.src} data-mark={suffix.key} alt="" />
              </span>
            )}
          </div>
          {error && <p className="reevit-error" id={errorId} role="alert">{error}</p>}
        </div>

        {!mpesa && (
          <fieldset className="reevit-group">
            <legend>Network</legend>
            <div className="reevit-networks">
              {NETWORKS.map((n) => {
                const logo = logos.find((mark) => mark.key === n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className="reevit-network"
                    aria-pressed={network === n.id}
                    disabled={isLoading}
                    onClick={() => { setNetwork(n.id); setNetworkError(null); }}
                  >
                    {logo && <img src={logo.src} data-mark={logo.key} alt="" />}
                    {n.name}
                  </button>
                );
              })}
            </div>
            {networkError && <p className="reevit-error" id={networkErrorId} role="alert">{networkError}</p>}
          </fieldset>
        )}

        <button type="submit" className="reevit-cta" data-reevit="cta" disabled={isLoading}>
          {isLoading ? 'Please wait' : submitLabel}
        </button>
        {!hideCancel && (
          <button type="button" className="reevit-cta-secondary" onClick={onCancel} disabled={isLoading}>
            Back
          </button>
        )}
      </form>
    </Scope>
  );
}
