import { describe, expect, it } from 'vitest';

import { currencyExponent, formatAmount, toMinorUnits } from './index';

describe('formatAmount (re-exported from @reevit/core)', () => {
  it('renders zero-decimal currencies without inventing decimals', () => {
    // The deleted react fork divided by 100 and showed "XOF 50.00" here.
    const formatted = formatAmount(5000, 'XOF');

    expect(formatted).toContain('5,000');
    expect(formatted).not.toContain('50.00');
    expect(formatted).not.toContain('.');
  });

  it('renders JPY without decimals', () => {
    expect(formatAmount(123456, 'JPY')).toContain('123,456');
  });

  it('still renders two-decimal currencies from minor units', () => {
    expect(formatAmount(4500, 'GHS')).toMatch(/45\.00/);
    expect(formatAmount(4500, 'NGN')).toMatch(/45\.00/);
    expect(formatAmount(4500, 'USD')).toMatch(/45\.00/);
  });

  it('exposes the exponent helpers the fix depends on (requires core >= 0.9.1)', () => {
    expect(currencyExponent('XOF')).toBe(0);
    expect(currencyExponent('GHS')).toBe(2);
    expect(toMinorUnits(45, 'GHS')).toBe(4500);
    expect(toMinorUnits(5000, 'XOF')).toBe(5000);
  });
});
