# @reevit/react — 0.11.1 (Unreleased)

## Fixed

- Flutterwave checkout converts Reevit minor units using the currency exponent. A 5,012 GHS intent requests 50.12 GHS; a 5,000 XOF intent requests 5,000 XOF.
- Callback amounts return to minor units using the response currency.

# @reevit/react — 0.11.0 (2026-09-24)

## 🔒 Security

- **Hubtel checkout no longer uses the merchant's Hubtel credentials.** The
  Hubtel bridge used to fetch `basicAuth` (base64 `client_id:client_secret`)
  from `POST /v1/payments/hubtel/sessions/{id}` and pass it to Hubtel's
  in-browser checkout, which put the merchant's Hubtel API login in the
  shopper's browser. The bridge now opens the hosted checkout the Reevit API
  already created (`checkoutDirectUrl` embedded in a plain overlay, or
  `checkoutUrl`) and learns the result by polling
  `POST /v1/payments/{id}/confirm-intent`. It never reads a result from the
  Hubtel page. A message from a `*.hubtel.com` page only triggers an immediate
  status check.
- The `@hubteljs/checkout` dependency is removed.

## ⚠️ Deprecated

- `basicAuth` on `HubtelBridge` and `openHubtelPopup`, and
  `PaymentIntent.pspCredentials.basicAuth`, are ignored. They stay in the types
  so existing code still compiles, and outside production builds the SDK logs a
  single console warning when one is passed. If you ever passed `basicAuth`
  yourself, rotate those Hubtel API keys.
- `HubtelBridge` props `merchantAccount`, `email`, `phone`, `description`,
  `callbackUrl` and `hubtelSessionToken` are ignored; Hubtel's hosted checkout
  collects what it needs.
- `openHubtelPopup` now takes `paymentId` + `clientSecret` (full outcome
  tracking) or a `checkoutUrl` (display only). Its old purchase fields are
  ignored.
- `HubtelSessionResponse` now describes the new response (`checkoutUrl`,
  `checkoutDirectUrl`, `checkoutId`, `status`, `paymentId`, optional expiry).
  `token`, `merchantAccount` and `basicAuth` are optional and deprecated.

## ⚠️ Compatibility

- Works with backends before and after the server change: an older backend
  still returns `basicAuth` and no checkout URL. The SDK ignores `basicAuth` and
  opens the payment's client secret instead, which on Hubtel payments is the
  hosted checkout URL.
- **Breaking for published versions up to 0.10.4 once the backend change
  deploys.** The session endpoint stops returning `basicAuth`, so those versions
  show "Failed to create Hubtel session" and cannot take Hubtel payments. Other
  providers are unaffected. Merchants using Hubtel must upgrade.

---

# @reevit/react v0.10.5

**Release Date:** September 2, 2026

## 🐛 Bug Fixes

- **Stop logging the shopper to the browser console.** The Paystack bridge
  printed the shopper's email, amount and reference on every payment start, and
  the full Paystack callback on completion; the Hubtel bridge printed its
  lifecycle. All five `console.log` calls are gone from the shipped bundle.
- **Zero-decimal currencies render honestly.** `formatAmount` no longer divides
  every amount by 100 — a 5,000 XOF charge showed as `XOF 50.00`. The local fork
  is deleted; formatting now comes from `@reevit/core`, which consults the
  currency's exponent.
- **Widen the checkout-selection idempotency key.** The key sent on
  `POST /v1/checkout/sessions/{secret}/select` was a 32-bit djb2 hash of
  `(sessionSecret, method, provider)`, so distinct selections collided at roughly
  50% odds around 77k of them inside the backend's 24h idempotency window — one
  shopper's method selection could replay another's. It is now a 128-bit digest.
  The key stays deterministic on purpose: re-selecting the same method on the
  same session must replay, not create a second selection.

## 📦 Dependencies

- Requires `@reevit/core` **`^0.9.1`** (was `^0.9.0`). 0.9.0 has the un-fixed
  `formatAmount` and does not export `currencyExponent`/`toMinorUnits`, so the
  bump is required, not merely permitted.
- **Release order:** `@reevit/core` 0.9.1 must be published to npm before
  `@reevit/react` 0.10.5 can install, build in CI, or be published.

## ✅ Tests

- 9 new tests: `formatAmount` for XOF/JPY/GHS/NGN/USD and the exponent helpers,
  the selection key's determinism, separation and 128-bit width, and a console
  spy asserting no shopper data reaches `console.log` during a payment start.

---

# @reevit/react v0.10.4

**Release Date:** August 14, 2026

## 🐛 Bug Fixes

- Finalize server-created checkout sessions with the shopper's selected payment
  method and provider before mounting a PSP bridge.
- Resume Paystack with the method-specific access code returned by Reevit,
  keeping the popup, verification, and webhooks attached to the same intent.
- Deduplicate repeated Continue clicks by checkout session, method, and provider,
  and preserve the selected method while the refreshed intent loads.
- Reject unsupported provider/method combinations instead of silently rerouting.

---

# @reevit/react v0.10.3

**Release Date:** August 14, 2026

## 🐛 Bug Fixes

- Recreate the checkout intent with the shopper's selected payment method
  before opening the PSP, so Paystack Mobile Money no longer resumes the
  card-only transaction created while loading provider options.
- Preserve the selected method across intent refreshes and enforce an explicit
  provider selection when creating the final intent.
