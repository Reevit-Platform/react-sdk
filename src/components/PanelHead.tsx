/** Back chevron + title row used by every detail panel. */

import { BackIcon } from './icons';

interface PanelHeadProps {
  title: string;
  /** Omit when the panel is the only step (nothing to go back to). */
  onBack?: () => void;
}

export function PanelHead({ title, onBack }: PanelHeadProps) {
  return (
    <div className={onBack ? 'reevit-panel-head' : 'reevit-panel-head reevit-panel-head--plain'}>
      {onBack && (
        <button type="button" className="reevit-back" data-reevit="back" aria-label="Back to payment methods" onClick={onBack}>
          <BackIcon />
        </button>
      )}
      <h2 className={onBack ? 'reevit-panel-title' : 'reevit-panel-title reevit-sr'} tabIndex={-1} data-reevit="panel-title">
        {title}
      </h2>
    </div>
  );
}
