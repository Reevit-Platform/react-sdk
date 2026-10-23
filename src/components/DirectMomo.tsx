/**
 * Direct mobile money panels (Ledger): waiting for approval, entering an OTP or
 * voucher, and the declined / insufficient / timeout results. They render the
 * state of `useDirectCharge`; they decide nothing themselves.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import type { DirectCharge, DirectFailure } from '../hooks/useDirectCharge';
import { FAILOVER_NOW } from '../hooks/useDirectCharge';
import { Scope } from './Scope';

export const NETWORK_LABEL: Record<string, string> = {
  mtn: 'MTN MoMo',
  telecel: 'Telecel Cash',
  airteltigo: 'AirtelTigo Money',
  mpesa: 'M-Pesa',
};

/** 0244128890 -> "024 412 8890"; 254712345678 -> "+254 712 345 678". Anything else as given. */
export function formatPayerPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  if (digits.startsWith('233') && digits.length === 12) return formatPayerPhone(`0${digits.slice(3)}`);
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return phone;
}

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Seconds left and the share of the window still ahead, ticking four times a second. */
export function useCountdown(expiresAt: number | null, startedAt: number | null, now: () => number = Date.now) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return { seconds: 0, fraction: 0 };
  const remaining = Math.max(0, expiresAt - now());
  const total = Math.max(1, expiresAt - (startedAt ?? expiresAt - 120_000));
  return { seconds: Math.ceil(remaining / 1000), fraction: Math.min(1, remaining / total) };
}

interface WaitProps {
  charge: DirectCharge;
  /** The number as the shopper typed it; falls back to the server's masked form. */
  phoneText: string;
  network?: string;
  now?: () => number;
}

export function MomoWaitPanel({ charge, phoneText, network, now }: WaitProps) {
  const { seconds, fraction } = useCountdown(charge.expiresAt, charge.startedAt, now);
  const resendWait = charge.canResendAt ? Math.max(0, Math.ceil((charge.canResendAt - (now ?? Date.now)()) / 1000)) : 0;
  const resendReady = !charge.resendClosed && !charge.resending && resendWait === 0;
  const status = charge.notice ?? (charge.attempt?.rerouted ? FAILOVER_NOW : '');
  const label = (network && NETWORK_LABEL[network]) || 'mobile money';

  return (
    <Scope>
      <div className="reevit-wait" data-reevit="momo-wait" data-payment-id={charge.attempt?.id}>
        <span className="reevit-spin reevit-spin--lg" aria-hidden="true" />
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">Approve on your phone</h2>
        <p className="reevit-text">
          Check <span className="reevit-mono">{phoneText}</span> for a {label} prompt.
        </p>
        <div className="reevit-countdown">
          <span className="reevit-mono" data-reevit="countdown" role="timer" aria-label="Time left">{mmss(seconds)}</span>
          <div className="reevit-bar" aria-hidden="true"><i style={{ transform: `scaleX(${fraction})` }} /></div>
        </div>
        <p className="reevit-status" data-reevit="status" role="status" aria-live="polite">{status}</p>
        <button
          type="button"
          className="reevit-cta"
          data-reevit="cta"
          data-first=""
          disabled={charge.checking}
          onClick={() => void charge.check()}
        >
          I’ve approved
        </button>
        <div className="reevit-links">
          {!charge.resendClosed && (
            <button
              type="button"
              className="reevit-link"
              data-reevit="resend"
              disabled={!resendReady}
              aria-disabled={!resendReady}
              onClick={() => void charge.resend()}
            >
              {resendWait > 0 ? `Resend prompt in ${resendWait}s` : 'Resend prompt'}
            </button>
          )}
          <button type="button" className="reevit-link" data-reevit="change-number" onClick={charge.useAnotherNumber}>
            Use another number
          </button>
        </div>
      </div>
    </Scope>
  );
}

interface CodeProps {
  charge: DirectCharge;
  now?: () => number;
}

