import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReevitCheckout } from '../src/components/ReevitCheckout';
import '../src/styles.css';

type PreviewState = 'interactive' | 'loading' | 'success' | 'error';

function PreviewApp() {
  const [isOpen, setIsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileView, setMobileView] = useState(false);
  const [activeState, setActiveState] = useState<PreviewState>('interactive');

  // Theme controls
  const [primaryColor, setPrimaryColor] = useState('#0a0a0a');
  const [primaryForegroundColor, setPrimaryForegroundColor] = useState('#525252');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [borderColor, setBorderColor] = useState('rgba(15, 23, 42, 0.08)');
  const [borderRadius, setBorderRadius] = useState('12px');
  const [buttonBg, setButtonBg] = useState('#0ea5e9');
  const [buttonText, setButtonText] = useState('#ffffff');

  // Checkout config
  const [amount, setAmount] = useState(20000);
  const [currency, setCurrency] = useState('GHS');

  const theme = {
    primaryColor: darkMode ? '#fafafa' : primaryColor,
    primaryForegroundColor: darkMode ? '#a3a3a3' : primaryForegroundColor,
    backgroundColor: darkMode ? '#0a0a0a' : backgroundColor,
    borderColor: darkMode ? 'rgba(255,255,255,0.08)' : borderColor,
    borderRadius,
    buttonBackgroundColor: buttonBg,
    buttonTextColor: buttonText,
    darkMode,
    logoUrl: 'https://i.imgur.com/bzUR5Lm.png',
    companyName: 'Acme Store',
  };

  const mockPaymentIntent: any = {
    id: 'pi_preview_123',
    clientSecret: 'cs_preview_123',
    amount,
    currency,
    status: 'pending',
    recommendedPsp: 'paystack',
    availableMethods: ['card', 'mobile_money', 'bank_transfer'],
    availableProviders: [
      { provider: 'paystack', name: 'Paystack', methods: ['card', 'mobile_money', 'bank_transfer'] },
      { provider: 'hubtel', name: 'Hubtel', methods: ['card', 'mobile_money'] },
    ],
    branding: theme,
  };

  const stateLabels: Record<PreviewState, string> = {
    interactive: 'Interactive',
    loading: 'Loading',
    success: 'Success',
    error: 'Error',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#09090b',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontWeight: 600, fontSize: 14, color: '#fafafa' }}>
            reevit/sdk
          </span>
          <span style={{
            fontSize: 11,
            color: '#a3a3a3',
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: "'Geist Mono', monospace",
          }}>
            v0.6.0
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ToggleButton
            active={mobileView}
            onClick={() => setMobileView(!mobileView)}
            label={mobileView ? 'Mobile' : 'Desktop'}
            icon={mobileView ? '📱' : '🖥'}
          />
          <ToggleButton
            active={darkMode}
            onClick={() => setDarkMode(!darkMode)}
            label={darkMode ? 'Dark' : 'Light'}
            icon={darkMode ? '🌙' : '☀️'}
          />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar — Theme controls */}
        <aside style={{
          width: 280,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
          background: '#09090b',
        }}>
          <SectionLabel>Theme</SectionLabel>
          <ColorControl label="Primary text" value={primaryColor} onChange={setPrimaryColor} />
          <ColorControl label="Secondary text" value={primaryForegroundColor} onChange={setPrimaryForegroundColor} />
          <ColorControl label="Background" value={backgroundColor} onChange={setBackgroundColor} />
          <ColorControl label="Border" value={borderColor} onChange={setBorderColor} />
          <ColorControl label="Button bg" value={buttonBg} onChange={setButtonBg} />
          <ColorControl label="Button text" value={buttonText} onChange={setButtonText} />

          <SectionLabel>Layout</SectionLabel>
          <TextControl label="Border radius" value={borderRadius} onChange={setBorderRadius} />
          <TextControl label="Amount (pesewas)" value={String(amount)} onChange={(v) => setAmount(Number(v) || 0)} />
          <SelectControl label="Currency" value={currency} options={['GHS', 'NGN', 'USD', 'KES']} onChange={setCurrency} />
        </aside>

        {/* Main preview area */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 32, gap: 24 }}>
          {/* State tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 4 }}>
            {(Object.keys(stateLabels) as PreviewState[]).map((state) => (
              <button
                key={state}
                onClick={() => setActiveState(state)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: activeState === state ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: activeState === state ? '#fafafa' : '#71717a',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: "'Geist Mono', monospace",
                  transition: 'all 0.15s',
                }}
              >
                {stateLabels[state]}
              </button>
            ))}
          </div>

          {/* Preview frame */}
          <div style={{
            width: mobileView ? 375 : '100%',
            maxWidth: mobileView ? 375 : 520,
            transition: 'width 0.3s ease',
            ...(mobileView ? {
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 24,
              padding: '40px 0 20px',
              background: '#18181b',
              position: 'relative' as const,
              overflow: 'hidden' as const,
            } : {}),
          }}>
            {/* Mobile notch indicator */}
            {mobileView && (
              <div style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 60,
                height: 5,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.15)',
              }} />
            )}

            {activeState === 'interactive' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                {/* Mini product card */}
                <div style={{
                  background: darkMode ? '#18181b' : '#f4f4f5',
                  borderRadius: 16,
                  padding: 24,
                  width: '100%',
                  maxWidth: 400,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: darkMode ? '#fafafa' : '#18181b' }}>Premium Widget</div>
                      <div style={{ fontSize: 12, color: darkMode ? '#71717a' : '#71717a', marginTop: 4 }}>One-time purchase</div>
                    </div>
                    <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 18, fontWeight: 600, color: darkMode ? '#fafafa' : '#18181b' }}>
                      {currency} {(amount / 100).toFixed(2)}
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(true)}
                    style={{
                      width: '100%',
                      padding: '12px 20px',
                      borderRadius: 10,
                      border: 'none',
                      background: buttonBg,
                      color: buttonText,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    Pay now
                  </button>
                </div>
                <p style={{ fontSize: 11, color: '#52525b', fontFamily: "'Geist Mono', monospace" }}>
                  Click "Pay now" to open the checkout
                </p>

                <ReevitCheckout
                  publicKey="pk_test_preview"
                  amount={amount}
                  currency={currency}
                  email="test@example.com"
                  isOpen={isOpen}
                  onOpenChange={setIsOpen}
                  theme={theme}
                  initialPaymentIntent={mockPaymentIntent}
                  onSuccess={(result) => {
                    console.log('Payment success:', result);
                    alert('Payment successful! (Preview mode)');
                  }}
                  onError={(error) => {
                    console.error('Payment error:', error);
                  }}
                  onClose={() => {
                    console.log('Checkout closed');
                    setIsOpen(false);
                  }}
                />
              </div>
            ) : (
              <StatePreview state={activeState} theme={theme} amount={amount} currency={currency} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ===== State Previews — renders each visual state standalone ===== */
function StatePreview({ state, theme, amount, currency }: {
  state: PreviewState;
  theme: Record<string, any>;
  amount: number;
  currency: string;
}) {
  const formatted = `${currency} ${(amount / 100).toFixed(2)}`;
  const dataTheme = theme.darkMode ? 'dark' : 'light';

  const themeVars: Record<string, string> = {};
  if (theme.backgroundColor) themeVars['--reevit-background'] = theme.backgroundColor;
  if (theme.backgroundColor) themeVars['--reevit-surface'] = theme.backgroundColor;
  if (theme.primaryColor) themeVars['--reevit-text'] = theme.primaryColor;
  if (theme.primaryForegroundColor) {
    themeVars['--reevit-text-secondary'] = theme.primaryForegroundColor;
    themeVars['--reevit-muted'] = theme.primaryForegroundColor;
  }
  if (theme.buttonBackgroundColor) {
    themeVars['--reevit-primary'] = theme.buttonBackgroundColor;
    themeVars['--reevit-primary-hover'] = theme.buttonBackgroundColor;
  }
  if (theme.buttonTextColor) themeVars['--reevit-primary-foreground'] = theme.buttonTextColor;
  if (theme.borderColor) themeVars['--reevit-border'] = theme.borderColor;
  if (theme.borderRadius) {
    themeVars['--reevit-radius'] = theme.borderRadius;
    themeVars['--reevit-radius-lg'] = theme.borderRadius;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        className="reevit-modal"
        data-reevit-theme={dataTheme}
        style={{
          ...themeVars,
          position: 'relative',
          animation: 'none',
          maxWidth: 460,
          width: '100%',
        } as React.CSSProperties}
      >
        <div className="reevit-modal__header">
          <div className="reevit-modal__branding">
            {theme.logoUrl && (
              <img src={theme.logoUrl} alt="" className="reevit-modal__logo" />
            )}
            {theme.companyName && (
              <span className="reevit-modal__brand-name">{theme.companyName}</span>
            )}
          </div>
          <button className="reevit-modal__close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="reevit-modal__amount">
          <span className="reevit-modal__amount-label">Pay</span>
          <span className="reevit-modal__amount-value">{formatted}</span>
        </div>

        <div className="reevit-modal__content">
          {state === 'loading' && (
            <div className="reevit-loading reevit-animate-fade-in">
              <div className="reevit-dot-pulse">
                <span className="reevit-dot-pulse__dot" />
                <span className="reevit-dot-pulse__dot" />
                <span className="reevit-dot-pulse__dot" />
              </div>
              <p>Preparing checkout...</p>
            </div>
          )}

          {state === 'success' && (
            <div className="reevit-success reevit-animate-scale-in">
              <div className="reevit-success__icon-wrapper">
                <div className="reevit-success__icon-circle">
                  <svg className="reevit-success__checkmark" viewBox="0 0 52 52">
                    <circle className="reevit-success__checkmark-circle" cx="26" cy="26" r="25" fill="none" />
                    <path className="reevit-success__checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                  </svg>
                </div>
              </div>
              <h3 className="reevit-success__title">Payment Successful!</h3>
              <p className="reevit-success__amount">{formatted}</p>
              <p className="reevit-success__reference">Reference: txn_abc123xyz</p>
              <p className="reevit-success__redirect">Redirecting in a moment...</p>
              <div className="reevit-success__countdown" style={{ animationDuration: '5000ms' }} />
            </div>
          )}

          {state === 'error' && (
            <div className="reevit-error reevit-animate-fade-in">
              <div className="reevit-error__icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <h3>Payment Failed</h3>
              <p>Transaction was declined by your bank. Please try a different card or payment method.</p>
              <button className="reevit-btn reevit-btn--primary">Try Again</button>
            </div>
          )}
        </div>

        <div className="reevit-modal__footer">
          <span className="reevit-modal__secured">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Secured by <span className="reevit-modal__secured-brand">Reevit</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ===== UI Primitives ===== */
function ToggleButton({ active, onClick, label, icon }: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
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
        transition: 'all 0.15s',
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
      paddingTop: 8,
    }}>
      {children}
    </div>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#71717a' }}>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="color"
          value={value.startsWith('#') ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 32,
            height: 32,
            padding: 2,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            background: '#18181b',
            cursor: 'pointer',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
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
    </div>
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
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
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
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<PreviewApp />);
}
