import { useRef, useState } from 'react';
import { api, cash, dateTime } from '../lib/api';
import { useStore } from '../lib/storeContext';
import { Modal, Button, Field, ErrorState, Table, Badge } from './ui';
import './storeOperations.css';

export function ReturnLookup({ onFound, onClose }) {
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Find sale for return"
      subtitle="Enter the receipt or transaction number from the original sale."
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            onFound(await api(`/sales/lookup?number=${encodeURIComponent(number.trim())}`));
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Receipt or transaction number">
            <input
              autoFocus
              required
              maxLength={250}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="SK-…"
            />
          </Field>
          {error && <ErrorState message={error} />}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy}>Find sale</Button>
        </footer>
      </form>
    </Modal>
  );
}

export default function ReturnSale({ sale, onClose, onSaved }) {
  const { data, refresh, notify } = useStore();
  const [selections, setSelections] = useState({});
  const [reason, setReason] = useState('');
  const [assessed, setAssessed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(null);
  const pending = useRef(null);
  const policy = sale.return_policy;
  const conditions = (policy?.conditions || data.settings.return_conditions || []).filter(
    (c) => c.enabled,
  );
  const m = (value) => cash(value, data.settings.currency);
  const selected = sale.items.filter((item) => Number(selections[item.id]?.quantity) > 0);
  const amount = (item) => {
    const count = Number(selections[item.id]?.quantity || 0);
    if (!Number.isInteger(count) || count < 0 || count > item.returnable_quantity) return 0;
    return (
      Math.floor(
        (Number(item.paid_total) * (Number(item.returned_quantity) + count)) / item.quantity,
      ) - Math.floor((Number(item.paid_total) * Number(item.returned_quantity)) / item.quantity)
    );
  };
  const total = selected.reduce((sum, item) => sum + amount(item), 0);
  const change = (id, key, value) =>
    setSelections((v) => ({ ...v, [id]: { ...v[id], [key]: value } }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!pending.current) {
      if (!selected.length) {
        setError('Select at least one product quantity to return.');
        return;
      }
      pending.current = {
        reason: reason.trim(),
        items: selected.map((item) => ({
          sale_item_id: item.id,
          quantity: Number(selections[item.id].quantity),
          condition: selections[item.id].condition || '',
        })),
        idempotency_key: crypto.randomUUID(),
      };
    }
    setBusy(true);
    try {
      const result = await api(`/sales/${sale.id}/returns`, {
        method: 'POST',
        body: pending.current,
      });
      setSaved(result);
      setUncertain(false);
      pending.current = null;
      onSaved?.(result);
      try {
        await refresh();
      } catch {
        notify('Return saved. Refresh the page to update the stock display.', 'error');
      }
    } catch (e) {
      setError(e.message);
      if (!e.status || e.status >= 500) setUncertain(true);
      else {
        pending.current = null;
        setUncertain(false);
      }
    } finally {
      setBusy(false);
    }
  };
  if (saved)
    return (
      <Modal title="Return recorded" subtitle={saved.number} onClose={onClose}>
        <div className="modal-body">
          <div className="operation-summary">
            <div>
              <small>Original receipt</small>
              <strong>{sale.number}</strong>
            </div>
            <div>
              <small>Refund recorded</small>
              <strong>{m(saved.total)}</strong>
            </div>
          </div>
          <p>
            The original sale is preserved. Sellable units have been added to available inventory;
            damaged or defective units are recorded separately.
          </p>
          <p className="info-note">
            Issue the recorded refund using your store’s payment process. This system records the
            refund; it does not transfer money to the customer.
          </p>
        </div>
        <footer>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </Modal>
    );
  return (
    <Modal
      title="Return products"
      subtitle={sale.number}
      onClose={() => !busy && onClose()}
      wide
      className="operations-modal"
    >
      <form onSubmit={submit} className="return-form">
        <div className="modal-body">
          <div className="operation-summary">
            <div>
              <small>Purchased</small>
              <strong>{dateTime(sale.created_at, data.settings.timezone)}</strong>
            </div>
            <div>
              <small>Original payment</small>
              <strong>
                {m(sale.total)} · {sale.payment_method}
              </strong>
            </div>
            <div>
              <small>Return deadline</small>
              <strong>
                {policy?.expires_at
                  ? dateTime(policy.expires_at, data.settings.timezone)
                  : 'Unavailable'}
              </strong>
            </div>
          </div>
          {!policy?.eligible && (
            <ErrorState message={policy?.message || 'This sale is not eligible for a return.'} />
          )}
          <Table
            pagination={false}
            pageSize={200}
            rows={sale.items}
            columns={[
              {
                key: 'name',
                label: 'Purchased product',
                render: (item) => (
                  <div className="return-line-name">
                    <strong>{item.name}</strong>
                    <small>
                      {item.sku} · {m(item.unit_price)} original unit price
                    </small>
                  </div>
                ),
              },
              { key: 'quantity', label: 'Purchased' },
              { key: 'returned_quantity', label: 'Already returned' },
              {
                key: 'paid_total',
                label: 'Original line paid',
                render: (item) => m(item.paid_total),
              },
              {
                key: 'return_quantity',
                label: 'Return quantity',
                render: (item) => (
                  <input
                    type="number"
                    aria-label={`Return quantity for ${item.name}`}
                    min="0"
                    max={item.returnable_quantity}
                    step="1"
                    value={selections[item.id]?.quantity || ''}
                    placeholder="0"
                    disabled={busy || uncertain || !policy?.eligible || !item.returnable_quantity}
                    onChange={(e) => change(item.id, 'quantity', e.target.value)}
                  />
                ),
              },
              {
                key: 'condition',
                label: 'Inspected condition',
                render: (item) => (
                  <select
                    aria-label={`Condition for ${item.name}`}
                    required={Number(selections[item.id]?.quantity) > 0}
                    value={selections[item.id]?.condition || ''}
                    disabled={busy || uncertain || !policy?.eligible || !item.returnable_quantity}
                    onChange={(e) => change(item.id, 'condition', e.target.value)}
                  >
                    <option value="">Select condition</option>
                    {conditions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                        {c.sellable || /non-sellable/i.test(c.label) ? '' : ' (non-sellable)'}
                      </option>
                    ))}
                  </select>
                ),
              },
              { key: 'refund', label: 'Refund', render: (item) => m(amount(item)) },
            ]}
          />
          <p className="muted">
            Refunds use the original payment after discounts and tax, with rounding allocated across
            units. Leave quantity at zero for items the customer is keeping.
          </p>
          {policy?.eligible && (
            <>
              <Field label="Return reason">
                <textarea
                  required
                  minLength={3}
                  maxLength={250}
                  disabled={busy || uncertain}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why these products are being returned"
                />
              </Field>
              <label className="check-field">
                <input
                  type="checkbox"
                  required
                  checked={assessed}
                  disabled={busy || uncertain}
                  onChange={(e) => setAssessed(e.target.checked)}
                />
                I have inspected the selected products and confirmed their condition.
              </label>
              <div className="return-total">
                <span>Refund to record</span>
                <strong>{m(total)}</strong>
              </div>
            </>
          )}
          {uncertain && (
            <p className="info-note">
              The result could not be confirmed. Retry this same request to safely retrieve or
              finish the return without recording it twice.
            </p>
          )}
          {error && <ErrorState message={error} />}
          {!!sale.returns?.length && (
            <section className="return-history">
              <h3>Previous returns</h3>
              {sale.returns.map((record) => (
                <article key={record.id}>
                  <strong>
                    {record.number} · {m(record.total)}
                  </strong>
                  <p>
                    {dateTime(record.created_at, data.settings.timezone)} ·{' '}
                    {record.operator || record.user_name || 'Store operator'}
                  </p>
                  <p>{record.reason}</p>
                  {record.items?.map((item) => (
                    <p key={item.id}>
                      {item.name} × {item.quantity} · {item.condition_label || item.condition}{' '}
                      <Badge tone={item.sellable ? 'green' : 'amber'}>
                        {item.sellable ? 'Restocked' : 'Non-sellable'}
                      </Badge>
                    </p>
                  ))}
                </article>
              ))}
            </section>
          )}
        </div>
        <footer>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {policy?.eligible && (
            <Button loading={busy} disabled={!selected.length || !conditions.length}>
              {uncertain ? 'Retry return' : 'Record return'}
            </Button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
