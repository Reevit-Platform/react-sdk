# @reevit/react

Unified Payment Widget for React Applications. Accept card and mobile money payments with a single integration.

## Installation

```bash
npm install @reevit/react@0.5.0
```

## Quick Start

The simplest way to integrate Reevit is using the `ReevitCheckout` component.

```tsx
import { ReevitCheckout } from '@reevit/react';
import '@reevit/react/styles.css';

function App() {
  return (
    <ReevitCheckout
      publicKey="pk_test_your_key"
      amount={10000} // Amount in smallest unit (e.g., pesewas for GHS)
      currency="GHS"
      email="customer@example.com"
      onSuccess={(result) => {
        console.log('Payment success!', result);
        alert(`Payment of ${result.currency} ${result.amount/100} successful!`);
      }}
      onError={(error) => {
        console.error('Payment failed:', error.message);
      }}
    >
      <button className="my-pay-button">Pay GHS 100.00</button>
    </ReevitCheckout>
  );
}
```

## Payment Links

If you have a hosted payment link, pass the link code. The widget will create the payment intent from the public link endpoint.

```tsx
<ReevitCheckout
  paymentLinkCode="plink_123"
  amount={25000}
  currency="GHS"
  email="customer@example.com"
  customerName="Ada Lovelace"
/>
```

## Controlled Modal

You can control the open state yourself.

```tsx
const [open, setOpen] = useState(false);

<ReevitCheckout
  publicKey="pk_test_your_key"
  amount={10000}
  currency="GHS"
  isOpen={open}
  onOpenChange={setOpen}
/>
```

## Success Screen Delay

By default, the checkout shows a success screen for 5 seconds before calling `onSuccess` and closing. Override with `successDelayMs` (set to `0` for immediate close).

```tsx
<ReevitCheckout successDelayMs={0} /* ... */ />
```

## Custom Theme

You can customize the look and feel of the checkout widget to match your brand.

```tsx
<ReevitCheckout
  theme={{
    primaryColor: '#0EA5E9',
    primaryForegroundColor: '#FFFFFF',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: '12px',
    companyName: 'Acme',
    logoUrl: 'https://example.com/logo.png',
    selectedBackgroundColor: '#E8F5F0',
    selectedTextColor: '#0B1120',
    selectedDescriptionColor: '#64748B',
    selectedBorderColor: '#E2E8F0',
  }}
  // ...other props
>
  <button>Secure Checkout</button>
</ReevitCheckout>
```

## Advanced Usage: useReevit Hook

For full control over the payment flow, use the `useReevit` hook. This allows you to build your own custom UI while Reevit handles the state management and API communication.

```tsx
import { useReevit } from '@reevit/react';

function CustomCheckout() {
  const {
    status,        // 'idle' | 'loading' | 'ready' | 'method_selected' | 'processing' | 'success' | 'failed'
    initialize,    // Start the process
    selectMethod,  // Pick 'card' or 'mobile_money'
    processPayment, // Confirm payment
    error,
    isLoading
  } = useReevit({
    config: {
      publicKey: 'pk_test_xxx',
      amount: 5000,
      currency: 'GHS',
    },
    onSuccess: (res) => console.log('Done!', res),
  });

  if (status === 'loading') return <Spinner />;

  return (
    <div>
      <button onClick={() => initialize()}>Start Checkout</button>
      {status === 'ready' && (
        <>
          <button onClick={() => selectMethod('card')}>Card</button>
          <button onClick={() => selectMethod('mobile_money')}>Mobile Money</button>
        </>
      )}
    </div>
  );
}
```

## Browser Support

- Chrome, Firefox, Safari, Edge (latest 2 versions)
- Mobile Safari and Chrome on Android/iOS

## Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `publicKey` | `string` | Your project's public key (required for API-created intents; optional when using `paymentLinkCode`) |
| `amount` | `number` | **Required**. Amount in the smallest unit (e.g., 500 for 5.00) |
| `currency` | `string` | **Required**. 3-letter ISO currency code (GHS, NGN, USD, etc.) |
| `email` | `string` | Customer's email address |
| `phone` | `string` | Customer's phone number (recommended for Mobile Money) |
| `customerName` | `string` | Customer name (used in payment links and some PSPs) |
| `reference` | `string` | Your own unique transaction reference |
| `metadata` | `object` | Key-value pairs to store with the transaction |
| `customFields` | `object` | Custom fields for payment links |
| `paymentLinkCode` | `string` | Hosted payment link code (uses the public link checkout flow) |
| `paymentMethods` | `PaymentMethod[]` | Enabled methods: `card`, `mobile_money`, `bank_transfer`, `apple_pay`, `google_pay` (PSP/country dependent) |
| `initialPaymentIntent` | `PaymentIntent` | Use an existing intent instead of creating a new one |
| `children` | `ReactNode` | Custom trigger element |
| `autoOpen` | `boolean` | Open automatically on mount |
| `isOpen` | `boolean` | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | Controlled open state handler |
| `theme` | `ReevitTheme` | Customization options for the widget |
| `apiBaseUrl` | `string` | Override API base URL (self-hosted/testing) |
| `successDelayMs` | `number` | Delay before calling `onSuccess` and closing (default `5000`) |
| `onSuccess` | `function` | Called when the payment is successfully processed |
| `onError` | `function` | Called when an error occurs |
| `onClose` | `function` | Called when the user dismisses the widget |
| `onStateChange` | `function` | Called when checkout state changes |

## Theme Reference

| Field | Description |
|-------|-------------|
| `primaryColor` | Primary text/brand color |
| `primaryForegroundColor` | Text color on primary brand surfaces |
| `backgroundColor` | Background color for the modal |
| `borderColor` | Border and divider color |
| `borderRadius` | Border radius for inputs and buttons |
| `darkMode` | Force dark mode when `true` |
| `logoUrl` | Logo URL shown in the header |
| `companyName` | Brand name shown in the header |
| `selectedBackgroundColor` | Background color for selected provider/methods |
| `selectedTextColor` | Primary text color for selected items |
| `selectedDescriptionColor` | Description/muted text color for selected items |
| `selectedBorderColor` | Border color for selected items |
| `pspSelectorBgColor` | PSP selector background color (where supported) |
| `pspSelectorTextColor` | PSP selector text color (where supported) |
| `pspSelectorBorderColor` | PSP selector border color (where supported) |
| `pspSelectorUseBorder` | Use border-only PSP selector styling |

## PSP Bridges

For advanced use cases, you can use individual PSP bridges directly. These provide React components for each payment processor.

### Stripe

```tsx
import { StripeBridge } from '@reevit/react';

<StripeBridge
  publishableKey="pk_test_xxx"
  clientSecret="pi_xxx_secret_xxx" // From your backend
  amount={5000}
  currency="USD"
  onSuccess={(result) => console.log('Paid:', result.paymentIntentId)}
  onError={(err) => console.error(err.message)}
/>
```

### Monnify (Nigeria)

```tsx
import { MonnifyBridge } from '@reevit/react';

<MonnifyBridge
  apiKey="MK_TEST_xxx"
  contractCode="1234567890"
  amount={5000}
  currency="NGN"
  reference="TXN_12345"
  customerName="John Doe"
  customerEmail="john@example.com"
  isTestMode={true}
  onSuccess={(result) => console.log('Paid:', result.transactionReference)}
  onError={(err) => console.error(err.message)}
/>
```

### M-Pesa (Kenya/Tanzania)

M-Pesa uses STK Push - the customer receives a prompt on their phone to authorize the payment.

```tsx
import { MPesaBridge, useMPesaStatusPolling } from '@reevit/react';

function MpesaPayment() {
  const [checkoutId, setCheckoutId] = useState(null);
  
  const { startPolling } = useMPesaStatusPolling(
    '/api/mpesa/status',
    checkoutId,
    {
      onSuccess: (result) => console.log('Paid:', result.transactionId),
      onFailed: (err) => console.error(err.message),
      onTimeout: () => console.log('Timed out'),
    }
  );

  return (
    <MPesaBridge
      apiEndpoint="/api/mpesa/stk-push"
      phoneNumber="254712345678"
      amount={500}
      currency="KES"
      reference="TXN_12345"
      onInitiated={(id) => {
        setCheckoutId(id);
        startPolling();
      }}
      onSuccess={(result) => console.log('Paid!')}
      onError={(err) => console.error(err.message)}
    />
  );
}
```

## Supported PSPs

| Paystack | NG, GH, ZA, KE | Card, Mobile Money, Bank Transfer |
| Flutterwave | NG, GH, KE, ZA + | Card, Mobile Money, Bank Transfer |
| Hubtel | GH | Mobile Money |
| Stripe | Global (50+) | Card, Apple Pay, Google Pay |
| Monnify | NG | Card, Bank Transfer, USSD |
| M-Pesa | KE, TZ | Mobile Money (STK Push) |

## License

MIT © [Reevit](https://reevit.io)
