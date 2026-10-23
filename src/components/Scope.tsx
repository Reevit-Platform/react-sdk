/**
 * Scope
 * Every Ledger style is scoped under `.reevit-root`. Inside ReevitCheckout that
 * root already exists; bridges rendered on their own (documented in the README)
 * get a static one so they look the same without a dialog around them.
 */

import { createContext, useContext, type ReactNode } from 'react';

const ScopeContext = createContext(false);

export const ScopeProvider = ScopeContext.Provider;

export function Scope({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const inside = useContext(ScopeContext);
  if (inside) return <>{children}</>;
  return (
    <div className="reevit-root reevit-root--inline" data-reevit-theme={dark ? 'dark' : undefined}>
      {children}
    </div>
  );
}