/** One field for the OTP or voucher the provider asked for. */
export function MomoCodePanel({ charge }: CodeProps) {
  const id = useId();
  const [code, setCode] = useState('');
  const voucher = charge.codeKind === 'voucher';
  const action = charge.attempt?.next_action;
  const masked = action?.phone_masked;
  const ussd = action?.voucher?.ussd;
  const busy = charge.phase === 'submitting';
  const ready = code.replace(/\D/g, '').length >= 4;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const value = code.replace(/\s/g, '');
    void charge.submitCode(value);
  };

  return (
    <Scope>
      <div data-reevit="momo-code" data-kind={voucher ? 'voucher' : 'otp'}>
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
          {voucher ? 'Enter your voucher' : 'Enter your code'}
        </h2>
        <p className="reevit-text">
          {voucher ? (
            ussd ? <>Dial <span className="reevit-mono">{ussd}</span> for your voucher.</> : (action?.voucher?.hint ?? 'Get a voucher from your phone’s menu.')
          ) : (
            <>Sent to <span className="reevit-mono">{masked ?? 'your phone'}</span>.</>
          )}
        </p>
        <form className="reevit-form reevit-code-form" onSubmit={submit} noValidate>
          <div className="reevit-field">
            <div className={charge.codeError ? 'reevit-input reevit-input--invalid' : 'reevit-input'}>
              <input
                id={id}
                aria-label={voucher ? 'Voucher code' : 'Code'}
                className="reevit-mono"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="••••••"
                value={code}
                disabled={busy}
                aria-invalid={charge.codeError ? 'true' : undefined}
                aria-describedby={charge.codeError ? `${id}-error` : undefined}
                data-first=""
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              />
            </div>
            {charge.codeError && <p className="reevit-error" id={`${id}-error`} role="alert">{charge.codeError}</p>}
          </div>
          <button type="submit" className="reevit-cta" data-reevit="cta" disabled={!ready || busy}>
            {busy ? 'Please wait' : 'Continue'}
          </button>
          <div className="reevit-links">
            <button type="button" className="reevit-link" data-reevit="change-number" onClick={charge.useAnotherNumber}>
              Use another number
            </button>
          </div>
        </form>
      </div>
    </Scope>
  );
}

interface FailureProps {
  charge: DirectCharge;
  failure: DirectFailure;
  /** Offer "Choose another method" when the list has more than one method. */
  canChooseAnother: boolean;
  onChooseAnother: () => void;
  onClose: () => void;
}

/** Declined, insufficient funds, no response, provider trouble, locked, out of attempts. */
export function MomoFailurePanel({ charge, failure, canChooseAnother, onChooseAnother, onClose }: FailureProps) {
  const resendable = failure.kind === 'timeout' && !charge.resendClosed;
  const exhausted = failure.kind === 'exhausted' || !failure.retryable;
  const primary = exhausted
    ? null
    : resendable
      ? { label: 'Send a new prompt', run: () => void charge.resend(), busy: charge.resending }
      : { label: 'Try again', run: () => void charge.retry(), busy: false };

  return (
    <Scope>
      <div className="reevit-result reevit-result--prompt" data-reevit="failure" data-failure={failure.kind}>
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
          <span className="reevit-fail-dot" aria-hidden="true" />
          {failure.title}
        </h2>
        <p className="reevit-text">{failure.message}</p>
        {charge.notice && <p className="reevit-status" data-reevit="status" role="status" aria-live="polite">{charge.notice}</p>}
        {primary && (
          <button type="button" className="reevit-cta" data-reevit="cta" data-first="" disabled={primary.busy} onClick={primary.run}>
            {primary.label}
          </button>
        )}
        {!exhausted && (
          <button type="button" className="reevit-cta-secondary" data-reevit="change-number" onClick={charge.useAnotherNumber}>
            Use another number
          </button>
        )}
        {exhausted && !canChooseAnother && (
          <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={onClose}>Close</button>
        )}
        {canChooseAnother && (
          <div className="reevit-links">
            <button type="button" className="reevit-link" data-reevit="choose-another" data-first={exhausted ? '' : undefined} onClick={onChooseAnother}>
              Choose another method
            </button>
          </div>
        )}
      </div>
    </Scope>
  );
}
