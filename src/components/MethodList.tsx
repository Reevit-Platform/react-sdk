/**
 * MethodList
 * The Ledger method list: one row per payment method, brand marks on the right.
 */

import type { PaymentMethod } from '../types';
import { getMethodMarks } from '../utils';
import { ChevronIcon } from './icons';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Card',
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
};

interface MethodListProps {
  methods: PaymentMethod[];
  country: string;
  disabled?: boolean;
  onPick: (method: PaymentMethod) => void;
}

export function MethodList({ methods, country, disabled = false, onPick }: MethodListProps) {
  return (
    <>
      <ul className="reevit-list" data-reevit="list" aria-label="Payment methods">
        {methods.map((method, index) => (
          <li key={method}>
            <button
              type="button"
              className="reevit-row"
              data-reevit="row"
              data-method={method}
              data-first={index === 0 ? '' : undefined}
              disabled={disabled}
              onClick={() => onPick(method)}
            >
              <span className="reevit-row-label">{METHOD_LABEL[method]}</span>
              <span className="reevit-marks" data-reevit="marks" aria-hidden="true">
                {getMethodMarks(country, method).map((mark) => (
                  <img key={mark.key} src={mark.src} data-mark={mark.key} alt="" />
                ))}
              </span>
              <span className="reevit-chevron" aria-hidden="true"><ChevronIcon /></span>
            </button>
          </li>
        ))}
      </ul>
      <h2 className="reevit-sr" tabIndex={-1} data-reevit="panel-title">Choose a payment method</h2>
    </>
  );
}
