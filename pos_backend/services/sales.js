import { id, reference, assert, audit, totals } from '../utils.js';
import { one } from '../models/database.js';
import { moveStock } from './inventory.js';
export async function getSale(db, user, saleId) {
  const sale = await one(
    db,
    `SELECT s.*,u.name AS cashier,c.name AS customer,p.method AS payment_method,p.reference AS payment_reference
 FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id JOIN payments p ON p.sale_id=s.id WHERE s.id=$1 AND s.store_id=$2`,
    [saleId, user.store_id],
  );
  assert(sale && (user.role !== 'cashier' || sale.user_id === user.id), 404, 'Sale not found.');
  sale.items = (
    await db.query('SELECT * FROM sale_items WHERE sale_id=$1 AND store_id=$2 ORDER BY name', [
      saleId,
      user.store_id,
    ])
  ).rows;
  if (user.role === 'cashier') {
    delete sale.cost_total;
    sale.items.forEach((i) => delete i.cost_price);
  }
  return sale;
}
export async function completeSale(db, user, data, at = new Date()) {
  const saleId = await db.transaction(async (tx) => {
    // A cashier lock makes idempotency keys safe even if a checkout is retried concurrently.
    await tx.query('SELECT id FROM users WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      user.id,
      user.store_id,
    ]);
    const existing = await one(
      tx,
      'SELECT id,user_id FROM sales WHERE store_id=$1 AND idempotency_key=$2',
      [user.store_id, data.idempotency_key],
    );
    if (existing) {
      assert(existing.user_id === user.id, 409, 'Checkout key already used.');
      return existing.id;
    }
    const settings = await one(
      tx,
      'SELECT ss.*,s.name,s.address,s.contact FROM store_settings ss JOIN stores s ON s.id=ss.store_id WHERE ss.store_id=$1',
      [user.store_id],
    );
    assert(
      settings.payment_methods.includes(data.payment_method),
      422,
      'This payment method is not enabled.',
    );
    assert(
      user.role !== 'cashier' || data.discount_percent <= Number(settings.cashier_discount_limit),
      403,
      `Cashiers can apply discounts up to ${settings.cashier_discount_limit}%.`,
    );
    if (data.customer_id)
      assert(
        await one(tx, 'SELECT id FROM customers WHERE id=$1 AND store_id=$2', [
          data.customer_id,
          user.store_id,
        ]),
        422,
        'Customer not found.',
      );
    const quantities = new Map();
    for (const i of data.items)
      quantities.set(i.product_id, (quantities.get(i.product_id) || 0) + i.quantity);
    const items = [];
    // Stable lock order prevents deadlocks against other sales or purchase receiving.
    for (const [productId, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
      const p = await one(
        tx,
        'SELECT p.*,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND p.store_id=$2 FOR UPDATE OF p',
        [productId, user.store_id],
      );
      assert(p?.active, 422, 'A product is no longer available.');
      assert(
        p.stock >= quantity,
        409,
        `Not enough stock for ${p.name}. Only ${p.stock} available.`,
      );
      items.push({ ...p, quantity, unit_price: p.price });
    }
    const amounts = totals(
      items,
      data.discount_percent,
      Number(settings.tax_rate),
      settings.tax_inclusive,
    );
    assert(data.amount_received >= amounts.total, 422, 'Amount received is less than the total.');
    assert(
      data.payment_method === 'Cash' || data.amount_received === amounts.total,
      422,
      'Non-cash payment must match the total.',
    );
    const sid = id(),
      num = reference('SK'),
      earned = settings.loyalty_enabled && data.customer_id ? Math.floor(amounts.total / 10000) : 0;
    const cost = items.reduce((sum, i) => sum + i.cost_price * i.quantity, 0);
    assert(cost <= 2_000_000_000, 422, 'Transaction cost exceeds the supported amount.');
    await tx.query(
      `INSERT INTO sales(id,store_id,number,user_id,customer_id,subtotal,discount,discount_percent,tax,total,cost_total,amount_received,change,loyalty_earned,notes,receipt_store,idempotency_key,created_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        sid,
        user.store_id,
        num,
        user.id,
        data.customer_id,
        amounts.subtotal,
        amounts.discount,
        data.discount_percent,
        amounts.tax,
        amounts.total,
        cost,
        data.amount_received,
        data.amount_received - amounts.total,
        earned,
        data.notes || '',
        JSON.stringify(settings),
        data.idempotency_key,
        at,
      ],
    );
    for (const i of items) {
      await tx.query(
        'INSERT INTO sale_items(id,store_id,sale_id,product_id,name,sku,category_name,quantity,unit_price,cost_price,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id(),
          user.store_id,
          sid,
          i.id,
          i.name,
          i.sku,
          i.category_name || 'Uncategorized',
          i.quantity,
          i.price,
          i.cost_price,
          i.price * i.quantity,
        ],
      );
      await moveStock(tx, user, i.id, -i.quantity, 'sale', num, sid, at);
    }
    await tx.query(
      'INSERT INTO payments(id,store_id,sale_id,method,amount,reference,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id(),
        user.store_id,
        sid,
        data.payment_method,
        amounts.total,
        data.payment_reference || '',
        at,
      ],
    );
    if (earned)
      await tx.query(
        'UPDATE customers SET loyalty_points=loyalty_points+$1 WHERE id=$2 AND store_id=$3',
        [earned, data.customer_id, user.store_id],
      );
    await audit(
      tx,
      user,
      data.discount_percent ? 'sale.discount' : 'sale.complete',
      'sale',
      sid,
      `${num} completed${data.discount_percent ? ` with ${data.discount_percent}% discount` : ''}`,
      amounts,
    );
    return sid;
  });
  return getSale(db, user, saleId);
}
export async function cancelSale(db, user, saleId, reason) {
  await db.transaction(async (tx) => {
    const sale = await one(tx, 'SELECT * FROM sales WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      saleId,
      user.store_id,
    ]);
    assert(sale, 404, 'Sale not found.');
    assert(sale.status === 'completed', 409, 'This sale was already cancelled.');
    const items = (
      await tx.query(
        'SELECT * FROM sale_items WHERE sale_id=$1 AND store_id=$2 ORDER BY product_id',
        [saleId, user.store_id],
      )
    ).rows;
    for (const i of items)
      await moveStock(tx, user, i.product_id, i.quantity, 'cancellation', reason, saleId);
    await tx.query(
      "UPDATE sales SET status='cancelled',cancel_reason=$1,cancelled_at=now() WHERE id=$2 AND store_id=$3",
      [reason, saleId, user.store_id],
    );
    if (sale.customer_id && sale.loyalty_earned)
      await tx.query(
        'UPDATE customers SET loyalty_points=GREATEST(0,loyalty_points-$1) WHERE id=$2 AND store_id=$3',
        [sale.loyalty_earned, sale.customer_id, user.store_id],
      );
    await audit(tx, user, 'sale.cancel', 'sale', saleId, `${sale.number}: ${reason}`);
  });
  return getSale(db, user, saleId);
}
