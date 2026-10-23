/**
 * Receipt and failure panels (Ledger results).
 */

import { useState } from 'react';

interface ReceiptPanelProps {
  reference: string;
  method: string;
  provider: string;
  merchantName: string;
  orderRef?: string;
  amountText: string;
  onDone: () => void;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const formatDate = (date: Date) =>
  date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ReceiptPanel({ reference, method, provider, merchantName, orderRef, amountText, onDone }: ReceiptPanelProps) {
  // Frozen at first render so the receipt time never changes while it is open.
  const [paidAt] = useState(() => formatDate(new Date()));

  const download = () => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const row = (k: string, v: string) =>
      `<tr><td style="color:#6b6a64;padding:6px 24px 6px 0">${escapeHtml(k)}</td><td style="padding:6px 0">${escapeHtml(v)}</td></tr>`;
    const html =
      `<!doctype html><meta charset="utf-8"><title>Receipt ${escapeHtml(orderRef || reference)}</title>` +
      `<body style="font:15px/1.5 system-ui;color:#151513;background:#f4f3ee;padding:40px">` +
      `<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(merchantName)}</h1>` +
      `<p style="margin:0 0 24px;color:#6b6a64">Payment receipt</p><table>` +
      (orderRef ? row('Order', orderRef) : '') +
      `${row('Amount', amountText)}${row('Reference', reference)}${row('Method', method)}${row('Provider', provider)}${row('Date', paidAt)}</table>` +
      `<p style="margin-top:24px;color:#6b6a64">Secured by Reevit</p>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `receipt-${orderRef || reference}.html`;
    document.body.append(a);
    a.click();
    a.remove();
    const href = a.href;
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <div className="reevit-result reevit-result--ok">
      <svg className="reevit-result-icon" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="19" />
        <path className="reevit-tick" d="M14 22.5l6 6 10-12" />
      </svg>
      <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">Payment received</h2>
      <dl className="reevit-receipt" data-reevit="receipt">
        <div><dt>Reference</dt><dd className="reevit-mono">{reference}</dd></div>
        <div><dt>Method</dt><dd>{method}</dd></div>
        <div><dt>Provider</dt><dd>{provider}</dd></div>
        <div><dt>Date</dt><dd className="reevit-mono">{paidAt}</dd></div>
      </dl>
      <button type="button" className="reevit-cta" data-reevit="done" data-first="" onClick={onDone}>Done</button>
      <button type="button" className="reevit-cta-secondary" data-reevit="download" onClick={download}>Download receipt</button>
    </div>
  );
}

interface FailurePanelProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function FailurePanel({ title, message, onRetry }: FailurePanelProps) {
  return (
    <div className="reevit-result" data-reevit="failure">
      <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">
        <span className="reevit-fail-dot" aria-hidden="true" />
        {title}
      </h2>
      <p className="reevit-text">{message}</p>
      <button type="button" className="reevit-cta" data-reevit="cta" data-first="" onClick={onRetry}>Try again</button>
    </div>
  );
}
