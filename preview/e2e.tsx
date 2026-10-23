/**
 * Live checkout against a real backend, no stubs:
 *
 *   /e2e.html?api=http://localhost:8081&session=cs_...
 *
 * Create the session on the server (POST /v1/checkout/sessions with an API key)
 * and pass its `session_secret`. With the backend's `stub` provider, the number's
 * last digits pick the outcome (see adapters/psp/stub). Events are written to
 * `window.__events` so a script can assert on them.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReevitCheckout } from '../src/components/ReevitCheckout';
import '../src/styles.css';

const params = new URLSearchParams(location.search);
const events: string[] = [];
(window as unknown as { __events: string[] }).__events = events;

function App() {
  const [open, setOpen] = useState(true);
  return (
    <ReevitCheckout
      isOpen={open}
      onOpenChange={setOpen}
      sessionSecret={params.get('session') || ''}
      apiBaseUrl={params.get('api') || 'http://localhost:8080'}
      reference="ORD-24817"
      paymentMethods={['card', 'mobile_money']}
      successDelayMs={600000}
      theme={{ companyName: 'Kente & Co.' }}
      onSuccess={(r) => events.push(`success:${r.paymentId}`)}
      onError={(e) => events.push(`error:${e.code}`)}
      onClose={() => events.push('close')}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
