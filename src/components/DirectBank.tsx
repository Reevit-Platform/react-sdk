/**
 * Direct bank transfer panels (Ledger): the account to pay into with Copy buttons
 * and an expiry countdown, the "confirming" beat, "We haven't seen it yet", and
 * the expired state with "Get new details". They render the state of
 * `useDirectBank`; they decide nothing themselves.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BankDetails } from '../api/direct';
import type { BankFailure, DirectBank } from '../hooks/useDirectBank';
import { currencyExponent } from '../utils';
import { CopyIcon } from './icons';
import { LoadingState } from './LoadingState';
import { PanelHead } from './PanelHead';
import { Scope } from './Scope';
import { useCountdown } from './DirectMomo';

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** 7820194552 -> "7820 194 552". Account numbers of any other length are shown as given. */
export function formatAccountNumber(value: string): string {
  const digits = value.replace(/\s/g, '');
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : value;
}

/** 75500 + GHS -> "755.00": the figure a banking app expects pasted into its amount field. */
export function plainAmount(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

/** Copy to the clipboard, falling back to a hidden textarea where the async API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

const COPIED_MS = 2000;
const pasteHint = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Press ⌘C' : 'Press Ctrl+C');

function CopyButton({ label, value, onCopied }: { label: string; value: string; onCopied: (message: string) => void }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = useCallback(async () => {
    const ok = await copyText(value);
    setState(ok ? 'done' : 'failed');
    onCopied(ok ? `${label.toLowerCase()} copied` : 'Copy failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPIED_MS);
  }, [label, onCopied, value]);

  return (
    <button
      type="button"
      className="reevit-copy"
      data-reevit="copy"
      data-copy={label.toLowerCase()}
      data-done={state === 'done' ? '1' : undefined}
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={() => void copy()}
    >
      <CopyIcon />
      <span>{state === 'done' ? 'Copied' : state === 'failed' ? pasteHint() : 'Copy'}</span>
    </button>
  );
}

interface DetailsProps {
  bank: DirectBank;
  details: BankDetails;
  currency: string;
  amountText: string;
  onBack?: () => void;
  now?: () => number;
}

/** The account to pay into, then "I've sent it"; once the clock runs out, "Get new details". */
export function BankDetailsPanel({ bank, details, currency, amountText, onBack, now }: DetailsProps) {
  const { seconds } = useCountdown(bank.expiresAt, bank.startedAt, now);
  const [announcement, setAnnouncement] = useState('');
  const expired = bank.phase === 'expired';
  const rows: Array<{ label: string; text: string; raw?: string; mono?: boolean }> = [
    { label: 'Bank', text: details.bank },
    { label: 'Account number', text: formatAccountNumber(details.account_number), raw: details.account_number.replace(/\s/g, ''), mono: true },
    // Some providers (Flutterwave in Ghana) return no account name: the row is simply absent.
    ...(details.account_name ? [{ label: 'Account name', text: details.account_name }] : []),
    { label: 'Amount', text: amountText, raw: plainAmount(details.amount, currency), mono: true },
  ];

  return (
    <Scope>
      <PanelHead title="Bank transfer" onBack={onBack} />
      <div data-reevit="bank" data-state={expired ? 'expired' : 'live'} data-payment-id={bank.attempt?.id}>
        <ul className="reevit-bank" data-reevit="bank-details">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="reevit-bank-cell">
                <small>{row.label}</small>
                <span className={row.mono ? 'reevit-bank-value reevit-mono' : 'reevit-bank-value'}>{row.text}</span>
              </div>
              {row.raw !== undefined && <CopyButton label={row.label} value={row.raw} onCopied={setAnnouncement} />}
            </li>
          ))}
        </ul>
        {expired ? (
          <>
            <p className="reevit-expiry">
              <span data-reevit="status" role="status" aria-live="polite">{bank.notice ?? 'These details have expired.'}</span>
            </p>
            <button type="button" className="reevit-cta" data-reevit="cta" data-first="" disabled={bank.busy} onClick={() => void bank.newDetails()}>
              Get new details
            </button>
          </>
        ) : (
          <>
            <p className="reevit-expiry">
              <span>Expires in</span>
              <span className="reevit-mono" data-reevit="countdown" role="timer" aria-label="Time left">{mmss(seconds)}</span>
            </p>
            {bank.notice && <p className="reevit-status" data-reevit="status" role="status" aria-live="polite">{bank.notice}</p>}
            <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={() => void bank.sent()}>
              I’ve sent it
            </button>
          </>
        )}
        <span className="reevit-sr" role="status" aria-live="polite">{announcement}</span>
      </div>
    </Scope>
  );
}

/** The beat between "I've sent it" and the answer. */
export function BankConfirmingPanel() {
  return <LoadingState title="Confirming your transfer" message="This usually takes a moment." />;
}

/** The provider has not seen the transfer yet. */
export function BankNotSeenPanel({ bank }: { bank: DirectBank }) {
  return (
    <Scope>
      <div data-reevit="bank-not-seen">
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
          <span className="reevit-fail-dot" aria-hidden="true" />
          We haven’t seen it yet
        </h2>
        <p className="reevit-text">Transfers can take a few minutes to arrive.</p>
        {bank.notice && <p className="reevit-status" data-reevit="status" role="status" aria-live="polite">{bank.notice}</p>}
        <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={() => void bank.sent()}>
          Check again
        </button>
        <button type="button" className="reevit-cta-secondary" data-reevit="keep-waiting" onClick={bank.keepWaiting}>
          Keep waiting
        </button>
      </div>
    </Scope>
  );
}

interface FailureProps {
  bank: DirectBank;
  failure: BankFailure;
  canChooseAnother: boolean;
  onChooseAnother: () => void;
  onClose: () => void;
}

/** Account details could not be issued. */
export function BankFailurePanel({ bank, failure, canChooseAnother, onChooseAnother, onClose }: FailureProps) {
  return (
    <Scope>
      <div className="reevit-result reevit-result--prompt" data-reevit="failure" data-failure={failure.code}>
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
          <span className="reevit-fail-dot" aria-hidden="true" />
          {failure.title}
        </h2>
        <p className="reevit-text">{failure.message}</p>
        {failure.retryable ? (
          <button type="button" className="reevit-cta" data-reevit="cta" data-first="" disabled={bank.busy} onClick={() => void bank.start()}>
            Try again
          </button>
        ) : (
          !canChooseAnother && (
            <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={onClose}>Close</button>
          )
        )}
        {canChooseAnother && (
          <div className="reevit-links">
            <button type="button" className="reevit-link" data-reevit="choose-another" data-first={failure.retryable ? undefined : ''} onClick={onChooseAnother}>
              Choose another method
            </button>
          </div>
        )}
      </div>
    </Scope>
  );
}
