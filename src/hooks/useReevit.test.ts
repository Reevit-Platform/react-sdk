import { describe, expect, it } from 'vitest';

import { checkoutSelectionIdentity } from './useReevit';

describe('checkoutSelectionIdentity', () => {
  it('replays: the same session/method/provider triple always yields the same key', () => {
    const first = checkoutSelectionIdentity('cs_secret_abc', 'mobile_money', 'paystack');
    const second = checkoutSelectionIdentity('cs_secret_abc', 'mobile_money', 'paystack');

    expect(first).toBe(second);
    expect(first).toMatch(/^reevit_checkout_selection_[0-9a-f]{32}$/);
  });

  it('separates two shoppers: different session secrets never share a key', () => {
    expect(checkoutSelectionIdentity('cs_secret_shopper_a', 'card', 'paystack'))
      .not.toBe(checkoutSelectionIdentity('cs_secret_shopper_b', 'card', 'paystack'));
  });

  it('separates method and provider on the same session', () => {
    const card = checkoutSelectionIdentity('cs_secret_abc', 'card', 'paystack');
    const momo = checkoutSelectionIdentity('cs_secret_abc', 'mobile_money', 'paystack');
    const other = checkoutSelectionIdentity('cs_secret_abc', 'card', 'flutterwave');

    expect(new Set([card, momo, other]).size).toBe(3);
  });

  it('uses a wide enough digest that 200k selections do not collide', () => {
    // Width, not luck: the key is 128 bits (asserted by the regex above). Run
    // against the djb2 predecessor's 32 bits, this exact input family produces
    // two colliding keys — two shoppers replaying each other's selection inside
    // the backend's 24h idempotency window.
    const keys = new Set<string>();
    for (let i = 0; i < 200_000; i++) {
      const secret = `cs_${((i * 2654435761) >>> 0).toString(36)}_${i.toString(36)}`;
      keys.add(checkoutSelectionIdentity(secret, 'mobile_money', 'paystack'));
    }

    expect(keys.size).toBe(200_000);
  });
});
