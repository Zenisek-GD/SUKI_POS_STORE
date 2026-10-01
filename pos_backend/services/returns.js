import { createHash } from 'node:crypto';
import { one } from '../models/database.js';
import { id, reference, assert, audit } from '../utils.js';
import { moveStock } from './inventory.js';

export const RETURN_WINDOW_HOURS = 24;

function roundedShare(total, numerator, denominator) {
  if (!denominator) return 0;
  const divisor = BigInt(denominator);
  return Number((BigInt(total) * BigInt(numerator) + divisor / 2n) / divisor);
}

// Allocate the original receipt's rounded discount/tax once per line. Cumulative
// allocation also handles a final cent fairly, without ever refunding too much.
export function allocatePaidAmounts(sale, items) {
  let gross = 0,
    discount = 0,
    net = 0,
    tax = 0;
  const discountedSubtotal = sale.subtotal - sale.discount;
  return [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => {
      gross += item.total;
      const nextDiscount = roundedShare(sale.discount, gross, sale.subtotal);
      const lineDiscount = nextDiscount - discount;
      discount = nextDiscount;
      const lineNet = item.total - lineDiscount;
      net += lineNet;
      const nextTax = roundedShare(sale.tax, net, discountedSubtotal);
      const lineTax = nextTax - tax;
      tax = nextTax;
      return {
        ...item,
        discount_total: lineDiscount,
        tax_total: lineTax,
        paid_total: lineNet + (sale.receipt_store.tax_inclusive ? 0 : lineTax),
      };
    });
}

export function unitShare(total, before, quantity, purchased) {
  const amount = BigInt(total),
    divisor = BigInt(purchased);
  return Number(
    (amount * BigInt(before + quantity)) / divisor - (amount * BigInt(before)) / divisor,
  );
}

export async function getReturn(db, user, returnId) {
  const result = await one(
    db,
    `SELECT r.*,u.name AS operator,s.number AS sale_number FROM sales_returns r
     JOIN users u ON u.id=r.user_id JOIN sales s ON s.id=r.sale_id
     WHERE r.id=$1 AND r.store_id=$2`,
    [returnId, user.store_id],
  );
  assert(result, 404, 'Return not found.');
  delete result.request_hash;
  result.items = (
    await db.query(
      `SELECT r.*,i.name,i.sku FROM return_items r JOIN sale_items i ON i.id=r.sale_item_id
     WHERE r.return_id=$1 AND r.store_id=$2 ORDER BY i.name`,
      [returnId, user.store_id],
    )
  ).rows;
  if (user.role === 'cashier') {
    delete result.cost_total;
    result.items.forEach((item) => delete item.cost_total);
  }
  return result;
}

export async function addReturnDetails(db, user, sale, at = new Date()) {
  const totals = (
    await db.query(
      `SELECT sale_item_id,SUM(quantity)::int AS returned_quantity,SUM(refund_amount)::int AS refunded_amount
     FROM return_items WHERE store_id=$1 AND sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=$2)
     GROUP BY sale_item_id`,
      [user.store_id, sale.id],
    )
  ).rows;
  const previous = new Map(totals.map((item) => [item.sale_item_id, item]));
  sale.items = allocatePaidAmounts(sale, sale.items).map((item) => {
    const returned = previous.get(item.id);
    return {
      ...item,
      returned_quantity: returned?.returned_quantity || 0,
      refunded_amount: returned?.refunded_amount || 0,
      returnable_quantity: item.quantity - (returned?.returned_quantity || 0),
      refund_remaining: item.paid_total - (returned?.refunded_amount || 0),
    };
  });
  const returns = (
    await db.query(
      'SELECT id FROM sales_returns WHERE store_id=$1 AND sale_id=$2 ORDER BY created_at,id',
      [user.store_id, sale.id],
    )
  ).rows;
  sale.returns = [];
  for (const row of returns) sale.returns.push(await getReturn(db, user, row.id));
  sale.refund_total = sale.returns.reduce((sum, record) => sum + record.total, 0);
  const settings = await one(db, 'SELECT return_conditions FROM store_settings WHERE store_id=$1', [
    user.store_id,
  ]);
  const expiresAt = new Date(new Date(sale.created_at).getTime() + RETURN_WINDOW_HOURS * 3600000);
  const message =
    sale.status !== 'completed'
      ? 'Cancelled transactions cannot be returned.'
      : at > expiresAt
        ? 'The 24-hour return window has expired.'
        : sale.items.every((item) => item.returnable_quantity === 0)
          ? 'All purchased quantities have already been returned.'
          : '';
  sale.return_policy = {
    window_hours: RETURN_WINDOW_HOURS,
    expires_at: expiresAt.toISOString(),
    eligible: !message,
    message,
    conditions: settings.return_conditions,
  };
  return sale;
}

