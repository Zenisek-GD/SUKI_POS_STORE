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
  Star,
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
  SearchBox,
  Table,
} from '../components/ui';
import Receipt from '../components/Receipt';
import {
  cartAfterAdding,
  findScannedProduct,
  productMatches,
  wholeQuantity,
} from '../lib/checkout';
import './POS.css';
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
    [clear, setClear] = useState(false),
    [voidItem, setVoidItem] = useState(null),
    [enteredQuantity, setEnteredQuantity] = useState('1'),
    [findProduct, setFindProduct] = useState(false),
    [addError, setAddError] = useState('');
  const favoriteStorage = `suki-favorites-${user.store_id}-${user.id}`;
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(favoriteStorage) || '[]');
      return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
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
    try {
      localStorage.setItem(favoriteStorage, JSON.stringify(favorites));
    } catch {
      // Favorites remain available for this visit if browser storage is unavailable.
    }
  }, [favorites, favoriteStorage]);
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
    (p) => (category === 'all' || p.category_id === category) && productMatches(p, query),
  );
  const add = (p) => {
    try {
      setCart(cartAfterAdding(cart, p, enteredQuantity));
      setEnteredQuantity('1');
      setAddError('');
      notify(`Added ${Number(enteredQuantity)} ${p.unit} of ${p.name}.`);
      return true;
    } catch (error) {
      setAddError(error.message);
      notify(error.message, 'error');
      return false;
    }
  };
  const quantity = (pid, value) => {
    const p = products.find((p) => p.id === pid);
    try {
      wholeQuantity(value);
    } catch (error) {
      notify(error.message, 'error');
      return;
    }
    if (!p || value > p.stock) {
      notify('Quantity exceeds available stock.', 'error');
      return;
    }
    setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, quantity: value } : i)));
  };
  const scan = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      try {
        const match = findScannedProduct(products, query);
        if (!match)
          throw new Error('Product not found. Check the barcode or code, or use Find Product.');
        if (add(match)) setQuery('');
      } catch (error) {
        setAddError(error.message);
        notify(error.message, 'error');
      }
    }
  };
  const toggleFavorite = (id) =>
    setFavorites((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const favoriteProducts = products.filter((p) => favorites.includes(p.id));
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
          <div className="pos-entry-controls">
            <Field label="Quantity before adding" hint="Applies to the next product.">
              <input
                type="number"
                min="1"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={enteredQuantity}
                onChange={(e) => setEnteredQuantity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    search.current?.focus();
                  }
                }}
              />
            </Field>
            <Button variant="secondary" onClick={() => setFindProduct(true)}>
              <Search size={18} />
              Find Product
            </Button>
          </div>
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
          <p className="pos-entry-help">
            Enter a quantity, then scan or enter an exact barcode, SKU, or product code. Press Enter
            to add.
          </p>
          {addError && <ErrorState message={addError} />}
          <section className="pos-favorites" aria-label="Favorite products">
            <div className="pos-favorites-heading">
              <h2>
                <Star size={15} /> Favorites
              </h2>
              <button onClick={() => setFindProduct(true)}>Manage favorites</button>
            </div>
            {favoriteProducts.length ? (
              <div className="pos-favorite-buttons">
                {favoriteProducts.map((p) => (
                  <button
                    key={p.id}
                    disabled={!p.stock}
                    onClick={() => add(p)}
                    aria-label={`Add favorite ${p.name}`}
                  >
                    <span>{p.name}</span>
                    <strong>{m(p.price)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p>Star products in Find Product for quick access on this device.</p>
            )}
          </section>
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
              aria-label="Void current order"
              title="Void current order before payment"
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
                          i.quantity === 1 ? setVoidItem(i) : quantity(i.product_id, i.quantity - 1)
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        aria-label={`Quantity for ${i.name}`}
                        type="number"
                        min="1"
                        step="1"
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
                      aria-label={`Void ${i.name}`}
                      title="Void item before payment"
                      onClick={() => setVoidItem(i)}
                    >
                      <Trash2 size={14} />
                      <span>Void</span>
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
            document.getElementById('current-order')?.scrollIntoView({
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
      {findProduct && (
        <FindProduct
          products={products}
          cart={cart}
          currency={s.currency}
          enteredQuantity={enteredQuantity}
          setEnteredQuantity={setEnteredQuantity}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          add={add}
          error={addError}
          onClose={() => setFindProduct(false)}
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
          title="Void this order?"
          description="Cancel all items before payment. This order has not been completed, so no refund or inventory change is needed."
          action="Void order"
          onClose={() => setClear(false)}
          onConfirm={() => {
            setCart([]);
            setDiscount(0);
            setCustomer('');
          }}
        />
      )}
      {voidItem && (
        <Confirm
          title={`Void ${voidItem.name}?`}
          description={`Remove ${voidItem.quantity} ${voidItem.unit} from the current order before payment.`}
          action="Void item"
          onClose={() => setVoidItem(null)}
          onConfirm={() =>
            setCart((current) => current.filter((i) => i.product_id !== voidItem.product_id))
          }
        />
      )}
    </>
  );
}
function FindProduct({
  products,
  cart,
  currency,
  enteredQuantity,
  setEnteredQuantity,
  favorites,
  toggleFavorite,
  add,
  error,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const rows = products.filter((p) => productMatches(p, query));
  return (
    <Modal
      title="Find Product"
      subtitle="Select products without a scanner. Star your regular items for faster checkout."
      onClose={onClose}
      wide
    >
      <div className="modal-body pos-find-product">
        <div className="pos-find-controls">
          <SearchBox
            autoFocus
            value={query}
            onChange={setQuery}
            placeholder="Search name, SKU, product code, or barcode"
          />
          <Field label="Quantity to add">
            <input
              type="number"
              min="1"
              max="1000000"
              step="1"
              inputMode="numeric"
              value={enteredQuantity}
              onChange={(e) => setEnteredQuantity(e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <Table
          key={query}
          rows={rows}
          pageSize={8}
          emptyText="No products match. Try another name, SKU, product code, or barcode."
          columns={[
            {
              key: 'favorite',
              label: 'Favorite',
              render: (p) => (
                <button
                  className={`pos-favorite-toggle ${favorites.includes(p.id) ? 'selected' : ''}`}
                  aria-label={`Favorite ${p.name}`}
                  aria-pressed={favorites.includes(p.id)}
                  onClick={() => toggleFavorite(p.id)}
                >
                  <Star size={18} />
                </button>
              ),
            },
            {
              key: 'name',
              label: 'Product',
              render: (p) => (
                <div className="pos-find-name">
                  <strong>{p.name}</strong>
                  <small>SKU: {p.sku}</small>
                  <small>Code: {p.product_code || 'Pending'}</small>
                  {p.barcode && <small>Barcode: {p.barcode}</small>}
                </div>
              ),
            },
            { key: 'price', label: 'Selling price', render: (p) => cash(p.price, currency) },
            {
              key: 'stock',
              label: 'Available stock',
              render: (p) => (
                <span>
                  {p.stock} {p.unit}
                  <small className="pos-in-order">
                    {cart.find((i) => i.product_id === p.id)?.quantity || 0} in order
                  </small>
                </span>
              ),
            },
            {
              key: 'add',
              label: 'Add',
              render: (p) => (
                <Button
                  variant="secondary"
                  disabled={!p.stock}
                  onClick={() => add(p)}
                  aria-label={`Add ${p.name} to order`}
                >
                  <Plus size={16} />
                  Add
                </Button>
              ),
            },
          ]}
        />
      </div>
      <footer>
        <Button onClick={onClose}>Back to order</Button>
      </footer>
    </Modal>
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
