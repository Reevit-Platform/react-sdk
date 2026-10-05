import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { FlutterwaveBridge } = process.env.REEVIT_PACKED_ENTRY
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
