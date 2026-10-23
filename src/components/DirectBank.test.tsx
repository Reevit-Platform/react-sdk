import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BankDetails } from '../api/direct';
import type { DirectBank } from '../hooks/useDirectBank';
import { BankDetailsPanel, BankFailurePanel, BankNotSeenPanel, copyText, formatAccountNumber, plainAmount } from './DirectBank';

const T0 = Date.parse('2026-10-23T12:00:00Z');

const DETAILS: BankDetails = { bank: 'Wema Bank', account_number: '7820194552', account_name: 'Reevit / Kente & Co.', amount: 75500 };

function bank(over: Partial<DirectBank> = {}): DirectBank {
  return {
    phase: 'details',
    attempt: { id: 'pay_1', status: 'requires_action', amount: 75500, currency: 'GHS', rerouted: false, poll_after_ms: 5000 },
    details: DETAILS,
    expiresAt: T0 + 17_000,
    startedAt: T0 - 13_000,
    failure: null,
    notice: null,
    retryAt: null,
    checks: 0,
    busy: false,
    start: vi.fn(async () => {}),
    sent: vi.fn(async () => {}),
    keepWaiting: vi.fn(),
    newDetails: vi.fn(async () => {}),
    reset: vi.fn(),
    ...over,
  };
}

const now = () => T0;

function renderDetails(b: DirectBank, details: BankDetails = DETAILS) {
  return render(<BankDetailsPanel bank={b} details={details} currency="GHS" amountText="GHS 755.00" now={now} />);
}

let written: string[];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (text: string) => void written.push(text)) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('formatting', () => {
  it('groups a ten digit account number and leaves anything else alone', () => {
    expect(formatAccountNumber('7820194552')).toBe('7820 194 552');
    expect(formatAccountNumber('0123456')).toBe('0123456');
  });

  it('plainAmount is the figure a banking app expects', () => {
    expect(plainAmount(75500, 'GHS')).toBe('755.00');
    expect(plainAmount(5000, 'XOF')).toBe('5000');
  });
});

describe('BankDetailsPanel', () => {
  it('shows the bank, account number, account name and amount with the expiry countdown', () => {
    renderDetails(bank());

    expect(screen.getByText('Bank transfer', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByText('Wema Bank')).toBeTruthy();
    expect(screen.getByText('7820 194 552')).toBeTruthy();
    expect(screen.getByText('Reevit / Kente & Co.')).toBeTruthy();
    expect(screen.getByText('GHS 755.00')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('0:17');
    expect(screen.getByRole('button', { name: 'I’ve sent it' })).toBeTruthy();
  });

  it('omits the account name row when the provider returns none (Ghana)', () => {
    renderDetails(bank(), { ...DETAILS, account_name: undefined });

    expect(screen.queryByText('Account name')).toBeNull();
    expect(screen.getByText('Account number')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
  });

  it('Copy writes the raw account number and the plain amount to the clipboard and says Copied', async () => {
    renderDetails(bank());

    const account = screen.getByRole('button', { name: 'Copy account number' });
    expect(account.textContent).toBe('Copy');
    await act(async () => {
      fireEvent.click(account);
    });
    expect(written).toEqual(['7820194552']);
    expect(account.textContent).toBe('Copied');
    expect(account.getAttribute('data-done')).toBe('1');
    expect(screen.getByText('account number copied')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy amount' }));
    });
    expect(written).toEqual(['7820194552', '755.00']);
  });

  it('Copied goes back to Copy after a moment', async () => {
    vi.useFakeTimers();
    renderDetails(bank());

    const account = screen.getByRole('button', { name: 'Copy account number' });
    await act(async () => {
      fireEvent.click(account);
    });
    expect(account.textContent).toBe('Copied');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(account.textContent).toBe('Copy');
  });

  it('falls back to a selectable hint when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    document.execCommand = vi.fn(() => false);
    renderDetails(bank());

    const account = screen.getByRole('button', { name: 'Copy account number' });
    await act(async () => {
      fireEvent.click(account);
    });
    expect(account.textContent).toMatch(/^Press (⌘C|Ctrl\+C)$/);
    expect(account.getAttribute('data-done')).toBeNull();
    expect(screen.getByText('Copy failed')).toBeTruthy();
  });

  it('"I’ve sent it" calls the hook; it does not decide anything itself', () => {
    const b = bank();
    renderDetails(b);
    fireEvent.click(screen.getByRole('button', { name: 'I’ve sent it' }));
    expect(b.sent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Payment received')).toBeNull();
  });

  it('once expired it says so and offers Get new details instead of the countdown', () => {
    const b = bank({ phase: 'expired', expiresAt: T0 - 1000 });
    renderDetails(b);

    expect(screen.getByText('These details have expired.')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'I’ve sent it' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Get new details' }));
    expect(b.newDetails).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s line when new details are refused while the old ones are still live', () => {
    renderDetails(bank({ phase: 'expired', notice: 'Your earlier payment is still active.' }));
    expect(screen.getByText('Your earlier payment is still active.')).toBeTruthy();
  });

  it('counts down while it is on screen', async () => {
    vi.useFakeTimers();
    let clock = T0;
    render(<BankDetailsPanel bank={bank()} details={DETAILS} currency="GHS" amountText="GHS 755.00" now={() => clock} />);
    expect(screen.getByRole('timer').textContent).toBe('0:17');

    clock += 5000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole('timer').textContent).toBe('0:12');
  });
});

describe('BankNotSeenPanel', () => {
  it('says it hasn’t seen the transfer and offers Check again and Keep waiting', () => {
    const b = bank({ phase: 'notSeen' });
    render(<BankNotSeenPanel bank={b} />);

    expect(screen.getByText('We haven’t seen it yet')).toBeTruthy();
    expect(screen.getByText('Transfers can take a few minutes to arrive.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(b.sent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(b.keepWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('BankFailurePanel', () => {
  it('retryable: Try again asks for new details; choosing another method is offered', () => {
    const b = bank({ phase: 'failed' });
    const onChooseAnother = vi.fn();
    render(
      <BankFailurePanel
        bank={b}
        failure={{ title: 'Couldn’t get account details', message: 'Try again, or use another method.', retryable: true, code: 'provider_error' }}
        canChooseAnother
        onChooseAnother={onChooseAnother}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(b.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Choose another method' }));
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
  });

  it('out of attempts: no retry, only a way out', () => {
    const onClose = vi.fn();
    render(
      <BankFailurePanel
        bank={bank({ phase: 'failed' })}
        failure={{ title: 'No more attempts', message: 'x', retryable: false, code: 'charge_limit_reached' }}
        canChooseAnother={false}
        onChooseAnother={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('copyText', () => {
  it('uses the async clipboard when it works', async () => {
    expect(await copyText('abc')).toBe(true);
    expect(written).toEqual(['abc']);
  });
});
