import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  ScanBarcode,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  ArrowRight,
  UserRound,
  CreditCard,
  Banknote,
  Smartphone,
  Check,
} from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { api, cash } from '../lib/api';
import {
  PageHeader,
  Button,
  ProductAvatar,
  Empty,
  Modal,
  Field,
  ErrorState,
  Confirm,
} from '../components/ui';
import Receipt from '../components/Receipt';
export default function POS() {
  const { data, user, refresh, notify } = useStore(),
    [params] = useSearchParams(),
    [searchState, setSearchState] = useState({
      key: params.get('q') || '',
      value: params.get('q') || '',
    }),
    [category, setCategory] = useState('all');
  const queryParam = params.get('q') || '',
    query = searchState.key === queryParam ? searchState.value : queryParam,
    setQuery = (value) => setSearchState({ key: queryParam, value });
  const storage = `suki-cart-${user.id}`;
  const [cart, setCart] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) || '[]');
      return Array.isArray(saved)
        ? saved.filter(
            (i) =>
              typeof i.product_id === 'string' && Number.isInteger(i.quantity) && i.quantity > 0,
          )
        : [];
    } catch {
      return [];
    }
  });
  const [customer, setCustomer] = useState(''),
    [discount, setDiscount] = useState(0),
    [checkout, setCheckout] = useState(false),
    [receipt, setReceipt] = useState(null),
    [clear, setClear] = useState(false);
  const search = useRef(null),
    key = useRef(crypto.randomUUID());
  const s = data.settings,
    m = (v) => cash(v, s.currency),
    products = data.products.filter((p) => p.active);
  useEffect(() => {
    sessionStorage.setItem(storage, JSON.stringify(cart));
    key.current = crypto.randomUUID();
  }, [cart, storage, discount, customer]);
  useEffect(() => {
    const handle = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const items = useMemo(
    () => cart.map((i) => ({ ...data.products.find((p) => p.id === i.product_id), ...i })),
    [cart, data.products],
  );
  const subtotal = items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0),
    discountAmount = Math.round((subtotal * discount) / 100),
    net = subtotal - discountAmount;
  const tax = Math.round(
      s.tax_inclusive
        ? net - net / (1 + Number(s.tax_rate) / 100)
        : (net * Number(s.tax_rate)) / 100,
    ),
    total = s.tax_inclusive ? net : net + tax;
  const shown = products.filter(
    (p) =>
      (category === 'all' || p.category_id === category) &&
      [p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(query.toLowerCase())),
  );
  const add = (p) => {
    const existing = cart.find((i) => i.product_id === p.id);
    if ((existing?.quantity || 0) >= p.stock) {
      notify(`Only ${p.stock} ${p.unit} available for ${p.name}.`, 'error');
      return;
    }
    setCart((c) =>
      existing
        ? c.map((i) => (i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...c, { product_id: p.id, quantity: 1 }],
    );
  };
  const quantity = (pid, value) => {
    const p = products.find((p) => p.id === pid);
    if (!Number.isInteger(value) || value < 1) return;
    if (!p || value > p.stock) {
      notify('Quantity exceeds available stock.', 'error');
      return;
    }
    setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, quantity: value } : i)));
  };
  const scan = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const exact = products.find((p) =>
        [p.barcode, p.sku, p.name].some((v) => v?.toLowerCase() === query.toLowerCase()),
      );
      const match = exact || (shown.length === 1 ? shown[0] : null);
      if (match) {
        add(match);
        setQuery('');
      } else notify('Choose a product or scan an exact barcode.', 'error');
    }
  };
  const ready = items.length > 0 && items.every((i) => i.active && i.quantity <= i.stock);
  const finish = async (sale) => {
    setReceipt(sale);
    setCheckout(false);
    setCart([]);
    setDiscount(0);
    setCustomer('');
    key.current = crypto.randomUUID();
    await refresh().catch(() => notify('Sale saved. Reload to refresh your inventory.', 'error'));
  };
  return (
    <>
      <PageHeader
        eyebrow="YOUR COUNTER, SIMPLIFIED"
        title="Point of sale"
        description="A new sale. Another happy suki."
      >
        <span className="register-status">
          <i />
          Register open
        </span>
      </PageHeader>
      <div className="pos-layout">
        <section className="product-picker">
          <div className="pos-search">
            <Search size={20} />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={scan}
              aria-label="Search or scan a product"
              placeholder="Search products, SKU, or scan a barcode…"
            />
            <kbd>F2</kbd>
            <ScanBarcode size={23} />
          </div>
          <div className="category-tabs">
            <button
              className={category === 'all' ? 'active' : ''}
              onClick={() => setCategory('all')}
            >
              All products <span>{products.length}</span>
            </button>
            {data.categories.map((c) => (
              <button
                key={c.id}
                className={category === c.id ? 'active' : ''}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="product-grid">
            {shown.map((p) => {
              const count = cart.find((i) => i.product_id === p.id)?.quantity;
              return (
                <button
                  key={p.id}
                  className={`product-card ${p.stock === 0 ? 'sold-out' : ''}`}
                  disabled={p.stock === 0}
                  onClick={() => add(p)}
                  aria-label={`Add ${p.name}`}
                >
                  <div className="product-image">
                    <ProductAvatar product={p} size="large" />
                    {count && (
                      <span className="in-cart">
                        <Check size={12} />
                        {count}
                      </span>
                    )}
                    {p.stock === 0 && <span className="sold-out-label">Out of stock</span>}
                  </div>
                  <div className="product-card-body">
                    <small>{p.category || 'Uncategorized'}</small>
                    <h3>{p.name}</h3>
                    <div>
                      <strong>{m(p.price)}</strong>
                      <span className="add-circle">
                        <Plus size={16} />
                      </span>
                    </div>
                    <span
                      className={
                        p.stock <= Number(p.min_stock ?? s.low_stock_threshold)
                          ? 'stock-hint low'
                          : 'stock-hint'
                      }
                    >
                      {p.stock} {p.unit} in stock
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {!shown.length && (
            <Empty title="No products found" text="Try another product name, SKU, or barcode." />
          )}
          <p className="picker-help">
            <ScanBarcode size={16} />
            Barcode scanners work like a keyboard. Focus the search field and scan.
          </p>
        </section>
        <aside className="cart-panel" id="current-order">
          <header>
            <div>
              <ShoppingBag size={21} />
              <h2>Current order</h2>
              <span>{cart.reduce((sum, i) => sum + i.quantity, 0)}</span>
            </div>
            <button
              aria-label="Clear order"
              className="icon-button"
              disabled={!cart.length}
              onClick={() => setClear(true)}
            >
              <Trash2 size={18} />
            </button>
          </header>
          <div className="customer-picker">
            <UserRound size={18} />
            <select
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              aria-label="Customer"
            >
              <option value="">Walk-in customer</option>
              {data.customers?.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cart-lines">
            {!items.length ? (
              <Empty title="Your order starts here" text="Tap a product to add it to the order." />
            ) : (
              items.map((i) => (
                <div className="cart-line" key={i.product_id}>
                  <ProductAvatar product={i} />
                  <div className="cart-line-main">
                    <strong>{i.name || 'Unavailable product'}</strong>
                    <span>
                      {m(i.price)} / {i.unit}
                    </span>
                    <div className="quantity-control">
                      <button
                        aria-label={`Decrease ${i.name}`}
                        onClick={() =>
                          i.quantity === 1
                            ? setCart((c) => c.filter((x) => x.product_id !== i.product_id))
                            : quantity(i.product_id, i.quantity - 1)
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        aria-label={`Quantity for ${i.name}`}
                        type="number"
                        min="1"
                        max={i.stock}
                        value={i.quantity}
                        onChange={(e) => quantity(i.product_id, Number(e.target.value))}
                      />
                      <button
                        aria-label={`Increase ${i.name}`}
                        onClick={() => quantity(i.product_id, i.quantity + 1)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    {(!i.active || i.quantity > i.stock) && (
                      <small className="text-danger">Product or quantity unavailable</small>
                    )}
                  </div>
                  <div className="cart-line-end">
                    <strong>{m((i.price || 0) * i.quantity)}</strong>
                    <button
                      aria-label={`Remove ${i.name}`}
                      onClick={() => setCart((c) => c.filter((x) => x.product_id !== i.product_id))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="cart-summary">
            <div className="discount-row">
              <span>Discount</span>
              <select
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                aria-label="Order discount"
              >
                <option value="0">No discount</option>
                {data.discounts
                  .filter(
                    (d) =>
                      d.active &&
                      (user.role !== 'cashier' ||
                        Number(d.percent) <= Number(s.cashier_discount_limit)),
                  )
                  .map((d) => (
                    <option key={d.id} value={Number(d.percent)}>
                      {d.name} ({Number(d.percent)}%)
                    </option>
                  ))}
              </select>
              <input
                type="number"
                aria-label="Custom discount percent"
                min="0"
                max={user.role === 'cashier' ? s.cashier_discount_limit : 100}
                step="0.5"
                value={discount}
                onChange={(e) =>
                  setDiscount(
                    Math.min(
                      user.role === 'cashier' ? Number(s.cashier_discount_limit) : 100,
                      Math.max(0, Number(e.target.value)),
                    ),
                  )
                }
              />
              <span>%</span>
            </div>
            <p>
              <span>Subtotal</span>
              <strong>{m(subtotal)}</strong>
            </p>
            <p>
              <span>Discount</span>
              <strong>−{m(discountAmount)}</strong>
            </p>
            <p>
              <span>
                Tax ({Number(s.tax_rate)}%{s.tax_inclusive ? ', included' : ''})
              </span>
              <strong>{m(tax)}</strong>
            </p>
            <div className="order-total">
              <span>Total amount</span>
              <strong>{m(total)}</strong>
            </div>
            <Button
              className="checkout-button"
              disabled={!ready}
              onClick={() => setCheckout({ idempotency_key: key.current })}
            >
              Charge {m(total)}
              <ArrowRight size={19} />
            </Button>
            <small className="cart-footnote">Inventory updates when you complete the sale.</small>
          </div>
        </aside>
      </div>
      {cart.length > 0 && (
        <button
          className="mobile-cart-shortcut"
          aria-label="View current order"
          onClick={() =>
            document
              .getElementById('current-order')
              ?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                  ? 'auto'
                  : 'smooth',
                block: 'start',
              })
          }
        >
          <ShoppingBag size={19} />
          <span>View order ? {cart.reduce((sum, i) => sum + i.quantity, 0)} items</span>
          <strong>{m(total)}</strong>
          <ArrowRight size={18} />
        </button>
      )}
      {checkout && (
        <Checkout
          total={total}
          settings={s}
          onClose={() => setCheckout(false)}
          onComplete={finish}
          payload={{
            items: cart,
            customer_id: customer || null,
            discount_percent: discount,
            idempotency_key: checkout.idempotency_key,
          }}
        />
      )}
      {receipt && (
        <Receipt
          sale={receipt}
          completed
          onClose={() => {
            setReceipt(null);
            search.current?.focus();
          }}
        />
      )}
      {clear && (
        <Confirm
          title="Clear this order?"
          description="All items will be removed from the current order."
          action="Clear order"
          onClose={() => setClear(false)}
          onConfirm={() => {
            setCart([]);
            setDiscount(0);
          }}
        />
      )}
    </>
  );
}
function Checkout({ total, settings, payload, onClose, onComplete }) {
  const [method, setMethod] = useState(settings.payment_methods[0]),
    [received, setReceived] = useState(''),
    [reference, setReference] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const m = (v) => cash(v, settings.currency),
    isCash = method === 'Cash',
    paid = isCash ? Math.round(Number(received) * 100) : total;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const sale = await api('/sales', {
        method: 'POST',
        body: {
          ...payload,
          payment_method: method,
          amount_received: paid,
          payment_reference: reference,
        },
      });
      await onComplete(sale);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Complete payment"
      subtitle="Confirm that payment has been received before completing the sale."
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="payment-total">
            <span>Amount to pay</span>
            <strong>{m(total)}</strong>
          </div>
          <div className="payment-methods">
            {settings.payment_methods.map((name) => (
              <button
                type="button"
                key={name}
                className={method === name ? 'active' : ''}
                onClick={() => setMethod(name)}
              >
                {name === 'Cash' ? (
                  <Banknote />
                ) : ['GCash', 'Maya'].includes(name) ? (
                  <Smartphone />
                ) : (
                  <CreditCard />
                )}
                {name}
                {method === name && <Check size={14} />}
              </button>
            ))}
          </div>
          {isCash ? (
            <>
              <Field label="Cash received">
                <input
                  autoFocus
                  type="number"
                  min={total / 100}
                  max="1000000"
                  step="0.01"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </Field>
              <div className="quick-amounts">
                {[...new Set([total, ...[10000, 20000, 50000, 100000].filter((n) => n > total)])]
                  .slice(0, 5)
                  .map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setReceived(String(amount / 100))}
                    >
                      {amount === total ? 'Exact' : m(amount)}
                    </button>
                  ))}
              </div>
              <div className="change-due">
                <span>Change due</span>
                <strong>{m(Math.max(0, paid - total))}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="info-note">
                Record an already-received payment. This does not initiate a transfer or charge a
                wallet.
              </div>
              <Field label="Payment reference (optional)">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={250}
                  placeholder="Transaction reference number"
                />
              </Field>
            </>
          )}
          {error && <ErrorState message={error} />}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Back to order
          </Button>
          <Button loading={busy} disabled={paid < total || !Number.isFinite(paid)}>
            <Check size={17} />
            Complete sale
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
