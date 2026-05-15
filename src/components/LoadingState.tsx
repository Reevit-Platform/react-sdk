/**
 * LoadingState Component
 * The single brutalist loading screen used for every loading state across
 * the checkout — server connection, PSP connection, payment processing.
 */

interface LoadingStateProps {
  /** Small status tag above the bars (e.g. "CONNECTING", "PROCESSING"). */
  marker?: string;
  /** Headline. */
  title?: string;
  /** Sub-line beneath the headline. */
  message?: string;
}

export function LoadingState({
  marker = 'PROCESSING',
  title = 'Please wait',
  message = 'Do not close this window',
}: LoadingStateProps) {
  return (
    <div className="reevit-brut__state">
      <span className="reevit-brut__state-marker">{marker}</span>
      <div className="reevit-brut__bars">
        <span /><span /><span /><span /><span />
      </div>
      <h3 className="reevit-brut__state-title">{title}</h3>
      <p className="reevit-brut__state-sub">{message}</p>
    </div>
  );
}
