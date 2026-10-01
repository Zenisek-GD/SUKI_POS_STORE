import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import { dateTime } from '../lib/api';
import { Modal, Field, Button, Table, Loading, ErrorState } from './ui';
import './storeOperations.css';

import { movementLabels } from '../lib/inventory';

export default function InventoryHistory({ product, onClose }) {
  const { data } = useStore();
  const [filters, setFilters] = useState({ from: '', to: '', type: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), page_size: '10' });
  Object.entries(applied).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const resource = useResource(`/inventory/products/${product.id}/movements?${query}`);
  const result = resource.data;
  const current = result?.product || product;
  const pages = Math.max(1, Math.ceil((result?.total || 0) / 10));
  return (
    <Modal
      title={`${product.name} stock history`}
      subtitle={`SKU: ${product.sku}${product.barcode ? ` · Barcode: ${product.barcode}` : ''}`}
      onClose={onClose}
      wide
      className="operations-modal"
    >
      <div className="modal-body stock-history">
        <div className="operation-summary">
          <div>
            <small>Available stock</small>
            <strong>
              {current.stock} {current.unit}
            </strong>
          </div>
          <div>
            <small>Non-sellable stock</small>
            <strong>
              {current.non_sellable_stock || 0} {current.unit}
            </strong>
          </div>
          <div>
            <small>Internal code</small>
            <strong>{current.product_code || '—'}</strong>
          </div>
        </div>
        <form
          className="operation-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ ...filters });
            setPage(1);
          }}
        >
          <Field label="Movement start date">
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="Movement end date">
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </Field>
          <Field label="History movement type">
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="">All movements</option>
              {Object.entries(movementLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">Apply filters</Button>
        </form>
        <p className="muted">
          Balances show available stock after each recorded movement, even when earlier entries are
          filtered out. Dates use {data.settings.timezone}.
        </p>
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <>
            <Table
              rows={result?.rows || []}
              pagination={false}
              emptyText="No stock movements match this product and the selected filters."
              columns={[
                {
                  key: 'created_at',
                  label: 'Date & time',
                  render: (m) => dateTime(m.created_at, data.settings.timezone),
                },
                { key: 'type', label: 'Movement', render: (m) => movementLabels[m.type] || m.type },
                {
                  key: 'quantity_in',
                  label: 'Quantity in',
                  render: (m) => <span className="text-green">{m.quantity_in || '—'}</span>,
                },
                {
                  key: 'quantity_out',
                  label: 'Quantity out',
                  render: (m) => <span className="text-danger">{m.quantity_out || '—'}</span>,
                },
                {
                  key: 'balance_after',
                  label: 'Available balance',
                  render: (m) => <strong>{m.balance_after}</strong>,
                },
                {
                  key: 'non_sellable_quantity',
                  label: 'Non-sellable in',
                  render: (m) => m.non_sellable_quantity || '—',
                },
                { key: 'reference', label: 'Reference' },
                { key: 'user_name', label: 'Operator' },
                { key: 'reason', label: 'Reason / notes' },
              ]}
            />
            <div className="table-footer">
              <span>{result?.total || 0} movements · latest recorded first</span>
              <div>
                <button
                  aria-label="Previous movement page"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  Page {page} of {pages}
                </span>
                <button
                  aria-label="Next movement page"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <footer>
        <Button onClick={onClose}>Done</Button>
      </footer>
    </Modal>
  );
}
