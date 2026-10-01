import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Keyboard,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Button, Empty, ProductAvatar } from './ui';
import { cash } from '../lib/api';

export default function CurrentOrder({
  items,
  customer,
  onCustomer,
  discount,
  onDiscount,
  user,
  settings,
  customers,
  discounts,
  onQuantity,
  onEditQuantity,
  onVoid,
  onVoidOrder,
  onCharge,
  totals,
  ready,
  compact = false,
  onContinue,
}) {
  const m = (value) => cash(value, settings.currency);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const limit = user.role === 'cashier' ? Number(settings.cashier_discount_limit) : 100;
  return (
    <div className="pos-order-content">
      {!compact && (
        <header className="pos-order-heading">
          <div>
            <span className="pos-order-icon">
              <ShoppingBag size={22} />
            </span>
            <div>
              <h2>Current order</h2>
              <p>
                {items.length} products <span aria-hidden="true">·</span> {count} items
              </p>
            </div>
          </div>
          <button
            type="button"
            className="pos-order-void"
            aria-label="Void current order"
            title="Void current order"
            disabled={!items.length}
            onClick={onVoidOrder}
          >
            <Trash2 size={19} />
          </button>
        </header>
      )}
      <div className="pos-order-tools">
        {compact && (
          <div className="pos-order-mobile-actions">
            <Button variant="ghost" onClick={onContinue}>
              <ArrowLeft size={18} />
              Continue shopping
            </Button>
            <button
              type="button"
              className="pos-order-void"
              aria-label="Void current order"
              disabled={!items.length}
              onClick={onVoidOrder}
            >
              <Trash2 size={19} />
              Void
            </button>
          </div>
        )}
        <label className="pos-order-customer">
          <UserRound size={19} />
          <select
            value={customer}
            onChange={(e) => onCustomer(e.target.value)}
            aria-label="Customer"
          >
            <option value="">Walk-in customer</option>
            {customers?.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pos-order-lines" aria-label="Items in current order" tabIndex={0}>
        {!items.length ? (
          <Empty
            title="Your order starts here"
            text="Choose a quantity, then tap a product or scan its barcode."
          />
        ) : (
          items.map((item) => (
            <article className="pos-order-line" key={item.product_id}>
              <div className="pos-order-product">
                <ProductAvatar product={item} />
                <div>
                  <h3>{item.name || 'Unavailable product'}</h3>
                  <p>
                    {m(item.price || 0)} / {item.unit || 'unit'}
                  </p>
                </div>
                <strong>{m((item.price || 0) * item.quantity)}</strong>
              </div>
              <div className="pos-order-line-actions">
                <div className="pos-line-stepper">
                  <button
                    type="button"
                    aria-label={`Decrease ${item.name}`}
                    onClick={() =>
                      item.quantity === 1
                        ? onVoid(item)
                        : onQuantity(item.product_id, item.quantity - 1)
                    }
                  >
                    <Minus size={18} />
                  </button>
                  <input
                    aria-label={`Quantity for ${item.name}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    max={Math.min(item.stock ?? 0, 1000000)}
                    value={item.quantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onQuantity(item.product_id, Number(e.target.value))}
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${item.name}`}
                    disabled={!item.active || item.quantity >= Math.min(item.stock, 1000000)}
                    onClick={() => onQuantity(item.product_id, item.quantity + 1)}
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <button
                  type="button"
                  className="pos-line-keypad"
                  aria-label={`Edit quantity for ${item.name}`}
                  onClick={() => onEditQuantity(item)}
                >
                  <Keyboard size={18} />
                  <span>Keypad</span>
                </button>
                <button
                  type="button"
                  className="pos-line-remove"
                  aria-label={`Void ${item.name}`}
                  title="Void item before payment"
                  onClick={() => onVoid(item)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {(!item.active || item.quantity > item.stock) && (
                <p className="pos-stock-error" role="status">
                  {!item.active
                    ? 'Product is no longer available.'
                    : `Only ${item.stock} ${item.unit} available. Reduce the quantity to continue.`}
                </p>
              )}
            </article>
          ))
        )}
      </div>
      <div className="pos-order-bottom">
        <details className="pos-order-discount">
          <summary>
            <span>Order discount</span>
            <strong>{discount ? `${discount}% applied` : 'Add discount'}</strong>
            <ChevronDown size={17} />
          </summary>
          <div className="pos-discount-fields">
            <label>
              Preset
              <select
                value={discount}
                onChange={(e) => onDiscount(Number(e.target.value))}
                aria-label="Order discount"
              >
                <option value="0">No discount</option>
                {discounts
                  .filter((d) => d.active && Number(d.percent) <= limit)
                  .map((d) => (
                    <option key={d.id} value={Number(d.percent)}>
                      {d.name} ({Number(d.percent)}%)
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Percent
              <input
                type="number"
                inputMode="decimal"
                aria-label="Custom discount percent"
                min="0"
                max={limit}
                step="0.5"
                value={discount}
                onChange={(e) => onDiscount(Math.min(limit, Math.max(0, Number(e.target.value))))}
              />
            </label>
          </div>
        </details>
        <div className="pos-order-totals">
          <p>
            <span>Subtotal</span>
            <strong>{m(totals.subtotal)}</strong>
          </p>
          {discount > 0 && (
            <p>
              <span>Discount ({discount}%)</span>
              <strong>−{m(totals.discountAmount)}</strong>
            </p>
          )}
          <p>
            <span>
              Tax ({Number(settings.tax_rate)}%{settings.tax_inclusive ? ', included' : ''})
            </span>
            <strong>{m(totals.tax)}</strong>
          </p>
        </div>
        <div className="pos-order-total">
          <div>
            <span>Total amount</span>
            <small>
              {count} {count === 1 ? 'item' : 'items'} in this order
            </small>
          </div>
          <strong>{m(totals.total)}</strong>
        </div>
        <Button className="checkout-button" disabled={!ready} onClick={onCharge}>
          Charge {m(totals.total)}
          <ArrowRight size={21} />
        </Button>
      </div>
    </div>
  );
}
