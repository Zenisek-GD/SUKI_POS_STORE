import { useState } from 'react';
import { api, dateTime } from '../lib/api';
import { useStore } from '../lib/storeContext';
import { Modal, Field, Button, ErrorState } from './ui';
export default function EntityForm({ title, entity, record, fields, onClose, onSaved }) {
  const { refresh, notify } = useStore();
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        record?.[f.key] !== undefined
          ? f.type === 'money'
            ? Number(record[f.key]) / 100
            : record[f.key]
          : (f.default ?? (f.type === 'checkbox' ? false : '')),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {};
      for (const f of fields) {
        let value = values[f.key];
        if (f.type === 'password' && !value) continue;
        if (f.type === 'money') value = Math.round(Number(value) * 100);
        else if (f.type === 'number') value = value === '' && f.nullable ? null : Number(value);
        else if (f.nullable && value === '') value = null;
        body[f.key] = value;
      }
      const result = await api(`/${entity}${record?.id ? `/${record.id}` : ''}`, {
        method: record?.id ? 'PUT' : 'POST',
        body,
      });
      await refresh();
      notify(`${title} saved`);
      onSaved?.(result);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={record?.id ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={save}>
        <div className="modal-body form-grid">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} full={f.full}>
              {f.options ? (
                <select
                  value={values[f.key] ?? ''}
                  required={f.required}
                  onChange={(e) => change(f.key, e.target.value)}
                >
                  {f.nullable && <option value="">None</option>}
                  {!f.nullable && (
                    <option value="" disabled>
                      Select {f.label.toLowerCase()}
                    </option>
                  )}
                  {f.options.map((o) => (
                    <option key={o.value ?? o} value={o.value ?? o}>
                      {o.label ?? o}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.key]}
                  required={f.required}
                  maxLength={f.maxLength || 2000}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              ) : f.type === 'checkbox' ? (
                <span className="check-field">
                  <input
                    type="checkbox"
                    checked={Boolean(values[f.key])}
                    onChange={(e) => change(f.key, e.target.checked)}
                  />
                  {f.checkLabel || 'Enabled'}
                </span>
              ) : (
                <input
                  type={f.type === 'money' ? 'number' : f.type || 'text'}
                  value={values[f.key] ?? ''}
                  min={f.min ?? (['number', 'money'].includes(f.type) ? 0 : undefined)}
                  max={f.max}
                  step={f.type === 'money' ? '.01' : f.step || '1'}
                  minLength={f.type === 'password' ? 12 : f.minLength}
                  maxLength={f.type === 'password' ? 72 : f.maxLength || 250}
                  required={f.required}
                  placeholder={f.placeholder}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              )}
            </Field>
          ))}
          {record?.created_at && (
            <div className="record-dates full">
              <span>Created {dateTime(record.created_at)}</span>
              {record.updated_at && <span>Updated {dateTime(record.updated_at)}</span>}
            </div>
          )}
          {error && (
            <div className="full">
              <ErrorState message={error} />
            </div>
          )}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy}>Save {title.toLowerCase()}</Button>
        </footer>
      </form>
    </Modal>
  );
}
