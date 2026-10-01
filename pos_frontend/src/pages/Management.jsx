import { useState } from 'react';
import {
  Plus,
  Download,
  Pencil,
  Users,
  Truck,
  Wallet,
  Check,
  Eye,
  UserRoundCog,
  ShieldCheck,
  KeyRound,
  Trash2,
} from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import { api, cash, dateTime, localDate, titleCase, downloadCSV } from '../lib/api';
import {
  PageHeader,
  Button,
  SearchBox,
  Table,
  Badge,
  Modal,
  Field,
  ErrorState,
  Loading,
  Confirm,
  ProductAvatar,
  Empty,
} from '../components/ui';
import EntityForm from '../components/EntityForm';
import Receipt from '../components/Receipt';
import './Management.css';
const personFields = (entity) => [
  {
    key: 'name',
    label: entity === 'suppliers' ? 'Supplier name' : 'Customer name',
    required: true,
    full: true,
  },
  ...(entity === 'suppliers'
    ? [{ key: 'contact_person', label: 'Contact person', full: true }]
    : []),
  { key: 'phone', label: 'Contact number', type: 'tel' },
  { key: 'email', label: 'Email address', type: 'email' },
  { key: 'address', label: 'Address', type: 'textarea', maxLength: 500, full: true },
];
export function People({ entity }) {
  const { data } = useStore(),
    [search, setSearch] = useState(''),
    [edit, setEdit] = useState(null),
    [detail, setDetail] = useState(null),
    customer = entity === 'customers',
    name = customer ? 'Customer' : 'Supplier';
  const rows = (data[entity] || []).filter((p) =>
    [p.name, p.phone, p.email, p.contact_person].some((v) =>
      v?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow={customer ? 'FAMILIAR FACES, LASTING CONNECTIONS' : 'BETTER TOGETHER'}
        title={customer ? 'Customers' : 'Suppliers'}
        description={
          customer
            ? 'Get to know the people who keep coming back.'
            : 'The people who keep your shelves filled.'
        }
      >
        <Button
          variant="secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              entity,
              rows.map((p) => ({
                name: p.name,
                phone: p.phone,
                email: p.email,
                address: p.address,
                ...(customer
                  ? { visits: p.visits, loyalty_points: p.loyalty_points }
                  : { contact_person: p.contact_person }),
              })),
            )
          }
        >
          <Download size={16} />
          Export
        </Button>
        <Button onClick={() => setEdit({})}>
          <Plus size={18} />
          Add {name.toLowerCase()}
        </Button>
      </PageHeader>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder={`Search ${entity}`} />
          <span className="management-record-count">
            {customer ? <Users size={16} /> : <Truck size={16} />}
            {rows.length} {entity}
          </span>
        </div>
        <Table
          rows={rows}
          mobileColumns={customer ? ['phone', 'total_spent'] : ['phone', 'product_count']}
          columns={[
            {
              key: 'name',
              label: name,
              render: (p) => (
                <button className="person-cell" onClick={() => setDetail(p)}>
                  <span className="person-avatar">
                    {p.name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>{customer ? p.email : p.contact_person || p.email}</small>
                  </div>
                </button>
              ),
            },
            { key: 'phone', label: 'Contact number', render: (p) => p.phone || '—' },
            { key: 'email', label: 'Email', render: (p) => p.email || '—' },
            ...(customer
              ? [
                  { key: 'visits', label: 'Visits' },
                  {
                    key: 'total_spent',
                    label: 'Total spent',
                    render: (p) => cash(p.total_spent, data.settings.currency),
                  },
                  ...(data.settings.loyalty_enabled
                    ? [
                        {
                          key: 'loyalty_points',
                          label: 'Loyalty points',
                          render: (p) => <span className="points">✧ {p.loyalty_points}</span>,
                        },
                      ]
                    : []),
                ]
              : [{ key: 'product_count', label: 'Products supplied' }]),
            {
              key: 'actions',
              label: '',
              render: (p) => (
                <div className="row-actions">
                  <button aria-label={`View ${p.name}`} onClick={() => setDetail(p)}>
                    <Eye size={16} />
                  </button>
                  <button aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}>
                    <Pencil size={16} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </section>
      {edit && (
        <EntityForm
          title={name}
          entity={entity}
          record={edit}
          fields={personFields(entity)}
          onClose={() => setEdit(null)}
        />
      )}{' '}
      {detail &&
        (customer ? (
          <CustomerHistory customer={detail} onClose={() => setDetail(null)} />
        ) : (
          <Modal
            title={detail.name}
            subtitle={detail.contact_person}
            onClose={() => setDetail(null)}
          >
            <div className="modal-body">
              <div className="contact-summary">
                <p>{detail.phone || 'No phone number'}</p>
                <p>{detail.email || 'No email address'}</p>
                <p>{detail.address || 'No address'}</p>
              </div>
              <h3>Products supplied</h3>
              {data.products
                .filter((p) => p.supplier_id === detail.id)
                .map((p) => (
                  <div className="list-row" key={p.id}>
                    <ProductAvatar product={p} />
                    <strong>{p.name}</strong>
                    <span>{p.stock} in stock</span>
                  </div>
                ))}
              {!data.products.some((p) => p.supplier_id === detail.id) && (
                <Empty
                  title="No products linked"
                  text="Choose this supplier when adding or editing a product."
                />
              )}
            </div>
            <footer>
              <Button onClick={() => setDetail(null)}>Done</Button>
            </footer>
          </Modal>
        ))}
    </>
  );
}
function CustomerHistory({ customer, onClose }) {
  const resource = useResource(`/sales?customer_id=${customer.id}`),
    { data, notify } = useStore(),
    [receipt, setReceipt] = useState(null);
  if (receipt) return <Receipt sale={receipt} onClose={() => setReceipt(null)} />;
  return (
    <Modal title={customer.name} subtitle="Purchase history" onClose={onClose} wide>
      <div className="modal-body">
        <div className="contact-summary">
          <span>{customer.phone || 'No contact number'}</span>
          <span>{customer.email}</span>
          <span>{customer.address}</span>
        </div>
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <Table
            rows={resource.data || []}
            columns={[
              {
                key: 'number',
                label: 'Receipt',
                render: (s) => (
                  <button
                    className="transaction-number"
                    onClick={async () => {
                      try {
                        setReceipt(await api(`/sales/${s.id}`));
                      } catch (e) {
                        notify(e.message, 'error');
                      }
                    }}
                  >
                    {s.number}
                  </button>
                ),
              },
              {
                key: 'created_at',
                label: 'Date',
                render: (s) => dateTime(s.created_at, data.settings.timezone),
              },
              {
                key: 'total',
                label: 'Total',
                render: (s) => cash(s.total, data.settings.currency),
              },
              { key: 'status', label: 'Status' },
            ]}
          />
        )}
      </div>
    </Modal>
  );
}
export function Expenses() {
  const { data } = useStore(),
    [search, setSearch] = useState(''),
    [edit, setEdit] = useState(null),
    [category, setCategory] = useState('all');
  const categories = [
    'Electricity',
    'Water',
    'Rent',
    'Transportation',
    'Salaries',
    'Supplies',
    'Maintenance',
    'Other',
  ];
  const rows = (data.expenses || []).filter(
    (e) =>
      e.description.toLowerCase().includes(search.toLowerCase()) &&
      (category === 'all' || e.category === category),
  );
  const fields = [
    { key: 'description', label: 'Description', required: true, full: true },
    { key: 'category', label: 'Category', required: true, options: categories, default: 'Other' },
    { key: 'amount', label: 'Amount', type: 'money', min: 0.01, required: true },
    {
      key: 'expense_date',
      label: 'Expense date',
      type: 'date',
      required: true,
      default: localDate(new Date(), data.settings.timezone),
    },
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 250, full: true },
  ];
  return (
    <>
      <PageHeader
        eyebrow="THE COST OF DOING BUSINESS"
        title="Expenses"
        description="Track everyday spending and keep a clear view of your profit."
      >
        <Button
          variant="secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              'expenses',
              rows.map((e) => ({
                description: e.description,
                category: e.category,
                date: e.expense_date,
                amount: (e.amount / 100).toFixed(2),
                recorded_by: e.created_by,
              })),
            )
          }
        >
          <Download size={16} />
          Export
        </Button>
        <Button onClick={() => setEdit({})}>
          <Plus size={18} />
          Record expense
        </Button>
      </PageHeader>
      <div className="expense-total management-expense-total">
        <span className="expense-icon">
          <Wallet size={24} />
        </span>
        <div>
          <span>Total expenses in this view</span>
          <strong>
            {cash(
              rows.reduce((s, e) => s + e.amount, 0),
              data.settings.currency,
            )}
          </strong>
        </div>
        <span>{rows.length} records</span>
      </div>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search expenses" />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Expense category"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <Table
          rows={rows}
          mobileColumns={['category', 'expense_date', 'amount']}
          columns={[
            {
              key: 'description',
              label: 'Expense',
              render: (e) => <strong>{e.description}</strong>,
            },
            {
              key: 'category',
              label: 'Category',
              render: (e) => <span className="category-chip">{e.category}</span>,
            },
            {
              key: 'expense_date',
              label: 'Date',
              render: (e) => String(e.expense_date).slice(0, 10),
            },
            { key: 'created_by', label: 'Recorded by' },
            {
              key: 'amount',
              label: 'Amount',
              render: (e) => <strong>{cash(e.amount, data.settings.currency)}</strong>,
            },
            {
              key: 'actions',
              label: '',
              render: (e) => (
                <button
                  className="icon-button"
                  aria-label={`Edit ${e.description}`}
                  onClick={() => setEdit(e)}
                >
                  <Pencil size={16} />
                </button>
              ),
            },
          ]}
        />
      </section>
      {edit && (
        <EntityForm
          title="Expense"
          entity="expenses"
          record={edit}
          fields={fields}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
export function Purchases() {
  const { data, user, refresh, notify } = useStore(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [add, setAdd] = useState(false),
    [receive, setReceive] = useState(null),
    [detail, setDetail] = useState(null),
    [payment, setPayment] = useState(null);
  const rows = (data.purchases || []).filter(
    (p) =>
      [p.number, p.supplier].some((v) => v.toLowerCase().includes(search.toLowerCase())) &&
      (status === 'all' || p.receiving_status === status),
  );
  return (
    <>
      <PageHeader
        eyebrow="KEEP GOOD THINGS IN STOCK"
        title="Purchases"
        description="From supplier orders to freshly stocked shelves."
      >
        <Button
          variant="secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              'purchases',
              rows.map((p) => ({
                number: p.number,
                supplier: p.supplier,
                date: p.purchase_date,
                total: (p.total / 100).toFixed(2),
                payment: p.payment_status,
                receiving: p.receiving_status,
              })),
            )
          }
        >
          <Download size={16} />
          Export
        </Button>
        <Button onClick={() => setAdd(true)}>
          <Plus size={18} />
          New purchase
        </Button>
      </PageHeader>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search order or supplier" />
          <select
            aria-label="Receiving status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All orders</option>
            <option value="pending">Awaiting delivery</option>
            <option value="received">Received</option>
          </select>
          <span className="management-record-count">
            <Truck size={16} />
            {data.purchases?.filter((p) => p.receiving_status === 'pending').length || 0} awaiting
            delivery
          </span>
        </div>
        <Table
          rows={rows}
          mobileColumns={['supplier', 'total', 'payment_status', 'receiving_status']}
          columns={[
            {
              key: 'number',
              label: 'Purchase order',
              render: (p) => (
                <button className="transaction-number" onClick={() => setDetail(p)}>
                  {p.number}
                </button>
              ),
            },
            { key: 'supplier', label: 'Supplier' },
            {
              key: 'purchase_date',
              label: 'Date',
              render: (p) => String(p.purchase_date).slice(0, 10),
            },
            {
              key: 'total',
              label: 'Total',
              render: (p) => <strong>{cash(p.total, data.settings.currency)}</strong>,
            },
            {
              key: 'payment_status',
              label: 'Payment',
              render: (p) =>
                user.role === 'inventory' ? (
                  <Badge tone={p.payment_status === 'paid' ? 'green' : 'amber'}>
                    {titleCase(p.payment_status)}
                  </Badge>
                ) : (
                  <button
                    className="badge-button"
                    onClick={() => setPayment(p)}
                    aria-label={`Update payment for ${p.number}`}
                  >
                    <Badge tone={p.payment_status === 'paid' ? 'green' : 'amber'}>
                      {titleCase(p.payment_status)}
                    </Badge>
                    <Pencil size={12} />
                  </button>
                ),
            },
            {
              key: 'receiving_status',
              label: 'Receiving',
              render: (p) => (
                <Badge tone={p.receiving_status === 'received' ? 'green' : 'blue'}>
                  {p.receiving_status === 'received' ? 'Received' : 'Pending'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (p) =>
                p.receiving_status === 'pending' ? (
                  <button className="text-link" onClick={() => setReceive(p)}>
                    Receive
                    <Check size={15} />
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    aria-label={`View ${p.number}`}
                    onClick={() => setDetail(p)}
                  >
                    <Eye size={16} />
                  </button>
                ),
            },
          ]}
        />
      </section>
      {add && <PurchaseForm onClose={() => setAdd(false)} />}{' '}
      {detail && <PurchaseDetail purchase={detail} onClose={() => setDetail(null)} />}{' '}
      {receive && (
        <Confirm
          title="Receive this purchase?"
          description={`${receive.number} from ${receive.supplier}. Confirm that every ordered item has arrived. This adds all quantities to stock and updates their cost prices.`}
          action="Confirm received"
          onClose={() => setReceive(null)}
          onConfirm={async () => {
            await api(`/purchases/${receive.id}/receive`, { method: 'POST' });
            await refresh();
            notify('Purchase received. Inventory updated.');
          }}
        />
      )}
      {payment && <PaymentStatus purchase={payment} onClose={() => setPayment(null)} />}
    </>
  );
}
function PurchaseForm({ onClose }) {
  const { data, refresh, notify } = useStore(),
    [supplier, setSupplier] = useState(''),
    [date, setDate] = useState(localDate(new Date(), data.settings.timezone)),
    [payment, setPayment] = useState('unpaid'),
    [notes, setNotes] = useState(''),
    [items, setItems] = useState([{ product_id: '', quantity: 1, cost_price: 0 }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (index, key, value) =>
    setItems((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [key]: value };
        if (key === 'product_id')
          next.cost_price = (data.products.find((p) => p.id === value)?.cost_price || 0) / 100;
        return next;
      }),
    );
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/purchases', {
        method: 'POST',
        body: {
          supplier_id: supplier,
          purchase_date: date,
          payment_status: payment,
          notes,
          items: items.map((i) => ({
            ...i,
            quantity: Number(i.quantity),
            cost_price: Math.round(Number(i.cost_price) * 100),
          })),
        },
      });
      await refresh();
      notify('Purchase order created');
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New purchase order"
      subtitle="Record an order. Receive it when the products arrive."
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Supplier">
              <select required value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">Choose a supplier</option>
                {data.suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Purchase date">
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="purchase-lines">
            <div className="purchase-line-labels">
              <span>Product</span>
              <span>Quantity</span>
              <span>Unit cost</span>
              <span />
            </div>
            {items.map((item, index) => (
              <div className="purchase-line" key={index}>
                <select
                  required
                  value={item.product_id}
                  aria-label={`Product ${index + 1}`}
                  onChange={(e) => update(index, 'product_id', e.target.value)}
                >
                  <option value="">Select product</option>
                  {data.products
                    .filter((p) => p.active)
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <label className="purchase-line-field">
                  <span>Quantity</span>
                  <input
                    aria-label={`Quantity ${index + 1}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000000"
                    step="1"
                    value={item.quantity}
                    onChange={(e) => update(index, 'quantity', e.target.value)}
                    required
                  />
                </label>
                <label className="purchase-line-field">
                  <span>Unit cost</span>
                  <input
                    aria-label={`Unit cost ${index + 1}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1000000"
                    step=".01"
                    value={item.cost_price}
                    onChange={(e) => update(index, 'cost_price', e.target.value)}
                    required
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setItems((rows) => [...rows, { product_id: '', quantity: 1, cost_price: 0 }])
            }
          >
            <Plus size={16} />
            Add line
          </Button>
          <div className="form-grid purchase-meta">
            <Field label="Payment status">
              <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
              </select>
            </Field>
            <div className="purchase-total">
              <span>Purchase total</span>
              <strong>
                {cash(
                  items.reduce(
                    (sum, i) => sum + Math.round(Number(i.cost_price) * 100) * Number(i.quantity),
                    0,
                  ),
                  data.settings.currency,
                )}
              </strong>
            </div>
            <Field label="Notes" full>
              <textarea value={notes} maxLength={250} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          {error && <ErrorState message={error} />}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy}>Create purchase</Button>
        </footer>
      </form>
    </Modal>
  );
}
function PurchaseDetail({ purchase, onClose }) {
  const { data } = useStore(),
    resource = useResource(`/purchases/${purchase.id}/items`);
  return (
    <Modal title={purchase.number} subtitle={purchase.supplier} onClose={onClose} wide>
      <div className="modal-body">
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <Table
            rows={resource.data || []}
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'quantity', label: 'Quantity' },
              {
                key: 'cost_price',
                label: 'Unit cost',
                render: (i) => cash(i.cost_price, data.settings.currency),
              },
              {
                key: 'total',
                label: 'Total',
                render: (i) => cash(i.cost_price * i.quantity, data.settings.currency),
              },
            ]}
          />
        )}
        <div className="purchase-total">
          <span>Total</span>
          <strong>{cash(purchase.total, data.settings.currency)}</strong>
        </div>
        <p className="muted">{purchase.notes}</p>
      </div>
    </Modal>
  );
}
function PaymentStatus({ purchase, onClose }) {
  const { refresh, notify } = useStore(),
    [status, setStatus] = useState(purchase.payment_status),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="Update payment status"
      subtitle={purchase.number}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`/purchases/${purchase.id}/payment`, {
              method: 'PATCH',
              body: { payment_status: status },
            });
            await refresh();
            notify('Payment status updated');
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Payment status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
            </select>
          </Field>
          {error && <ErrorState message={error} />}
        </div>
        <footer>
          <Button loading={busy}>Save status</Button>
        </footer>
      </form>
    </Modal>
  );
}
export function Team() {
  const { data } = useStore(),
    [search, setSearch] = useState(''),
    [edit, setEdit] = useState(null),
    rows = (data.users || []).filter((u) =>
      [u.name, u.email, u.role].some((v) => v.toLowerCase().includes(search.toLowerCase())),
    );
  const fields = [
    { key: 'name', label: 'Full name', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    {
      key: 'role',
      label: 'Role',
      required: true,
      default: 'cashier',
      options: [
        { value: 'admin', label: 'Store owner / Admin' },
        { value: 'manager', label: 'Manager' },
        { value: 'cashier', label: 'Cashier' },
        { value: 'inventory', label: 'Inventory staff' },
      ],
    },
    {
      key: 'password',
      label: edit?.id ? 'New password (optional)' : 'Password',
      type: 'password',
      required: !edit?.id,
      hint: 'At least 12 characters. Share privately.',
    },
    {
      key: 'active',
      label: 'Account status',
      type: 'checkbox',
      default: true,
      checkLabel: 'Active account',
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="GOOD PEOPLE, GOOD BUSINESS"
        title="Team members"
        description="Give everyone the access they need to do their best work."
      >
        <Button onClick={() => setEdit({})}>
          <Plus size={18} />
          Add team member
        </Button>
      </PageHeader>
      <details className="management-role-guide">
        <summary>
          <ShieldCheck size={17} />
          Role permissions
        </summary>
        <div className="role-cards">
          {[
            ['Store owner', 'Full store access, settings, and team.'],
            ['Manager', 'Sales, inventory, expenses, and reports.'],
            ['Cashier', 'Checkout, customers, and own sales.'],
            ['Inventory staff', 'Products, suppliers, stock, and purchases.'],
          ].map(([title, description]) => (
            <div key={title}>
              <ShieldCheck size={19} />
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </details>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search team members" />
          <span className="management-record-count">{rows.length} team members</span>
        </div>
        <Table
          rows={rows}
          mobileColumns={['role', 'active']}
          columns={[
            {
              key: 'name',
              label: 'Team member',
              render: (u) => (
                <div className="person-cell">
                  <span className="person-avatar">
                    <UserRoundCog size={19} />
                  </span>
                  <div>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </div>
                </div>
              ),
            },
            {
              key: 'role',
              label: 'Role',
              render: (u) => (u.role === 'admin' ? 'Store owner' : titleCase(u.role)),
            },
            {
              key: 'created_at',
              label: 'Joined',
              render: (u) => localDate(u.created_at, data.settings.timezone),
            },
            {
              key: 'active',
              label: 'Status',
              render: (u) => (
                <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Disabled'}</Badge>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (u) => (
                <button
                  className="icon-button"
                  aria-label={`Edit ${u.name}`}
                  onClick={() => setEdit(u)}
                >
                  <Pencil size={16} />
                </button>
              ),
            },
          ]}
        />
      </section>
      {edit && (
        <EntityForm
          title="Team member"
          entity="users"
          fields={fields}
          record={edit}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
export function Audit() {
  const { data } = useStore(),
    resource = useResource('/audit'),
    [search, setSearch] = useState('');
  const rows = (resource.data || []).filter((a) =>
    [a.action, a.summary, a.user_name].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  return (
    <>
      <PageHeader
        eyebrow="CONFIDENCE IN EVERY CHANGE"
        title="Audit trail"
        description="A record of important actions, and the people behind them."
      >
        <Button
          variant="secondary"
          onClick={() =>
            downloadCSV(
              'audit-trail',
              rows.map((a) => ({
                date: a.created_at,
                user: a.user_name,
                action: a.action,
                summary: a.summary,
                details: JSON.stringify(a.details),
              })),
            )
          }
          disabled={!rows.length}
        >
          <Download size={16} />
          Export
        </Button>
      </PageHeader>
      <section className="panel records-panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search actions, details, or team members"
          />
        </div>
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <Table
            rows={rows}
            mobileColumns={['user_name', 'action']}
            columns={[
              {
                key: 'created_at',
                label: 'Date & time',
                render: (a) => dateTime(a.created_at, data.settings.timezone),
              },
              { key: 'user_name', label: 'Team member' },
              {
                key: 'action',
                label: 'Action',
                render: (a) => <span className="category-chip">{a.action}</span>,
              },
              {
                key: 'summary',
                label: 'Details',
                render: (a) => (
                  <div>
                    <span>{a.summary}</span>
                    {Object.keys(a.details || {}).length > 0 && (
                      <details className="audit-details">
                        <summary>View recorded values</summary>
                        <pre>{JSON.stringify(a.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
      <p className="page-note">
        The 1,000 most recent events. Audit records cannot be edited or removed through the
        application.
      </p>
    </>
  );
}
export function Account() {
  const { user, notify } = useStore(),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { current_password: current, password },
      });
      setCurrent('');
      setPassword('');
      setConfirm('');
      notify('Password changed. Other sessions have been signed out.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="YOUR SPACE"
        title="My account"
        description="Manage your password and view your access."
      />
      <div className="account-layout compact-account-layout">
        <section className="panel account-card">
          <span className="big-avatar">
            {user.name
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')}
          </span>
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <Badge>{user.role === 'admin' ? 'Store owner' : titleCase(user.role)}</Badge>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Change password</h2>
              <p>Use a unique password of at least 12 characters.</p>
            </div>
            <KeyRound size={21} />
          </div>
          <form onSubmit={submit}>
            <div className="modal-body">
              <Field label="Current password">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  maxLength={72}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="New password">
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={72}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={72}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {error && <ErrorState message={error} />}
              <Button loading={busy}>Update password</Button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
