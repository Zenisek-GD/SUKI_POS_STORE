import { useId, useRef, useState } from 'react';
import { Delete, Check } from 'lucide-react';
import { Button, Modal } from './ui';
import './QuantityKeypad.css';

export default function QuantityKeypad({
  value,
  max = 1000000,
  title = 'Set quantity',
  subtitle,
  onApply,
  onClose,
}) {
  const [draft, setDraft] = useState(() => String(value ?? 1));
  const [replaceOnDigit, setReplaceOnDigit] = useState(true);
  const [applyError, setApplyError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.floor(Number(max))) : 1000000;
  const quantity = Number(draft);
  const validation =
    limit < 1
      ? 'No quantity is currently available for this item.'
      : !/^\d+$/.test(draft) || !Number.isSafeInteger(quantity) || quantity < 1
        ? 'Enter a whole number of at least 1.'
        : quantity > limit
          ? `Quantity cannot exceed ${limit.toLocaleString()}.`
          : '';
  const error = applyError || validation;

  function edit(next) {
    if (submitting.current) return;
    setDraft(next);
    setReplaceOnDigit(false);
    setApplyError('');
  }

  function digit(number) {
    edit(replaceOnDigit || draft === '0' ? number : `${draft}${number}`);
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || validation) return;
    submitting.current = true;
    setBusy(true);
    setApplyError('');
    try {
      const result = await onApply(quantity);
      if (result === false || typeof result === 'string') {
        setApplyError(result || 'Unable to use this quantity. Check the available stock.');
      } else {
        onClose();
      }
    } catch (err) {
      setApplyError(err.message || 'Unable to use this quantity. Please try again.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function hardwareKey(event) {
    if (event.target.tagName === 'INPUT' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      digit(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      edit(draft.slice(0, -1));
    } else if (event.key === 'Delete') {
      event.preventDefault();
      edit('');
    }
  }

  return (
    <Modal
      className="quantity-keypad"
      title={title}
      subtitle={subtitle}
      onClose={() => !submitting.current && onClose()}
    >
      <form onSubmit={submit} onKeyDown={hardwareKey} noValidate>
        <div className="quantity-keypad-body">
          <label className="quantity-keypad-label" htmlFor={inputId}>
            Quantity
            <span>Max. {limit.toLocaleString()}</span>
          </label>
          <input
            id={inputId}
            className="quantity-keypad-value"
            aria-label="Quantity value"
            aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
            aria-invalid={Boolean(error)}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft}
            disabled={busy}
            onFocus={(event) => event.target.select()}
            onChange={(event) => edit(event.target.value)}
          />
          <p id={hintId} className="quantity-keypad-hint">
            {replaceOnDigit
              ? 'Tap a number to replace the current quantity.'
              : 'Tap the keys or type a quantity.'}
          </p>
          <div className="quantity-keypad-presets" role="group" aria-label="Quick quantities">
            {[1, 2, 5, 10].map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Set quantity to ${preset}`}
                disabled={busy || preset > limit}
                onClick={() => {
                  edit(String(preset));
                  setReplaceOnDigit(true);
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="quantity-keypad-grid" role="group" aria-label="Quantity number pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((number) => (
              <button
                key={number}
                type="button"
                aria-label={`Quantity digit ${number}`}
                disabled={busy}
                autoFocus={number === '1'}
                onClick={() => digit(number)}
              >
                {number}
              </button>
            ))}
            <button
              type="button"
              className="quantity-keypad-utility"
              aria-label="Clear quantity"
              disabled={busy}
              onClick={() => edit('')}
            >
              Clear
            </button>
            <button
              type="button"
              aria-label="Quantity digit 0"
              disabled={busy}
              onClick={() => digit('0')}
            >
              0
            </button>
            <button
              type="button"
              className="quantity-keypad-utility"
              aria-label="Delete last digit"
              disabled={busy || !draft}
              onClick={() => edit(draft.slice(0, -1))}
            >
              <Delete size={24} aria-hidden="true" />
            </button>
          </div>
          {error && (
            <p id={errorId} className="quantity-keypad-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="quantity-keypad-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={Boolean(validation)} loading={busy}>
            <Check size={19} aria-hidden="true" />
            Use quantity
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
