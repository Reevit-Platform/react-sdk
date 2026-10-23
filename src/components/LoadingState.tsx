/**
 * LoadingState
 * The Ledger "working" look. `block` is the centred processing state
 * (spinner, title, optional line); `line` is the compact spinner line shown
 * under a panel header while a provider window is opening.
 */

import { Scope } from './Scope';

interface LoadingStateProps {
  title?: string;
  message?: string;
  variant?: 'block' | 'line';
}

export function LoadingState({ title = 'Please wait', message, variant = 'block' }: LoadingStateProps) {
  if (variant === 'line') {
    return (
      <Scope>
        <p className="reevit-opening" data-reevit="status" role="status">
          <span className="reevit-spin" aria-hidden="true" />
          {title}
        </p>
      </Scope>
    );
  }

  return (
    <Scope>
      <div className="reevit-processing" data-reevit="processing">
        <span className="reevit-spin reevit-spin--lg" aria-hidden="true" />
        <h2 className="reevit-panel-title" tabIndex={-1} data-reevit="panel-title">{title}</h2>
        {message && <p className="reevit-text">{message}</p>}
      </div>
    </Scope>
  );
}
