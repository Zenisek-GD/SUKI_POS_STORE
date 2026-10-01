import { id, assert, audit } from '../utils.js';
import { one } from '../models/database.js';
// Must run inside a transaction; a row lock serializes concurrent changes.
export async function moveStock(
  tx,
  user,
  productId,
  delta,
  type,
  reason,
  referenceId = null,
  at = new Date(),
  nonSellableQuantity = 0,
) {
  const p = await one(tx, 'SELECT * FROM products WHERE id=$1 AND store_id=$2 FOR UPDATE', [
    productId,
    user.store_id,
  ]);
  assert(p, 404, 'Product not found.');
  const next = p.stock + delta;
  assert(next >= 0, 409, `Not enough stock for ${p.name}. Only ${p.stock} available.`);
  assert(next <= 2_000_000_000, 422, 'Stock exceeds the supported quantity.');
  assert(
    p.non_sellable_stock + nonSellableQuantity <= 2_000_000_000,
    422,
    'Non-sellable stock exceeds the supported quantity.',
  );
  await tx.query(
    'UPDATE products SET stock=$1,non_sellable_stock=non_sellable_stock+$4,updated_at=now() WHERE id=$2 AND store_id=$3',
    [next, productId, user.store_id, nonSellableQuantity],
  );
  await tx.query(
    'INSERT INTO inventory_transactions(id,store_id,product_id,user_id,previous_quantity,quantity,new_quantity,type,reason,reference_id,created_at,non_sellable_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      id(),
      user.store_id,
      productId,
      user.id,
      p.stock,
      delta,
      next,
      type,
      reason,
      referenceId,
      at,
      nonSellableQuantity,
    ],
  );
  return { ...p, stock: next, non_sellable_stock: p.non_sellable_stock + nonSellableQuantity };
}
export const adjustStock = (db, user, data) =>
  db.transaction(async (tx) => {
    const negative =
      ['stock_out', 'damaged'].includes(data.type) ||
      (data.type === 'adjustment' && data.direction === 'remove');
    const p = await moveStock(
      tx,
      user,
      data.product_id,
      data.quantity * (negative ? -1 : 1),
      data.type,
      data.reason,
      null,
      new Date(),
      data.type === 'damaged' ? data.quantity : 0,
    );
    await audit(
      tx,
      user,
      'inventory.adjust',
      'product',
      p.id,
      `${p.name}: ${negative ? '-' : '+'}${data.quantity} (${data.reason})`,
    );
    return p;
  });