- Forward merchant-provided idempotency keys through `ReevitCheckout` and
  scope them by the final method/provider selection.

---

# @reevit/react v0.10.1

**Release Date:** July 7, 2026

## 🐛 Bug Fixes

- **Paystack card/mobile-money payments never confirmed.** The Paystack bridge
  loaded Inline v2 but drove it through the v1-compat `PaystackPop.setup()`
  API with a snake_case `access_code`. Inline v2 only recognises camelCase
  `accessCode` and silently drops unknown keys, so the popup created a **new,
  unrelated Paystack transaction** (under the caller's `reference`) instead of
  resuming the transaction the Reevit backend initialized. The customer's
  charge succeeded at Paystack, but Reevit kept verifying its own untouched
  reference — the payment stayed `pending`/`requires_action` forever. The
  bridge now uses the v2 instance API: `resumeTransaction(accessCode,
  callbacks)` when the intent carries an access code (the normal Reevit flow),
  and `newTransaction({...})` with camelCase keys otherwise. Popup errors are
  now surfaced through `onError` instead of being ignored.

---

# @reevit/react (Unreleased)

**Release Date:** February 4, 2026

## 🛠 Improvements

- Added `idempotencyKey` support to checkout config and API client calls.
- Deduped in-flight payment intent creation to prevent duplicates (StrictMode-safe).

---

# @reevit/react v0.5.0

**Release Date:** January 11, 2026

## 🚀 New Features

### Apple Pay & Google Pay Support
- Added `apple_pay` and `google_pay` as supported payment methods.
- Included localized logos for Apple Pay and Google Pay.

### Local Asset Bundling
- Switched from CDN-hosted logos to local bundled assets for better performance and privacy.
- Added `resolveAssetSrc` utility for handling both local and remote assets.

### Success Screen Customization
- Added `successDelayMs` prop to `ReevitCheckout` to control how long the success screen is displayed before closing (default: 5000ms).

## 📦 Install / Upgrade

```bash
npm install @reevit/react@0.5.0
```

---

# @reevit/react v0.3.2

**Release Date:** December 29, 2025

## 🐛 Bug Fixes

### Fixed: Payment Method Selector Bypass

Resolved an issue where the `ReevitCheckout` component would bypass the payment method selection screen and auto-select 'card' when an `initialPaymentIntent` was provided. This fix ensures:
- The `ReevitCheckout` popup now correctly displays the payment method selector (e.g., Card, Mobile Money) when multiple options are available.
- The auto-advance logic is less aggressive, allowing users to make their selection within the popup.
- `useReevit` no longer auto-selects a method if more than one is available in the `initialPaymentIntent`.

## 📦 Install / Upgrade

```bash
npm install @reevit/react@0.3.2
# or
yarn add @reevit/react@0.3.2
# or
pnpm add @reevit/react@0.3.2
```

## ⚠️ Breaking Changes

None. This is a backwards-compatible release.

## Full Changelog

- `b5eca56` - fix: Restore payment method selector in ReevitCheckout
- `38ae223` - chore: Bump version to 0.3.2

# @reevit/react v0.3.0

**Release Date:** December 28, 2024

## 🚀 New Features

### Controlled Mode Support

The `ReevitCheckout` component now supports controlled mode for advanced use cases like Payment Links:

```tsx
// Controlled mode - parent manages open state
<ReevitCheckout
  isOpen={isCheckoutOpen}
  onOpenChange={setIsCheckoutOpen}
  initialPaymentIntent={paymentIntent}
  // ... other props
/>
```

**New props:**

| Prop | Type | Description |
|------|------|-------------|
| `isOpen` | `boolean` | Externally control the modal open state |
| `onOpenChange` | `(open: boolean) => void` | Callback when open state should change |
| `initialPaymentIntent` | `PaymentIntent` | Pass a pre-created payment intent (skips internal initialization) |

### Phone Number Support

Added phone number field throughout the payment flow:

- `phone` prop on `ReevitCheckout`
- Phone passed to `PaystackBridge` for mobile money payments
- Phone included in metadata for provider tracking

### Smart Auto-Advance

When using controlled mode with an initial payment intent:

- Automatically advances to PSP bridge when conditions are met
- Auto-selects payment method when only one is available

## 🐛 Bug Fixes

### Fixed: Duplicate Payment Creation in React StrictMode

Added `initializingRef` guard to prevent `initialize()` from being called twice when React StrictMode double-invokes effects. This was causing duplicate payments to be created.

### Fixed: Webhook Metadata Routing

`PaystackBridge` now correctly injects `payment_id` from the payment intent into metadata, ensuring webhooks can properly correlate payments back to the correct payment record.

## 📦 Install / Upgrade

```bash
npm install @reevit/react@0.3.0
# or
yarn add @reevit/react@0.3.0
# or
pnpm add @reevit/react@0.3.0
```

## ⚠️ Breaking Changes

None. This is a backwards-compatible release.

## Full Changelog

- `b0bdff2` - feat: support initialPaymentIntent for controlled mode
- `acaf3bb` - feat: add controlled open state and phone support
- `48d4346` - feat: add phone prop to PaystackBridge
- `8f6ba85` - feat: add phone to API client payment intent request
- `7f2e345` - fix: prevent duplicate payment creation in React StrictMode
- `fe9a9d5` - fix: inject payment intent ID into Paystack metadata for webhook routing