export async function processReturn(db, user, saleId, data, at = new Date()) {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        saleId,
        reason: data.reason,
        items: [...data.items].sort((a, b) => a.sale_item_id.localeCompare(b.sale_item_id)),
      }),
    )
    .digest('hex');
  const returnId = await db.transaction(async (tx) => {
    // Serialize return keys while allowing other transactions' foreign-key reads.
    // FOR UPDATE here could deadlock with checkout holding a product lock before
    // inserting its store reference. The store primary key is never changed.
    await tx.query('SELECT id FROM stores WHERE id=$1 FOR NO KEY UPDATE', [user.store_id]);
    const existing = await one(
      tx,
      'SELECT id,user_id,request_hash FROM sales_returns WHERE store_id=$1 AND idempotency_key=$2',
      [user.store_id, data.idempotency_key],
    );
    if (existing) {
      assert(
        existing.user_id === user.id && existing.request_hash === fingerprint,
        409,
        'This return request key was already used for different details.',
      );
      return existing.id;
    }
    const sale = await one(tx, 'SELECT * FROM sales WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      saleId,
      user.store_id,
    ]);
    assert(sale, 404, 'Sale not found.');
    assert(sale.status === 'completed', 409, 'Cancelled transactions cannot be returned.');
    const age = at.getTime() - new Date(sale.created_at).getTime();
    assert(
      age >= 0 && age <= RETURN_WINDOW_HOURS * 3600000,
      422,
      'The 24-hour return window has expired. Returns must be submitted within 24 hours of the original purchase.',
    );
    const settings = await one(
      tx,
      'SELECT return_conditions FROM store_settings WHERE store_id=$1',
      [user.store_id],
    );
    const conditions = new Map(
      settings.return_conditions.map((condition) => [condition.code, condition]),
    );
    const purchased = allocatePaidAmounts(
      sale,
      (
        await tx.query('SELECT * FROM sale_items WHERE sale_id=$1 AND store_id=$2', [
          saleId,
          user.store_id,
        ])
      ).rows,
    );
    const items = [];
    for (const requested of data.items) {
      const original = purchased.find((item) => item.id === requested.sale_item_id);
      assert(original, 422, 'A selected product was not purchased on this receipt.');
      const condition = conditions.get(requested.condition);
      assert(
        condition?.enabled,
        422,
        'This product condition is not eligible under the store return policy.',
      );
      assert(
        !['damaged', 'defective'].includes(condition.code) || !condition.sellable,
        422,
        'Damaged and defective returns must remain non-sellable.',
      );
      const previous = await one(
        tx,
        'SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM return_items WHERE store_id=$1 AND sale_item_id=$2',
        [user.store_id, original.id],
      );
      assert(
        requested.quantity <= original.quantity - previous.quantity,
        422,
        `Cannot return ${requested.quantity} ${original.name}. Only ${original.quantity - previous.quantity} purchased units remain eligible.`,
      );
      items.push({
        ...requested,
        product_id: original.product_id,
        name: original.name,
        condition_label: condition.label,
        sellable: condition.sellable,
        refund_amount: unitShare(
          original.paid_total,
          previous.quantity,
          requested.quantity,
          original.quantity,
        ),
        tax: unitShare(
          original.tax_total,
          previous.quantity,
          requested.quantity,
          original.quantity,
        ),
        cost_total: condition.sellable ? original.cost_price * requested.quantity : 0,
      });
    }
    const rid = id(),
      number = reference('RT');
    const amounts = items.reduce(
      (sum, item) => ({
        total: sum.total + item.refund_amount,
        tax: sum.tax + item.tax,
        cost_total: sum.cost_total + item.cost_total,
      }),
      { total: 0, tax: 0, cost_total: 0 },
    );
    await tx.query(
      `INSERT INTO sales_returns(id,store_id,sale_id,number,user_id,reason,total,tax,cost_total,idempotency_key,request_hash,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        rid,
        user.store_id,
        saleId,
        number,
        user.id,
        data.reason,
        amounts.total,
        amounts.tax,
        amounts.cost_total,
        data.idempotency_key,
        fingerprint,
        at,
      ],
    );
    for (const item of items.sort((a, b) => a.product_id.localeCompare(b.product_id))) {
      await tx.query(
        `INSERT INTO return_items(id,store_id,return_id,sale_item_id,product_id,quantity,condition,condition_label,sellable,refund_amount,tax,cost_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id(),
          user.store_id,
          rid,
          item.sale_item_id,
          item.product_id,
          item.quantity,
          item.condition,
          item.condition_label,
          item.sellable,
          item.refund_amount,
          item.tax,
          item.cost_total,
        ],
      );
      if (item.sellable)
        await moveStock(tx, user, item.product_id, item.quantity, 'return', data.reason, rid, at);
      else {
        await moveStock(
          tx,
          user,
          item.product_id,
          0,
          'damaged',
          `${item.condition_label}: ${data.reason}`,
          rid,
          at,
          item.quantity,
        );
      }
    }
    if (sale.customer_id && sale.loyalty_earned) {
      const refunded = await one(
        tx,
        'SELECT COALESCE(SUM(total),0)::bigint AS total FROM sales_returns WHERE store_id=$1 AND sale_id=$2',
        [user.store_id, saleId],
      );
      const currentTotal = Number(refunded.total);
      const reversed = sale.total
        ? unitShare(sale.loyalty_earned, currentTotal - amounts.total, amounts.total, sale.total)
        : 0;
      if (reversed)
        await tx.query(
          'UPDATE customers SET loyalty_points=GREATEST(0,loyalty_points-$1) WHERE id=$2 AND store_id=$3',
          [reversed, sale.customer_id, user.store_id],
        );
    }
    await audit(
      tx,
      user,
      'sale.return',
      'sale_return',
      rid,
      `${number}: ${sale.number} — ${data.reason}`,
      amounts,
    );
    return rid;
  });
  return getReturn(db, user, returnId);
}
