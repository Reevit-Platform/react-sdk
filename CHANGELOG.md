# Changelog

All notable changes to `@reevit/react` will be documented in this file.

## [0.1.0] - 2024-12-24

### Added
- Initial release
- **Components:**
  - `ReevitCheckout` - Complete checkout widget with modal UI
  - `PaymentMethodSelector` - Payment method selection component
  - `MobileMoneyForm` - Mobile money input with network detection
- **Hooks:**
  - `useReevit` - Core state management hook
  - `useReevitContext` - Context access hook
- **PSP Bridges:**
  - `PaystackBridge` - Paystack inline popup
  - `FlutterwaveBridge` - Flutterwave modal
  - `HubtelBridge` - Hubtel checkout
  - `StripeBridge` - Stripe Elements integration
  - `MonnifyBridge` - Monnify SDK modal
  - `MPesaBridge` - M-Pesa STK Push flow
  - `useMPesaStatusPolling` - M-Pesa status polling hook
- **API Client:**
  - `ReevitAPIClient` - Backend communication
  - `createReevitClient` - Client factory
- Theme customization support
- Dark mode support
- CSS styles (`@reevit/react/styles.css`)
