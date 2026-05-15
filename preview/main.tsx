import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReevitCheckout } from '../src/components/ReevitCheckout';
import '../src/styles.css';

type ProviderId = 'paystack' | 'flutterwave' | 'hubtel' | 'monnify' | 'stripe' | 'mpesa';

/** Real PSP -> method capability map (mirrors backend defaultProviderMethods). */
const ALL_PROVIDERS: { provider: ProviderId; name: string; methods: string[] }[] = [
  { provider: 'paystack', name: 'Paystack', methods: ['card', 'mobile_money', 'bank_transfer'] },
  { provider: 'flutterwave', name: 'Flutterwave', methods: ['card', 'mobile_money', 'bank_transfer'] },
  { provider: 'hubtel', name: 'Hubtel', methods: ['card', 'mobile_money'] },
  { provider: 'monnify', name: 'Monnify', methods: ['card', 'bank_transfer'] },
  { provider: 'stripe', name: 'Stripe', methods: ['card'] },
  { provider: 'mpesa', name: 'M-Pesa', methods: ['mobile_money'] },
];

function PreviewApp() {
  const [isOpen, setIsOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [companyName, setCompanyName] = useState('Acme Store');
  const [logoUrl, setLogoUrl] = useState('https://i.imgur.com/bzUR5Lm.png');
  const [amount, setAmount] = useState(20000);
  const [currency, setCurrency] = useState('GHS');
  const [connected, setConnected] = useState<Record<ProviderId, boolean>>({
    paystack: true,
    flutterwave: true,
    hubtel: true,
    monnify: false,
    stripe: true,
    mpesa: true,
  });

  const availableProviders = useMemo(
    () => ALL_PROVIDERS.filter((p) => connected[p.provider]),
    [connected],
  );

  const theme = {
    darkMode,
    logoUrl,
    companyName,
    buttonBackgroundColor: undefined,
  };

  // A mock payment intent lets the real ReevitCheckout render without an API call.
  const mockPaymentIntent: any = useMemo(() => ({
    id: 'pi_preview_123',
    clientSecret: 'cs_preview_123',
    amount,
    currency,
    status: 'pending',
    recommendedPsp: availableProviders[0]?.provider ?? 'paystack',
    availableMethods: ['card', 'mobile_money', 'bank_transfer'],
    availableProviders,
    branding: theme,
  }), [amount, currency, availableProviders, darkMode, logoUrl, companyName]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#09090b',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontWeight: 600, fontSize: 14 }}>
            reevit/sdk · checkout
          </span>
          <span style={{
            fontSize: 11,
            color: '#a3a3a3',
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: "'Geist Mono', monospace",
          }}>
            ReevitCheckout · brutalist
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ToggleButton active={darkMode} onClick={() => setDarkMode(!darkMode)}
            label={darkMode ? 'Dark' : 'Light'} icon={darkMode ? '🌙' : '☀️'} />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        <aside style={{
          width: 268,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
          background: '#09090b',
        }}>
          <SectionLabel>Connected providers</SectionLabel>
          <p style={{ fontSize: 10.5, color: '#71717a', lineHeight: 1.5, marginTop: -6 }}>
            Toggle which PSPs this merchant has connected. Each provider only
            exposes the methods it actually supports.
          </p>
          {ALL_PROVIDERS.map((p) => (
            <CheckRow
              key={p.provider}
              label={p.name}
              hint={p.methods.length + (p.methods.length === 1 ? ' method' : ' methods')}
              checked={connected[p.provider]}
              onChange={(v) => setConnected((prev) => ({ ...prev, [p.provider]: v }))}
            />
          ))}

          <SectionLabel>Brand</SectionLabel>
          <TextControl label="Company" value={companyName} onChange={setCompanyName} />
          <TextControl label="Logo URL" value={logoUrl} onChange={setLogoUrl} />

          <SectionLabel>Amount</SectionLabel>
          <TextControl label="Minor units" value={String(amount)} onChange={(v) => setAmount(Number(v) || 0)} />
          <SelectControl label="Currency" value={currency} options={['GHS', 'NGN', 'USD', 'KES']} onChange={setCurrency} />
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          {!isOpen && (
            <button
              onClick={() => setIsOpen(true)}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fafafa',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'Geist Mono', monospace",
              }}
            >
              Open checkout
            </button>
          )}
          <p style={{ fontSize: 11, color: '#52525b', fontFamily: "'Geist Mono', monospace" }}>
            Live ReevitCheckout · mock payment intent · {availableProviders.length} provider(s)
          </p>

          <ReevitCheckout
            publicKey="pfk_test_preview"
            amount={amount}
            currency={currency}
            email="test@example.com"
            paymentMethods={['card', 'mobile_money', 'bank_transfer']}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            theme={theme}
            initialPaymentIntent={mockPaymentIntent}
            successDelayMs={0}
            onSuccess={(result) => console.log('Payment success:', result)}
            onError={(err) => console.error('Payment error:', err)}
            onClose={() => setIsOpen(false)}
          />
        </main>
      </div>
    </div>
  );
}

function ToggleButton({ active, onClick, label, icon }: {
  active: boolean; onClick: () => void; label: string; icon: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid',
        borderColor: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fafafa' : '#71717a',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: "'Geist Mono', monospace",
      }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      color: '#52525b',
      fontFamily: "'Geist Mono', monospace",
      paddingTop: 6,
    }}>{children}</div>
  );
}

function CheckRow({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 9px',
        borderRadius: 7,
        border: '1px solid',
        borderColor: checked ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)',
        background: checked ? 'rgba(255,255,255,0.05)' : 'transparent',
        cursor: 'pointer',
        fontFamily: "'Inter', sans-serif",
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 15,
        height: 15,
        borderRadius: 4,
        border: '1.5px solid',
        borderColor: checked ? '#00c853' : 'rgba(255,255,255,0.2)',
        background: checked ? '#00c853' : 'transparent',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        )}
      </span>
      <span style={{ flex: 1, fontSize: 12.5, color: checked ? '#fafafa' : '#a1a1aa', fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ fontSize: 10, color: '#52525b', fontFamily: "'Geist Mono', monospace" }}>{hint}</span>
    </button>
  );
}

function TextControl({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#71717a' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#18181b',
          color: '#fafafa',
          fontSize: 12,
          fontFamily: "'Geist Mono', monospace",
        }}
      />
    </div>
  );
}

function SelectControl({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#71717a' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#18181b',
          color: '#fafafa',
          fontSize: 12,
          fontFamily: "'Geist Mono', monospace",
        }}
      >
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<PreviewApp />);
}
