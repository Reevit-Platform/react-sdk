import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DirectCharge, DirectFailure } from '../hooks/useDirectCharge';
import { MomoFailurePanel, formatPayerPhone } from './DirectMomo';

afterEach(cleanup);

function charge(over: Partial<DirectCharge> = {}): DirectCharge {
  return {
    phase: 'failed',
    attempt: null,
    input: { phone: '0244128890', network: 'mtn' },
    expiresAt: null,
    startedAt: null,
    canResendAt: null,
    failure: null,
    notice: null,
    formNotice: null,
    checking: false,
    resending: false,
    resendClosed: false,
    codeError: null,
    codeKind: null,
    start: vi.fn(),
    check: vi.fn(),
    resend: vi.fn(),
    submitCode: vi.fn(),
    useAnotherNumber: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    ...over,
  } as DirectCharge;
}

const failure = (over: Partial<DirectFailure>): DirectFailure => ({
  kind: 'declined',
  title: 'Payment declined',
  message: 'The request wasn’t approved on your phone.',
  retryable: true,
  code: 'declined',
  ...over,
});

describe('formatPayerPhone', () => {
  it('formats Ghana and Kenya numbers the way the form shows them', () => {
    expect(formatPayerPhone('0244128890')).toBe('024 412 8890');
    expect(formatPayerPhone('233244128890')).toBe('024 412 8890');
    expect(formatPayerPhone('254712345678')).toBe('+254 712 345 678');
  });
});

describe('MomoFailurePanel', () => {
  it('declined: Try again retries, Use another number goes back to the form', () => {
    const c = charge();
    render(<MomoFailurePanel charge={c} failure={failure({})} canChooseAnother onChooseAnother={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(c.retry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use another number' }));
    expect(c.useAnotherNumber).toHaveBeenCalled();
  });

  it('timeout: the primary action sends a new prompt', () => {
    const c = charge();
    render(<MomoFailurePanel charge={c} failure={failure({ kind: 'timeout', title: 'No response in time', message: 'The approval prompt expired.' })} canChooseAnother={false} onChooseAnother={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new prompt' }));
    expect(c.resend).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Choose another method' })).toBeNull();
  });

  it('timeout with the resend budget spent falls back to Try again', () => {
    render(<MomoFailurePanel charge={charge({ resendClosed: true })} failure={failure({ kind: 'timeout' })} canChooseAnother={false} onChooseAnother={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('out of attempts: no retry, only a way out', () => {
    const onChooseAnother = vi.fn();
    const { rerender } = render(<MomoFailurePanel charge={charge()} failure={failure({ kind: 'exhausted', retryable: false, title: 'No more attempts' })} canChooseAnother onChooseAnother={onChooseAnother} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use another number' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another method' }));
    expect(onChooseAnother).toHaveBeenCalled();

    const onClose = vi.fn();
    rerender(<MomoFailurePanel charge={charge()} failure={failure({ kind: 'exhausted', retryable: false })} canChooseAnother={false} onChooseAnother={onChooseAnother} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server line from a refused retry', () => {
    render(<MomoFailurePanel charge={charge({ notice: 'Your earlier payment prompt is still active.' })} failure={failure({})} canChooseAnother={false} onChooseAnother={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Your earlier payment prompt is still active.');
  });
});
