import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { FlutterwaveBridge, flutterwaveTxRef } = process.env.REEVIT_PACKED_ENTRY
  ? await import(/* @vite-ignore */ process.env.REEVIT_PACKED_ENTRY)
  : await import('./FlutterwaveBridge');

afterEach(() => {
  cleanup();
  delete window.FlutterwaveCheckout;
});

describe('FlutterwaveBridge currency units', () => {
  it.each([
    ['GHS', 5012, 50.12],
    ['NGN', 5012, 50.12],
    ['XOF', 5000, 5000],
    ['XAF', 5000, 5000],
  ])('sends %s in major units and returns minor units', async (currency, minor, major) => {
    const checkout = vi.fn();
    window.FlutterwaveCheckout = checkout;
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <FlutterwaveBridge
        publicKey="FLWPUBK_TEST"
        amount={minor}
        currency={currency}
        reference="order_1"
        email="shopper@example.com"
        onSuccess={onSuccess}
        onError={onError}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    const config = checkout.mock.calls[0][0];
    expect(config.amount).toBe(major);
    expect(config.currency).toBe(currency);
    config.callback({
      status: 'successful', transaction_id: 123, tx_ref: 'order_1', flw_ref: 'flw_1',
      amount: major, currency, charged_amount: major, payment_type: 'card',
    });

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ amount: minor, currency }));
    expect(onError).not.toHaveBeenCalled();
  });

  it('uses the response currency when normalizing a gateway result', async () => {
    const checkout = vi.fn();
    window.FlutterwaveCheckout = checkout;
    const onSuccess = vi.fn();
    render(<FlutterwaveBridge publicKey="test" amount={5000} currency="GHS" email="a@example.com"
      onSuccess={onSuccess} onError={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    checkout.mock.calls[0][0].callback({
      status: 'successful', transaction_id: 123, tx_ref: 'order_1', flw_ref: 'flw_1',
      amount: 5000, currency: 'XOF', charged_amount: 5000, payment_type: 'card',
    });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, currency: 'XOF' }));
  });
});

describe('FlutterwaveBridge return address', () => {
  const open = async (redirectUrl?: string) => {
    const checkout = vi.fn();
    window.FlutterwaveCheckout = checkout;
    render(<FlutterwaveBridge publicKey="test" amount={5000} currency="GHS" email="a@example.com"
      redirectUrl={redirectUrl} onSuccess={vi.fn()} onError={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    return checkout.mock.calls[0][0];
  };

  // Flutterwave uses a redirect in place of the callback, so it must be asked for.
  it('sends no redirect_url unless one is given', async () => {
    const config = await open();
    expect('redirect_url' in config).toBe(false);
    expect(typeof config.callback).toBe('function');
  });

  it('sends the return address it was given', async () => {
    const config = await open('https://shop.example/checkout/return');
    expect(config.redirect_url).toBe('https://shop.example/checkout/return');
  });
});

// Reevit checks and binds a Flutterwave payment by the reference it created it
// under (`pf_…`). The window used to pay under the merchant's order reference,
// so the two never met and a paid payment stayed "needs action".
describe('Flutterwave tx_ref', () => {
  it("pays under Reevit's stored Flutterwave reference", () => {
    expect(flutterwaveTxRef({ id: 'pay_1', reference: 'ORD-1', providerRefId: 'pf_abc' })).toBe('pf_abc');
  });

  it('ignores a stored reference that is not a tx_ref', () => {
    // After a confirmation the stored reference can be Flutterwave's numeric transaction id.
    expect(flutterwaveTxRef({ id: 'pay_1', reference: 'ORD-1', providerRefId: '4521987' })).toBe('ORD-1');
  });

  it('falls back when the backend sent no reference', () => {
    expect(flutterwaveTxRef({ id: 'pay_1' })).toBe('pay_1');
    expect(flutterwaveTxRef({ id: 'pay_1' }, 'ORD-2')).toBe('ORD-2');
    expect(flutterwaveTxRef(null)).toMatch(/^flw_/);
  });

  it("hands the merchant's own reference back, not Reevit's", async () => {
    const checkout = vi.fn();
    window.FlutterwaveCheckout = checkout;
    const onSuccess = vi.fn();

    render(
      <FlutterwaveBridge
        publicKey="FLWPUBK_TEST"
        amount={5000}
        currency="GHS"
        reference="pf_abc"
        orderReference="ORD-1"
        email="shopper@example.com"
        onSuccess={onSuccess}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    const config = checkout.mock.calls[0][0];
    expect(config.tx_ref).toBe('pf_abc');
    config.callback({
      status: 'successful', transaction_id: 123, tx_ref: 'pf_abc', flw_ref: 'flw_1',
      amount: 50, currency: 'GHS', charged_amount: 50, payment_type: 'card',
    });

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ reference: 'ORD-1' }));
  });
});
