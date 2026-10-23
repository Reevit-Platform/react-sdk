/**
 * Parity harness: renders the real <ReevitCheckout> in one fixed state per URL, with
 * mock intents and NO network calls (providers, Stripe.js and fetch are stubbed here only).
 *
 *   /parity.html?state=list&theme=light&provider=paystack
 *
 * state:    list | opening | stripe | mpesa-phone | mpesa-waiting | mpesa-failed |
 *           loading | processing | failure | receipt | confirm
 * theme:    light | dark
 * pointer:  1 = start closed and open from a real click on the merchant's Pay button
 *           (what screenshots use, so focus rings behave as for a mouse user)
 * provider: paystack | hubtel | flutterwave | monnify | stripe | mpesa
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReevitCheckout } from '../src/components/ReevitCheckout';
import type { PaymentIntent, PaymentMethod } from '../src/types';
import '../src/styles.css';
import logoBlack from './img/logo-short-black.png';
import logoWhite from './img/logo-short-white.png';

const params = new URLSearchParams(location.search);
const state = params.get('state') || 'list';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const provider = (params.get('provider') || (state.startsWith('mpesa') ? 'mpesa' : state === 'stripe' ? 'stripe' : 'paystack')) as keyof typeof PROVIDERS;

// Mirrors the backend's default provider -> method map.
const PROVIDERS = {
  paystack: { name: 'Paystack', methods: ['card', 'mobile_money', 'bank_transfer'], currency: 'GHS' },
  hubtel: { name: 'Hubtel', methods: ['card', 'mobile_money'], currency: 'GHS' },
  flutterwave: { name: 'Flutterwave', methods: ['card', 'mobile_money', 'bank_transfer'], currency: 'GHS' },
  monnify: { name: 'Monnify', methods: ['card', 'bank_transfer'], currency: 'NGN' },
  mpesa: { name: 'M-Pesa', methods: ['mobile_money'], currency: 'KES' },
  stripe: { name: 'Stripe', methods: ['card'], currency: 'USD' },
} as const;

const cfg = PROVIDERS[provider];
const currency = params.get('currency') || (provider === 'monnify' ? 'NGN' : cfg.currency === 'USD' ? 'GHS' : cfg.currency);
const amount = 75500; // GHS 755.00 in minor units

const intent: PaymentIntent = {
  id: 'pay_preview_1',
  clientSecret: 'cs_preview_1',
  pspPublicKey: 'pk_preview',
  amount,
  currency,
  status: 'pending',
  recommendedPsp: provider,
  availableMethods: ['card', 'mobile_money', 'bank_transfer'],
  availableProviders: [{ provider, name: cfg.name, methods: [...cfg.methods] as PaymentMethod[] }],
};

// ---- stubs (preview only) ----------------------------------------------------------------------

const never = new Promise<Response>(() => {});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/confirm-intent')) {
    if (state === 'processing') return never;
    if (state === 'failure') return json({ message: 'Your card was declined. Try another card.' }, 402);
    return json({ id: 'pay_preview_1', status: 'succeeded', provider_ref_id: 'pay_wrvrzjvp' });
  }
  if (url.endsWith('/mpesa')) {
    if (state === 'mpesa-failed') return json({ message: 'The request could not be sent. Try again.' }, 500);
    return json({ checkout_request_id: 'ws_CO_2310202611570001' });
  }
  if (state === 'loading') return never;
  void init;
  return json({});
}) as typeof fetch;

const pending = state === 'opening' || state === 'confirm';
window.PaystackPop = class {
  newTransaction() {}
  resumeTransaction(_code: string, cb: { onSuccess?: (r: unknown) => void }) {
    if (pending) return; // provider window stays open
    queueMicrotask(() => cb.onSuccess?.({ reference: 'pay_wrvrzjvp', trans: '1', status: 'success', message: 'ok', transaction: 'txn_1', trxref: 'pay_wrvrzjvp' }));
  }
} as unknown as typeof window.PaystackPop;

// Stripe: a stand-in for the Payment Element that follows the appearance object the SDK passes in.
const stripeScript = document.createElement('script');
stripeScript.id = 'stripe-js-script';
document.head.append(stripeScript);
type Appearance = { variables?: Record<string, string>; rules?: Record<string, Record<string, string>> };
(window as any).Stripe = () => ({
  elements: ({ appearance }: { appearance?: Appearance }) => ({
    create: () => {
      let host: HTMLElement | null = null;
      const v = appearance?.variables ?? {};
      const input = appearance?.rules?.['.Input'] ?? {};
      const label = appearance?.rules?.['.Label'] ?? {};
      const field = (name: string, placeholder: string) =>
        `<div style="margin-bottom:${v.spacingGridRow}"><div style="font-size:${label.fontSize};font-weight:${label.fontWeight};margin-bottom:${label.marginBottom};color:${label.color}">${name}</div>` +
        `<div style="height:${input.height};padding:0 14px;display:flex;align-items:center;border:${input.border};border-radius:${v.borderRadius};background:${input.backgroundColor};font-size:${input.fontSize};color:${v.colorTextPlaceholder}">${placeholder}</div></div>`;
      return {
        mount(el: HTMLElement) {
          host = el;
          el.style.fontFamily = v.fontFamily ?? '';
          el.innerHTML = field('Card number', '1234 1234 1234 1234') +
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:${v.spacingGridColumn}">${field('Expiration date', 'MM / YY')}${field('Security code', 'CVC')}</div>`;
        },
        unmount() {},
        destroy() { if (host) host.innerHTML = ''; },
        on(event: string, handler: () => void) { if (event === 'ready') setTimeout(handler, 0); },
      };
    },
    submit: async () => ({}),
    getElement: () => null,
  }),
  confirmPayment: async () => ({ paymentIntent: { id: 'pi_preview', status: 'succeeded' } }),
});

// ---- drive the widget into the requested state -------------------------------------------------

function useDrive(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
    const click = (sel: string) => $(sel)?.click();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await wait(60);
      if (['opening', 'stripe', 'processing', 'failure', 'receipt', 'confirm'].includes(state)) {
        click('[data-reevit="row"][data-method="card"]');
      }
      if (state === 'confirm') {
        await wait(150);
        click('[data-reevit="close"]');
      }
      if (state === 'mpesa-waiting' || state === 'mpesa-failed') {
        await wait(60);
        click('[data-reevit="momo-form"] [data-reevit="cta"]');
      }
      document.documentElement.dataset.ready = state;
    })();
  }, [open]);
}

function Merchant({ onPay }: { onPay?: () => void }) {
  return (
    <div className="mx">
      <div className="mx-nav"><img src={logoBlack} alt="" /><b>Kente &amp; Co.</b><span>Cart · 3</span></div>
      <main className="mx-main">
        <div className="mx-ph" role="img" aria-label="Product photo" />
        <div>
          <h1>Your basket</h1>
          <p className="mx-p">{currency} 755.00</p>
          <div className="mx-li"><span>Adinkra throw, hand-loomed</span><i>{currency} 480.00</i></div>
          <div className="mx-li"><span>Kente table runner × 2</span><i>{currency} 250.00</i></div>
          <div className="mx-li"><span>Delivery</span><i>{currency} 25.00</i></div>
          {onPay && <button className="mx-pay" type="button" onClick={onPay}>Pay {currency} 755.00</button>}
        </div>
      </main>
    </div>
  );
}

function App() {
  const needsClick = params.get('pointer') === '1';
  const [open, setOpen] = useState(!needsClick);
  useDrive(open);
  return (
    <div className="stage">
      <div className="frame" id="frame">
        <Merchant onPay={open ? undefined : () => setOpen(true)} />
        <ReevitCheckout
          isOpen={open}
          onOpenChange={setOpen}
          publicKey="pfk_test_preview"
          amount={amount}
          currency={currency}
          reference="ORD-24817"
          email="ama.owusu@example.com"
          phone={provider === 'mpesa' ? '0712345678' : '0244128890'}
          paymentMethods={['card', 'mobile_money', 'bank_transfer']}
          initialPaymentIntent={state === 'loading' ? undefined : intent}
          successDelayMs={600000}
          theme={{ companyName: 'Kente & Co.', logoUrl: theme === 'dark' ? logoWhite : logoBlack, darkMode: theme === 'dark' }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
