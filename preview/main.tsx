import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReevitCheckout } from '../src/components/ReevitCheckout';
import '../src/styles.css';

function PreviewApp() {
  const [isOpen, setIsOpen] = useState(false);

  // Theme controls
  const [primaryColor, setPrimaryColor] = useState('#0f172a');
  const [primaryForegroundColor, setPrimaryForegroundColor] = useState('#64748b');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [borderColor, setBorderColor] = useState('#e2e8f0');
  const [borderRadius, setBorderRadius] = useState('12px');

  // Checkout config
  const [amount, setAmount] = useState(20000); // 200.00 in smallest unit
  const [currency, setCurrency] = useState('GHS');

  const theme = {
    primaryColor,
    primaryForegroundColor,
    backgroundColor,
    borderColor,
    borderRadius,
    logoUrl: 'https://i.imgur.com/bzUR5Lm.png',
    companyName: 'Acme Store',
  };

  // Mock payment intent for preview
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

  return (
    <div className="preview-container">
      <div className="preview-header">
        <h1>🎨 Reevit SDK Preview</h1>
        <p>Customize the checkout appearance and test locally</p>
      </div>

      <div className="controls">
        <div className="theme-grid">
          <div className="control-group">
            <label>Primary Color (Main Text)</label>
            <div className="color-input">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#0f172a"
              />
            </div>
          </div>

          <div className="control-group">
            <label>Primary Foreground (Sub Text)</label>
            <div className="color-input">
              <input
                type="color"
                value={primaryForegroundColor}
                onChange={(e) => setPrimaryForegroundColor(e.target.value)}
              />
              <input
                type="text"
                value={primaryForegroundColor}
                onChange={(e) => setPrimaryForegroundColor(e.target.value)}
                placeholder="#64748b"
              />
            </div>
          </div>

          <div className="control-group">
            <label>Background Color</label>
            <div className="color-input">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                placeholder="#ffffff"
              />
            </div>
          </div>

          <div className="control-group">
            <label>Border Color</label>
            <div className="color-input">
              <input
                type="color"
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
              />
              <input
                type="text"
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
                placeholder="#e2e8f0"
              />
            </div>
          </div>
        </div>

        <div className="theme-grid">
          <div className="control-group">
            <label>Amount (smallest unit)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="20000"
            />
          </div>

          <div className="control-group">
            <label>Border Radius</label>
            <input
              type="text"
              value={borderRadius}
              onChange={(e) => setBorderRadius(e.target.value)}
              placeholder="12px"
            />
          </div>
        </div>
      </div>

      <button className="trigger-btn" onClick={() => setIsOpen(true)}>
        Open Checkout Preview
      </button>

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
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<PreviewApp />);
}
