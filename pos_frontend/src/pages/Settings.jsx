import { useState } from 'react';
import {
  Save,
  Store,
  ReceiptText,
  CreditCard,
  ShieldCheck,
  Plus,
  Pencil,
  Percent,
} from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { api } from '../lib/api';
import { PageHeader, Button, Field, ErrorState, Badge } from '../components/ui';
import EntityForm from '../components/EntityForm';
export default function Settings() {
  const { data, refresh, notify } = useStore(),
    [values, setValues] = useState({ ...data.settings }),
    [payments, setPayments] = useState(data.settings.payment_methods.join(', ')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discount, setDiscount] = useState(null);
  const change = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          ...values,
          tax_rate: Number(values.tax_rate),
          low_stock_threshold: Number(values.low_stock_threshold),
          cashier_discount_limit: Number(values.cashier_discount_limit),
          payment_methods: payments
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      await refresh();
      notify('Store settings saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="MAKE YOURSELF AT HOME"
        title="Store settings"
        description="The little details that make this store yours."
      >
        <Button form="settings-form" loading={busy}>
          <Save size={17} />
          Save changes
        </Button>
      </PageHeader>
      <form id="settings-form" onSubmit={submit} className="settings-layout">
        <section className="panel">
          <div className="panel-header">
            <div className="settings-section-title">
              <span>
                <Store size={21} />
              </span>
              <div>
                <h2>Store profile</h2>
                <p>Shown on your dashboard and receipts.</p>
              </div>
            </div>
          </div>
          <div className="modal-body form-grid">
            <Field label="Store name" full>
              <input
                required
                value={values.name}
                maxLength={250}
                onChange={(e) => change('name', e.target.value)}
              />
            </Field>
            <Field label="Address" full>
              <textarea
                value={values.address}
                maxLength={500}
                onChange={(e) => change('address', e.target.value)}
              />
            </Field>
            <Field label="Contact information">
              <input
                value={values.contact}
                maxLength={250}
                onChange={(e) => change('contact', e.target.value)}
              />
            </Field>
            <Field label="Currency" hint="Locked after the first financial transaction.">
              <select value={values.currency} onChange={(e) => change('currency', e.target.value)}>
                {['PHP', 'USD', 'EUR', 'GBP', 'SGD'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Logo image URL" full>
              <input
                type="url"
                value={values.logo_url}
                maxLength={2000}
                onChange={(e) => change('logo_url', e.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Store timezone" full>
              <select value={values.timezone} onChange={(e) => change('timezone', e.target.value)}>
                {[
                  ...new Set([
                    values.timezone,
                    'Asia/Manila',
                    'Asia/Taipei',
                    'Asia/Singapore',
                    'America/New_York',
                    'Europe/London',
                    'UTC',
                  ]),
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="settings-section-title">
              <span>
                <ReceiptText size={21} />
              </span>
              <div>
                <h2>Tax & receipts</h2>
                <p>Set how totals appear at checkout.</p>
              </div>
            </div>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <Field label="Tax rate (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step=".01"
                  required
                  value={values.tax_rate}
                  onChange={(e) => change('tax_rate', e.target.value)}
                />
              </Field>
              <Field label="Tax calculation">
                <select
                  value={values.tax_inclusive ? 'included' : 'added'}
                  onChange={(e) => change('tax_inclusive', e.target.value === 'included')}
                >
                  <option value="added">Add tax to prices</option>
                  <option value="included">Prices include tax</option>
                </select>
              </Field>
            </div>
            <Field label="Receipt footer">
              <textarea
                value={values.receipt_footer}
                maxLength={500}
                onChange={(e) => change('receipt_footer', e.target.value)}
              />
            </Field>
            <div className="mini-receipt">
              <span>{values.name || 'Your store'}</span>
              <p>{values.receipt_footer}</p>
              <small>Your receipt footer preview</small>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="settings-section-title">
              <span>
                <CreditCard size={21} />
              </span>
              <div>
                <h2>Payment methods</h2>
                <p>Choose the payments your store accepts.</p>
              </div>
            </div>
          </div>
          <div className="modal-body">
            <Field
              label="Enabled payment methods"
              hint="Separate methods with commas. Use “Cash” for cash and change calculation."
            >
              <textarea value={payments} required onChange={(e) => setPayments(e.target.value)} />
            </Field>
            <div className="payment-tags">
              {payments
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((p, i) => (
                  <span key={`${p}-${i}`}>{p}</span>
                ))}
            </div>
            <p className="muted">
              Wallet and bank methods record payments received outside this application.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="settings-section-title">
              <span>
                <ShieldCheck size={21} />
              </span>
              <div>
                <h2>Store preferences</h2>
                <p>A few defaults to keep things running smoothly.</p>
              </div>
            </div>
          </div>
          <div className="modal-body form-grid">
            <Field
              label="Low-stock threshold"
              hint="Used when a product has no individual minimum."
            >
              <input
                type="number"
                min="0"
                max="100000"
                required
                value={values.low_stock_threshold}
                onChange={(e) => change('low_stock_threshold', e.target.value)}
              />
            </Field>
            <Field label="Cashier discount limit (%)">
              <input
                type="number"
                min="0"
                max="100"
                step=".5"
                required
                value={values.cashier_discount_limit}
                onChange={(e) => change('cashier_discount_limit', e.target.value)}
              />
            </Field>
            <Field label="Customer loyalty" full>
              <span className="check-field">
                <input
                  type="checkbox"
                  checked={values.loyalty_enabled}
                  onChange={(e) => change('loyalty_enabled', e.target.checked)}
                />
                Earn one point per 100 currency units spent
              </span>
            </Field>
          </div>
        </section>
        {error && (
          <div className="full">
            <ErrorState message={error} />
          </div>
        )}
      </form>
      <section className="panel discount-settings">
        <div className="panel-header">
          <div className="settings-section-title">
            <span>
              <Percent size={21} />
            </span>
            <div>
              <h2>Discount presets</h2>
              <p>Quick discounts available at the register.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setDiscount({})}>
            <Plus size={16} />
            Add discount
          </Button>
        </div>
        <div className="modal-body">
          {data.discounts.map((d) => (
            <div className="list-row" key={d.id}>
              <strong>{d.name}</strong>
              <span>{Number(d.percent)}%</span>
              <Badge tone={d.active ? 'green' : 'gray'}>{d.active ? 'Active' : 'Disabled'}</Badge>
              <button
                className="icon-button"
                aria-label={`Edit ${d.name}`}
                onClick={() => setDiscount(d)}
              >
                <Pencil size={16} />
              </button>
            </div>
          ))}
          {!data.discounts.length && (
            <p className="muted">
              Add your first preset. Custom authorized discounts are also available at checkout.
            </p>
          )}
        </div>
      </section>
      {discount && (
        <EntityForm
          title="Discount"
          entity="discounts"
          record={discount}
          fields={[
            { key: 'name', label: 'Discount name', required: true },
            {
              key: 'percent',
              label: 'Discount (%)',
              type: 'number',
              required: true,
              min: 0,
              max: 100,
              step: '.5',
              default: 5,
            },
            { key: 'active', label: 'Status', type: 'checkbox', default: true },
          ]}
          onClose={() => setDiscount(null)}
        />
      )}
    </>
  );
}
