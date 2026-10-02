import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  Plus,
  Keyboard,
  ArrowRight,
  CreditCard,
  Banknote,
  Smartphone,
  Check,
  Star,
  X,
} from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { api, cash } from '../lib/api';
import {
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
import CurrentOrder from '../components/CurrentOrder';
import QuantityKeypad from '../components/QuantityKeypad';
import {
  cartAfterAdding,
  findScannedProduct,
  productMatches,
  wholeQuantity,
} from '../lib/checkout';
import './POS.css';
export default function POS() {
  const catalog = useRef(null);
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
    [addError, setAddError] = useState(''),
    [addAnnouncement, setAddAnnouncement] = useState(''),
    [quantityTarget, setQuantityTarget] = useState(null),
    [orderOpen, setOrderOpen] = useState(false),
    [mobileOrder, setMobileOrder] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = (event) => {
      setMobileOrder(event.matches);
      if (!event.matches) setOrderOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    if (!mobileOrder) return;
    const scope = catalog.current?.closest('.pos-main');
    if (!scope) return;
    const viewport = window.visualViewport;
    let frame;
    const update = () => {
      // Browser chrome and the keyboard can obscure fixed controls without resizing the page.
      // Leave pinch zoom to the browser so magnified content can still be panned normally.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const bottom = Math.max(0, window.innerHeight - height - top);
      scope.style.setProperty('--pos-visible-height', `${height}px`);
      scope.style.setProperty('--pos-viewport-top', `${top}px`);
      scope.style.setProperty('--pos-viewport-bottom', `${bottom}px`);
      scope.toggleAttribute('data-pos-short-viewport', height <= 520);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      for (const name of ['--pos-visible-height', '--pos-viewport-top', '--pos-viewport-bottom'])
        scope.style.removeProperty(name);
      scope.removeAttribute('data-pos-short-viewport');
    };
  }, [mobileOrder]);
  useEffect(() => {
    if (!mobileOrder || !orderOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOrder, orderOpen]);
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
      const nextCart = cartAfterAdding(cart, p, enteredQuantity);
      setCart(nextCart);
      setEnteredQuantity('1');
      setAddError('');
      setAddAnnouncement(
        `Added ${Number(enteredQuantity)} ${p.unit} of ${p.name}. ${nextCart.reduce((sum, item) => sum + item.quantity, 0)} items in order.`,
      );
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
      return error.message;
    }
    if (!p || value > p.stock) {
      const message = p
        ? `Only ${p.stock} ${p.unit} available for ${p.name}.`
        : 'This product is no longer available.';
      notify(message, 'error');
      return message;
    }
    setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, quantity: value } : i)));
    return true;
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
    setOrderOpen(false);
    setCart([]);
    setDiscount(0);
    setCustomer('');
    key.current = crypto.randomUUID();
    await refresh().catch(() => notify('Sale saved. Reload to refresh your inventory.', 'error'));
  };
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const openQuantity = () => setQuantityTarget({ value: enteredQuantity });
  const orderContent = (
    <CurrentOrder
      items={items}
      customer={customer}
      onCustomer={setCustomer}
      discount={discount}
      onDiscount={setDiscount}
      user={user}
      settings={s}
      customers={data.customers}
      discounts={data.discounts}
      onQuantity={quantity}
      onEditQuantity={(item) =>
        setQuantityTarget({ product_id: item.product_id, value: item.quantity })
      }
      onVoid={setVoidItem}
      onVoidOrder={() => setClear(true)}
      onCharge={() => setCheckout({ idempotency_key: key.current })}
      totals={{ subtotal, discountAmount, tax, total }}
      ready={ready}
      compact={mobileOrder}
      onContinue={() => setOrderOpen(false)}
    />
  );
  return (
    <>
      <h1 className="pos-sr-only">Point of sale</h1>
      <span className="pos-sr-only" role="status">
        {addAnnouncement}
      </span>
      <div className="pos-layout touch-pos" ref={catalog}>
        <section className="product-picker">
          <div className="pos-catalog-tools">
            <div className="pos-search-row">
              <div className="pos-search">
                <Search size={20} />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={scan}
                  aria-label="Search or scan a product"
                  placeholder="Search or scan"
                />
                {query ? (
                  <button
                    type="button"
                    className="pos-clear-search"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('');
                      search.current?.focus();
                    }}
                  >
                    <X size={18} />
                  </button>
                ) : (
                  <kbd>F2</kbd>
                )}
              </div>
              <Button
                variant="secondary"
                className="pos-find-button"
                aria-label="Find Product"
                title="Find Product"
                onClick={() => setFindProduct(true)}
              >
                <Search size={19} />
                <span className="pos-find-label">Find Product</span>
                <span className="pos-find-mobile-label">Find</span>
              </Button>
            </div>
            <div className="pos-quantity-caption" aria-hidden="true">
              <span>Quantity per item</span>
              <span>Resets after adding</span>
            </div>
            <div className="pos-entry-controls">
              <div className="pos-quantity-entry">
                <label htmlFor="next-product-quantity">Qty</label>
                <div className="pos-quantity-input">
                  <input
                    id="next-product-quantity"
                    aria-label="Quantity before adding"
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    inputMode="numeric"
                    value={enteredQuantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEnteredQuantity(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        search.current?.focus();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={openQuantity}
                    aria-label="Open quantity keypad"
                    title="Set quantity using keypad"
                  >
                    <Keyboard size={21} />
                  </button>
                </div>
              </div>
              <div className="pos-quick-quantity" aria-label="Quick quantities">
                {[1, 2, 5, 10].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Set quantity to ${value}`}
                    aria-pressed={Number(enteredQuantity) === value}
                    onClick={() => {
                      setEnteredQuantity(String(value));
                      setAddError('');
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            {addError && <ErrorState message={addError} />}
          </div>
          <div className="pos-catalog-products">
            {!!favoriteProducts.length && (
              <section className="pos-favorites" aria-label="Favorite products">
                <Star size={17} aria-hidden="true" />
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
              </section>
            )}
            <div className="category-tabs" role="group" aria-label="Product categories">
              <button
                className={category === 'all' ? 'active' : ''}
                aria-pressed={category === 'all'}
                onClick={() => setCategory('all')}
              >
                All products <span>{products.length}</span>
              </button>
              {data.categories.map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? 'active' : ''}
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="pos-catalog-heading">
              <h2>
                {category === 'all'
                  ? 'Products'
                  : data.categories.find((c) => c.id === category)?.name || 'Products'}
                <span>{shown.length}</span>
              </h2>
              <span>Tap to add</span>
            </div>
            <div className="product-grid">
              {shown.map((p) => {
                const count = cart.find((i) => i.product_id === p.id)?.quantity;
                return (
                  <button
                    key={p.id}
                    className={`product-card ${p.stock === 0 ? 'sold-out' : ''} ${count ? 'is-in-cart' : ''}`}
                    disabled={p.stock === 0}
                    onClick={() => add(p)}
                    aria-label={`Add ${p.name}`}
                    aria-describedby={`product-details-${p.id}`}
                  >
                    <div className="product-image">
                      <ProductAvatar product={p} size="large" />
                      {count && (
                        <span className="in-cart">
                          <Check size={12} />
                          {count}
                          <span className="pos-in-cart-label"> in order</span>
                        </span>
                      )}
                      {p.stock === 0 && <span className="sold-out-label">Out of stock</span>}
                    </div>
                    <div className="product-card-body" id={`product-details-${p.id}`}>
                      <h3 title={p.name}>{p.name}</h3>
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
              <Empty
                title="No products found"
                text="Try another product name, SKU, or barcode."
                action={
                  (query || category !== 'all') && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery('');
                        setCategory('all');
                        search.current?.focus();
                      }}
                    >
                      Reset filters
                    </Button>
                  )
                }
              />
            )}
          </div>
        </section>
        {!mobileOrder && (
          <aside
            className="cart-panel pos-current-order"
            id="current-order"
            aria-label="Current order"
          >
            {orderContent}
          </aside>
        )}
      </div>
      {mobileOrder && (
        <div className="pos-mobile-checkout">
          <div className="pos-mobile-total" id="mobile-order-total">
            <span>Order total</span>
            <strong>{m(total)}</strong>
          </div>
          <button
            type="button"
            className="mobile-cart-shortcut pos-touch-cart-shortcut"
            aria-label="View current order"
            aria-describedby="mobile-order-total mobile-order-count"
            onClick={() => setOrderOpen(true)}
          >
            <span className="pos-shortcut-count" aria-hidden="true">
              {itemCount}
            </span>
            <span id="mobile-order-count" className="pos-sr-only">
              {itemCount} items in order
            </span>
            <span>View order</span>
            <ArrowRight size={18} />
          </button>
        </div>
      )}
      {mobileOrder && orderOpen && (
        <Modal
          title="Current order"
          subtitle={`${items.length} ${items.length === 1 ? 'product' : 'products'} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          className="cart-panel pos-order-sheet"
          onClose={() => setOrderOpen(false)}
        >
          {orderContent}
        </Modal>
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
          openQuantity={openQuantity}
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
      {quantityTarget && (
        <QuantityKeypad
          key={quantityTarget.product_id || 'next-product'}
          value={quantityTarget.value}
          title={quantityTarget.product_id ? 'Edit quantity' : 'Set quantity'}
          subtitle={
            quantityTarget.product_id
              ? items.find((item) => item.product_id === quantityTarget.product_id)?.name
              : 'Choose how many to add with your next scan or product selection.'
          }
          max={
            quantityTarget.product_id
              ? Math.min(
                  products.find((p) => p.id === quantityTarget.product_id)?.stock || 0,
                  1000000,
                )
              : 1000000
          }
          onApply={(value) => {
            if (quantityTarget.product_id) return quantity(quantityTarget.product_id, value);
            setEnteredQuantity(String(value));
            setAddError('');
            return true;
          }}
          onClose={() => setQuantityTarget(null)}
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
  openQuantity,
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
          <Button
            className="pos-find-keypad"
            variant="secondary"
            onClick={openQuantity}
            aria-label="Open quantity keypad"
          >
            <Keyboard size={20} />
            Keypad
          </Button>
        </div>
        {error && <ErrorState message={error} />}
        <Table
          key={query}
          rows={rows}
          pageSize={8}
          mobileColumns={['price', 'stock']}
          emptyText="No products match. Try another name, SKU, product code, or barcode."
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: (p) => (
                <div className="pos-find-name">
                  <div className="pos-find-title">
                    <strong>{p.name}</strong>
                    <button
                      className={`pos-favorite-toggle ${favorites.includes(p.id) ? 'selected' : ''}`}
                      aria-label={`Favorite ${p.name}`}
                      aria-pressed={favorites.includes(p.id)}
                      onClick={() => toggleFavorite(p.id)}
                    >
                      <Star size={18} />
                    </button>
                  </div>
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
              key: 'actions',
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
      className="pos-payment-dialog"
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
                  inputMode="decimal"
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
