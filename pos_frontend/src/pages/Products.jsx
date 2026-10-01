import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, Pencil, Archive, Tags, Package } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { api, cash, downloadCSV, dateTime } from '../lib/api';
import {
  PageHeader,
  Button,
  SearchBox,
  Table,
  Badge,
  ProductAvatar,
  Confirm,
  Modal,
} from '../components/ui';
import EntityForm from '../components/EntityForm';
function productFields(data, editing = false) {
  return [
    { key: 'name', label: 'Product name', required: true, full: true },
    { key: 'sku', label: 'SKU', required: true },
    { key: 'barcode', label: 'Barcode', nullable: true },
    {
      key: 'category_id',
      label: 'Category',
      nullable: true,
      options: data.categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: 'supplier_id',
      label: 'Supplier',
      nullable: true,
      options: data.suppliers?.map((s) => ({ value: s.id, label: s.name })) || [],
    },
    { key: 'cost_price', label: 'Cost price', type: 'money', required: true, default: 0 },
    { key: 'price', label: 'Selling price', type: 'money', required: true, default: 0 },
    ...(!editing ? [{ key: 'stock', label: 'Opening stock', type: 'number', default: 0 }] : []),
    {
      key: 'min_stock',
      label: 'Minimum stock',
      type: 'number',
      nullable: true,
      hint: 'Leave blank to use the store threshold.',
    },
    { key: 'unit', label: 'Unit', default: 'pcs', required: true },
    { key: 'emoji', label: 'Product symbol', default: '📦', maxLength: 16 },
    { key: 'image_url', label: 'Product image URL', type: 'url', full: true, maxLength: 2000 },
    { key: 'description', label: 'Description', type: 'textarea', full: true },
    {
      key: 'active',
      label: 'Product status',
      type: 'checkbox',
      default: true,
      checkLabel: 'Active and available for sale',
    },
  ];
}
export default function Products() {
  const { data, user, refresh, notify } = useStore(),
    [params] = useSearchParams(),
    [search, setSearch] = useState(params.get('q') || ''),
    [category, setCategory] = useState('all'),
    [status, setStatus] = useState('active'),
    [edit, setEdit] = useState(null),
    [archive, setArchive] = useState(null),
    [categories, setCategories] = useState(false),
    [categoryEdit, setCategoryEdit] = useState(null);
  const rows = data.products.filter(
    (p) =>
      (status === 'all' || p.active === (status === 'active')) &&
      (category === 'all' || p.category_id === category) &&
      [p.name, p.sku, p.product_code, p.barcode].some((v) =>
        v?.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const m = (v) => cash(v, data.settings.currency);
  const columns = [
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
      key: 'product_code',
      label: 'Product code',
      render: (p) => (
        <details className="record-code">
          <summary aria-label={`Product code for ${p.name}`}>View code</summary>
          <code>{p.product_code}</code>
        </details>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (p) => <span className="category-chip">{p.category || 'Uncategorized'}</span>,
    },
    { key: 'price', label: 'Selling price', render: (p) => <strong>{m(p.price)}</strong> },
    { key: 'cost_price', label: 'Cost', render: (p) => m(p.cost_price) },
    {
      key: 'stock',
      label: 'Stock',
      render: (p) => (
        <span
          className={
            p.stock <= (p.min_stock ?? data.settings.low_stock_threshold) ? 'text-amber' : ''
          }
        >
          {p.stock} <small>{p.unit}</small>
        </span>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      render: (p) => (
        <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'Active' : 'Archived'}</Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (p) => (
        <div className="row-actions">
          <button title={`Edit ${p.name}`} aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}>
            <Pencil size={16} />
          </button>
          {p.active && user.role !== 'inventory' && (
            <button
              title="Archive product"
              aria-label={`Archive ${p.name}`}
              onClick={() => setArchive(p)}
            >
              <Archive size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="YOUR STORE CATALOG"
        title="Products"
        description="Everything on your shelves, organized in one place."
      >
        <Button
          variant="secondary"
          onClick={() =>
            downloadCSV(
              'products',
              rows.map((p) => ({
                name: p.name,
                sku: p.sku,
                product_code: p.product_code,
                barcode: p.barcode,
                category: p.category,
                cost_price: (p.cost_price / 100).toFixed(2),
                selling_price: (p.price / 100).toFixed(2),
                stock: p.stock,
                unit: p.unit,
                status: p.active ? 'active' : 'archived',
              })),
            )
          }
          disabled={!rows.length}
        >
          <Download size={16} />
          Export
        </Button>
        <Button onClick={() => setEdit({})}>
          <Plus size={18} />
          Add product
        </Button>
      </PageHeader>
      <div className="inline-stats">
        <span>
          <Package size={17} />
          <strong>{data.products.filter((p) => p.active).length}</strong>active products
        </span>
        <span>
          <Tags size={17} />
          <strong>{data.categories.length}</strong>categories
        </span>
        <button onClick={() => setCategories(true)}>
          Manage categories
          <ArrowSmall />
        </button>
      </div>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search products, SKU, or barcode"
          />
          <div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter category"
            >
              <option value="all">All categories</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Product status"
            >
              <option value="active">Active products</option>
              <option value="archived">Archived</option>
              <option value="all">All statuses</option>
            </select>
          </div>
        </div>
        <Table
          rows={rows}
          columns={columns}
          mobileColumns={['category', 'price', 'stock', 'active']}
        />
      </section>
      {edit && (
        <EntityForm
          title="Product"
          entity="products"
          record={edit}
          fields={productFields(data, Boolean(edit.id))}
          onClose={() => setEdit(null)}
        />
      )}{' '}
      {archive && (
        <Confirm
          title={`Archive ${archive.name}?`}
          description="This product will be removed from checkout. Its transaction history and stock records will be kept."
          action="Archive product"
          danger
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api(`/products/${archive.id}`, { method: 'DELETE' });
            await refresh();
            notify('Product archived');
          }}
        />
      )}
      {categories && (
        <Modal
          title="Product categories"
          subtitle="Keep your products easy to find."
          onClose={() => setCategories(false)}
        >
          <div className="modal-body">
            {data.categories.map((c) => (
              <div className="list-row" key={c.id}>
                <span className="color-dot" style={{ background: c.color }} />
                <strong>{c.name}</strong>
                <span>
                  {data.products.filter((p) => p.category_id === c.id && p.active).length} products
                </span>
                <button
                  className="icon-button"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => {
                    setCategories(false);
                    setCategoryEdit(c);
                  }}
                >
                  <Pencil size={16} />
                </button>
              </div>
            ))}
          </div>
          <footer>
            <Button
              onClick={() => {
                setCategories(false);
                setCategoryEdit({});
              }}
            >
              <Plus size={16} />
              Add category
            </Button>
          </footer>
        </Modal>
      )}
      {categoryEdit && (
        <EntityForm
          title="Category"
          entity="categories"
          record={categoryEdit}
          fields={[
            { key: 'name', label: 'Category name', required: true },
            { key: 'color', label: 'Category color', type: 'color', default: '#47705c' },
          ]}
          onClose={() => setCategoryEdit(null)}
        />
      )}
      <p className="page-note">
        Each product receives a unique product code automatically. Enter that code at checkout when
        no barcode is available. Stock changes are recorded in Inventory.
      </p>
      {edit?.id && <span className="sr-only">Last updated {dateTime(edit.updated_at)}</span>}
    </>
  );
}
function ArrowSmall() {
  return <span>↗</span>;
}
