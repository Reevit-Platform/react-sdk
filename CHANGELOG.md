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
