import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, Boxes, TriangleAlert, PackageX, Warehouse } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import { api, cash, dateTime, downloadCSV, titleCase } from '../lib/api';
import {
  PageHeader,
  Button,
  SearchBox,
  Table,
  Badge,
  ProductAvatar,
  Modal,
  Field,
  ErrorState,
  Loading,
} from '../components/ui';
import { Metric } from './Dashboard';
import InventoryHistory from '../components/InventoryHistory';
import { movementLabels } from '../lib/inventory';
export default function Inventory() {
  const { data, refresh, notify } = useStore(),
    [params] = useSearchParams(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(params.get('status') || 'all'),
    [tab, setTab] = useState('stock'),
    [adjust, setAdjust] = useState(null),
    [history, setHistory] = useState(null);
  const movements = useResource('/inventory/movements'),
    products = data.products.filter((p) => p.active),
    threshold = (p) => p.min_stock ?? data.settings.low_stock_threshold;
  const low = products.filter((p) => p.stock > 0 && p.stock <= threshold(p)).length,
    out = products.filter((p) => !p.stock).length;
  const filtered = products.filter(
    (p) =>
      [p.name, p.sku, p.barcode, p.product_code].some((v) =>
        v?.toLowerCase().includes(search.toLowerCase()),
      ) &&
      (status === 'all' || (status === 'low' ? p.stock <= threshold(p) : p.stock === 0)),
  );
  const moveRows = (movements.data || []).filter((m) =>
    [m.product, m.reason, m.user_name].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  return (
    <>
      <PageHeader
        eyebrow="A PLACE FOR EVERYTHING"
        title="Inventory"
        description="Keep the right products on the shelf, at the right time."
      >
        <Button
          variant="secondary"
          onClick={() =>
            downloadCSV(
              `inventory-${tab}`,
              tab === 'stock'
                ? filtered.map((p) => ({
                    name: p.name,
                    sku: p.sku,
                    stock: p.stock,
                    minimum: threshold(p),
                    unit: p.unit,
                  }))
                : moveRows,
            )
          }
        >
          <Download size={16} />
          Export
        </Button>
        <Button onClick={() => setAdjust({})}>
          <Plus size={18} />
          Adjust stock
        </Button>
      </PageHeader>
      <div className="metrics-grid">
        <Metric
          label="Total products"
          value={products.length}
          detail="Active products in your catalog"
          icon={Boxes}
        />
        <Metric
          label="Low stock"
          value={low}
          detail="Time to reorder these products"
          icon={TriangleAlert}
          tone="amber"
        />
        <Metric
          label="Out of stock"
          value={out}
          detail="Currently unavailable for sale"
          icon={PackageX}
        />
        <Metric
          label="Inventory value"
          value={cash(
            products.reduce((sum, p) => sum + p.stock * p.cost_price, 0),
            data.settings.currency,
          )}
          detail="At current product cost"
          icon={Warehouse}
        />
      </div>
      <section className="panel">
        <div className="section-tabs">
          <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>
            Stock overview
          </button>
          <button
            className={tab === 'movements' ? 'active' : ''}
            onClick={() => setTab('movements')}
          >
            Stock movements
          </button>
        </div>
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search inventory" />
          {tab === 'stock' && (
            <select
              aria-label="Stock status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All stock levels</option>
              <option value="low">Needs restocking</option>
              <option value="out">Out of stock</option>
            </select>
          )}
        </div>
        {tab === 'stock' ? (
          <Table
            rows={filtered}
            onRowClick={setHistory}
            columns={[
              {
                key: 'name',
                label: 'Product',
                render: (p) => (
                  <div className="product-cell">
                    <ProductAvatar product={p} />
                    <div>
                      <strong>{p.name}</strong>
                      <small>{p.sku}</small>
                    </div>
                  </div>
                ),
              },
              {
                key: 'stock',
                label: 'In stock',
                render: (p) => (
                  <strong>
                    {p.stock} {p.unit}
                  </strong>
                ),
              },
              { key: 'minimum', label: 'Minimum level', render: (p) => threshold(p) },
              {
                key: 'non_sellable_stock',
                label: 'Non-sellable',
                render: (p) => p.non_sellable_stock || 0,
              },
              { key: 'supplier', label: 'Supplier' },
              {
                key: 'status',
                label: 'Stock status',
                render: (p) => (
                  <Badge tone={!p.stock ? 'red' : p.stock <= threshold(p) ? 'amber' : 'green'}>
                    {!p.stock ? 'Out of stock' : p.stock <= threshold(p) ? 'Low stock' : 'In stock'}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                label: '',
                render: (p) => (
                  <button
                    className="text-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAdjust(p);
                    }}
                  >
                    Adjust
                    <Plus size={14} />
                  </button>
                ),
              },
            ]}
          />
        ) : movements.loading ? (
          <Loading />
        ) : movements.error ? (
          <ErrorState message={movements.error} retry={movements.reload} />
        ) : (
          <Table
            rows={moveRows}
            columns={[
              { key: 'product', label: 'Product' },
              {
                key: 'type',
                label: 'Type',
                render: (m) => (
                  <span className="category-chip">
                    {movementLabels[m.type] || titleCase(m.type)}
                  </span>
                ),
              },
              { key: 'previous_quantity', label: 'Before' },
              {
                key: 'quantity',
                label: 'Change',
                render: (m) => (
                  <strong className={m.quantity > 0 ? 'text-green' : 'text-danger'}>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity}
                  </strong>
                ),
              },
              { key: 'new_quantity', label: 'After' },
              { key: 'reason', label: 'Reason' },
              { key: 'user_name', label: 'By' },
              {
                key: 'created_at',
                label: 'Date',
                render: (m) => dateTime(m.created_at, data.settings.timezone),
              },
            ]}
          />
        )}
      </section>
      <p className="page-note">
        Select a product row to view its stock history. Non-sellable stock is kept separate from
        available inventory.
      </p>
      {history && <InventoryHistory product={history} onClose={() => setHistory(null)} />}
      {adjust && (
        <StockForm
          products={products}
          initial={adjust}
          onClose={() => setAdjust(null)}
          onSave={async (body) => {
            await api('/inventory/adjust', { method: 'POST', body });
            await refresh();
            movements.reload();
            notify('Stock updated and movement recorded');
          }}
        />
      )}
    </>
  );
}
function StockForm({ products, initial, onClose, onSave }) {
  const [product, setProduct] = useState(initial.id || ''),
    [type, setType] = useState('stock_in'),
    [direction, setDirection] = useState('add'),
    [qty, setQty] = useState('1'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const selected = products.find((p) => p.id === product),
    negative =
      ['stock_out', 'damaged'].includes(type) || (type === 'adjustment' && direction === 'remove');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({ product_id: product, type, direction, quantity: Number(qty), reason });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Adjust inventory"
      subtitle="Every stock change is recorded for your store."
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="Product" full>
            <select required value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">Select a product</option>
              {products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {p.stock} in stock
                </option>
              ))}
            </select>
          </Field>
          <Field label="Movement type">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {['stock_in', 'stock_out', 'adjustment', 'damaged'].map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          {type === 'adjustment' && (
            <Field label="Direction">
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="add">Add stock</option>
                <option value="remove">Remove stock</option>
              </select>
            </Field>
          )}
          <Field label="Reason" full>
            <textarea
              required
              minLength={3}
              maxLength={250}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Restocked from supplier, damaged packaging…"
            />
          </Field>
          {selected && (
            <div className="info-note full">
              Stock will change from <b>{selected.stock}</b> to{' '}
              <b>{selected.stock + (negative ? -1 : 1) * Number(qty)}</b> {selected.unit}.
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
          <Button loading={busy}>Save stock change</Button>
        </footer>
      </form>
    </Modal>
  );
}
