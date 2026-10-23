/**
 * CheckoutShell
 * The Ledger dialog frame: scrim, header, amount line, scrolling body, footer,
 * leave-confirmation, and the accessibility plumbing (focus in, Tab trap, Esc,
 * focus return to the opener, polite live region).
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CloseIcon } from './icons';
import { ScopeProvider } from './Scope';

export interface FooterProvider {
  id: string;
  name: string;
  src: string;
  kind: 'icon' | 'word';
}

interface CheckoutShellProps {
  theme?: 'light' | 'dark';
  style?: CSSProperties;
  brandName: string;
  logoUrl?: string;
  /** True when brandName is a real company name (drives the initial fallback). */
  hasBrandName: boolean;
  amountText: string;
  orderRef?: string;
  footerProvider?: FooterProvider | null;
  /** Changes whenever a new view mounts; moves focus into it. */
  viewKey: string;
  /** Text announced to screen readers when the view changes. */
  announce: string;
  confirmOpen: boolean;
  onRequestClose: () => void;
  onStay: () => void;
  onLeave: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'button,input,a[href],[tabindex]:not([tabindex="-1"])';

export function CheckoutShell({
  theme,
  style,
  brandName,
  logoUrl,
  hasBrandName,
  amountText,
  orderRef,
  footerProvider,
  viewKey,
  announce,
  confirmOpen,
  onRequestClose,
  onStay,
  onLeave,
  children,
}: CheckoutShellProps) {
  const titleId = useId();
  const confirmTitleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const lastFocusRef = useRef<Element | null>(null);
  const [live, setLive] = useState('');

  // The latest handlers, read from the document-level key listener.
  const handlers = useRef({ onRequestClose, onStay, confirmOpen });
  handlers.current = { onRequestClose, onStay, confirmOpen };

  // Return focus to whatever opened the checkout.
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Move focus into each new view and announce it.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>('[data-first]') ?? body.querySelector<HTMLElement>('[data-reevit="panel-title"]');
    target?.focus({ preventScroll: true });
    setLive('');
    const frame = requestAnimationFrame(() => setLive(announce));
    return () => cancelAnimationFrame(frame);
  }, [viewKey]);

  // Leave confirmation takes focus, and gives it back when dismissed.
  useEffect(() => {
    if (confirmOpen) {
      lastFocusRef.current = document.activeElement;
      stayRef.current?.focus({ preventScroll: true });
      setLive('Leave checkout? Your payment hasn’t finished.');
      return;
    }
    const prev = lastFocusRef.current;
    lastFocusRef.current = null;
    if (prev instanceof HTMLElement && prev.isConnected) prev.focus({ preventScroll: true });
  }, [confirmOpen]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const active = document.activeElement;
    // Leave keys alone while focus is in a provider window or elsewhere on the page.
    if (active && active !== document.body && !root.contains(active)) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (handlers.current.confirmOpen) handlers.current.onStay();
      else handlers.current.onRequestClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const scope = handlers.current.confirmOpen ? confirmRef.current : dialogRef.current;
    if (!scope) return;
    const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !(n as HTMLButtonElement).disabled && !n.closest('[inert],[hidden]'),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!active || !scope.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || !items.includes(active as HTMLElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onKeyDown]);

  // `inert` is not in React 18's DOM typings; spread it as a plain attribute.
  const inertProps = confirmOpen ? ({ inert: '' } as Record<string, string>) : {};

  return (
    <ScopeProvider value>
      <div ref={rootRef} className="reevit-root" style={style} data-reevit="root" data-reevit-theme={theme}>
        <div
          className="reevit-scrim"
          data-reevit="scrim"
          onClick={(e) => { if (e.target === e.currentTarget) onRequestClose(); }}
        >
          <div ref={dialogRef} className="reevit-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <i className="reevit-grabber" aria-hidden="true" />
            <header className="reevit-header" data-reevit="header" {...inertProps}>
              <div className="reevit-brand">
                {logoUrl ? (
                  <img className="reevit-brand-logo" src={logoUrl} alt="" />
                ) : hasBrandName ? (
                  <span className="reevit-brand-initial" aria-hidden="true">{brandName.charAt(0).toUpperCase()}</span>
                ) : null}
                <h1 className="reevit-title" id={titleId} data-reevit="title">{brandName}</h1>
              </div>
              <button type="button" className="reevit-close" data-reevit="close" aria-label="Close checkout" onClick={onRequestClose}>
                <CloseIcon />
              </button>
            </header>
            <div className="reevit-summary" {...inertProps}>
              <span className="reevit-amount reevit-mono" data-reevit="amount">{amountText}</span>
              {orderRef && <span className="reevit-ref" data-reevit="ref">{orderRef}</span>}
            </div>
            <div className="reevit-body" ref={bodyRef} data-reevit="body" {...inertProps}>{children}</div>
            <footer className="reevit-footer" data-reevit="footer" {...inertProps}>
              <span>Secured by Reevit</span>
              {footerProvider && (
                <>
                  <span className="reevit-footer-sep" aria-hidden="true" />
                  <img
                    className="reevit-footer-logo"
                    data-reevit="footer-logo"
                    data-kind={footerProvider.kind}
                    data-provider={footerProvider.id}
                    src={footerProvider.src}
                    alt={footerProvider.name}
                  />
                </>
              )}
            </footer>
            {confirmOpen && (
              <div ref={confirmRef} className="reevit-confirm" data-reevit="confirm" role="alertdialog" aria-modal="true" aria-labelledby={confirmTitleId}>
                <div className="reevit-confirm-box">
                  <h2 id={confirmTitleId} tabIndex={-1}>Leave checkout?</h2>
                  <p>Your payment hasn’t finished.</p>
                  <button ref={stayRef} type="button" className="reevit-cta" data-reevit="stay" onClick={onStay}>Keep paying</button>
                  <button type="button" className="reevit-cta-secondary" data-reevit="leave" onClick={onLeave}>Leave</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="reevit-sr" role="status" aria-live="polite" data-reevit="live">{live}</div>
      </div>
    </ScopeProvider>
  );
}
