import { useEffect, useRef, useState, useId, cloneElement, isValidElement } from 'react';
import { X, Search, ChevronLeft, ChevronRight, PackageOpen, LoaderCircle } from 'lucide-react';
import { titleCase } from '../lib/api';
export function Button({ children, variant = '', className = '', loading = false, ...props }) {
  return (
    <button
      className={`btn ${variant} ${className}`}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export const Badge = ({ children, tone = 'green' }) => (
  <span className={`badge ${tone}`}>
    <i />
    {children}
  </span>
);
export function Field({ label, children, hint, full = false }) {
  const id = useId();
  const native =
    isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type);
  return (
    <label className={`field ${full ? 'full' : ''}`} htmlFor={native ? id : undefined}>
      <span>{label}</span>
      {native
        ? cloneElement(children, { id, 'aria-label': children.props['aria-label'] || label })
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchBox({ value, onChange, placeholder = 'Search...', ...props }) {
  return (
    <div className="search-box">
      <Search size={18} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export const Empty = ({
  title = 'Nothing here yet',
  text = 'Add your first record to get started.',
  action,
}) => (
  <div className="empty">
    <div>
      <PackageOpen size={30} />
    </div>
    <h3>{title}</h3>
    <p>{text}</p>
    {action}
  </div>
);
export const Loading = () => (
  <div className="loading" role="status">
    <LoaderCircle className="spin" size={26} />
    <span>Loading your store…</span>
  </div>
);
export const ErrorState = ({ message, retry }) => (
  <div className="error-state" role="alert">
    <p>{message}</p>
    {retry && (
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    )}
  </div>
);
export function PageHeader({ title, children }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function ProductAvatar({ product, size = '' }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`product-avatar ${size}`}
      style={{ background: product.category_color ? `${product.category_color}16` : undefined }}
    >
      {product.image_url && !failed ? (
        <img src={product.image_url} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{product.emoji || '📦'}</span>
      )}
    </span>
  );
}
export function Modal({ title, subtitle, children, onClose, wide = false, className = '' }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const old = document.activeElement,
      node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      old?.focus?.();
    };
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''} ${className}`}
      aria-labelledby={titleId}
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  action = 'Confirm',
  onConfirm,
  onClose,
  danger = false,
  reason = false,
}) {
  const [busy, setBusy] = useState(false),
    [text, setText] = useState(''),
    [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(text);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">{description}</p>
          {reason && (
            <Field label="Reason">
              <textarea
                required
                minLength={3}
                maxLength={250}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Explain why this action is needed"
              />
            </Field>
          )}
          {error && <ErrorState message={error} />}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Go back
          </Button>
          <Button variant={danger ? 'danger' : ''} loading={busy}>
            {action}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function Table({
  columns,
  rows,
  emptyText = 'No records match your filters.',
  pageSize = 10,
  onRowClick,
  pagination = true,
}) {
  const [page, setPage] = useState(1),
    pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    current = Math.min(page, pages),
    start = (current - 1) * pageSize;
  return (
    <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable records">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.className}>
                  {c.label || titleCase(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(pagination ? rows.slice(start, start + pageSize) : rows).map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? 'clickable' : ''}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (
                    onRowClick &&
                    event.target === event.currentTarget &&
                    ['Enter', ' '].includes(event.key)
                  ) {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty title="No records found" text={emptyText} />}
      {pagination && (
        <div className="table-footer">
          <span>
            {rows.length
              ? `${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length}`
              : '0 records'}
          </span>
          <div>
            <button
              aria-label="Previous page"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Page {current} of {pages}
            </span>
            <button
              aria-label="Next page"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
