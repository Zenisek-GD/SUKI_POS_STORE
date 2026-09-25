import { id, reference, assert, audit } from '../utils.js';
import { one } from '../models/database.js';
import { moveStock } from './inventory.js';
export const createPurchase = (db, user, data) =>
  db.transaction(async (tx) => {
    assert(
      await one(tx, 'SELECT id FROM suppliers WHERE id=$1 AND store_id=$2', [
        data.supplier_id,
        user.store_id,
      ]),
      422,
      'Supplier not found.',
    );
    const total = data.items.reduce((s, i) => s + i.cost_price * i.quantity, 0);
    assert(total <= 2_000_000_000, 422, 'Purchase exceeds the supported amount.');
    assert(
      new Set(data.items.map((i) => i.product_id)).size === data.items.length,
      422,
      'Combine duplicate products into one line.',
    );
    const pid = id(),
      num = reference('PO');
    for (const i of data.items)
      assert(
        await one(tx, 'SELECT id FROM products WHERE id=$1 AND store_id=$2 AND active=true', [
          i.product_id,
          user.store_id,
        ]),
        422,
        'Product not found.',
      );
    await tx.query(
      'INSERT INTO purchases(id,store_id,number,supplier_id,user_id,total,purchase_date,payment_status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        pid,
        user.store_id,
        num,
        data.supplier_id,
        user.id,
        total,
        data.purchase_date,
        data.payment_status,
        data.notes,
      ],
    );
    for (const i of data.items)
      await tx.query(
        'INSERT INTO purchase_items(id,store_id,purchase_id,product_id,quantity,cost_price) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), user.store_id, pid, i.product_id, i.quantity, i.cost_price],
      );
    await audit(tx, user, 'purchase.create', 'purchase', pid, `${num} created`);
    return { id: pid, number: num };
  });
export const receivePurchase = (db, user, pid) =>
  db.transaction(async (tx) => {
    const p = await one(tx, 'SELECT * FROM purchases WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      pid,
      user.store_id,
    ]);
    assert(p, 404, 'Purchase not found.');
    assert(p.receiving_status === 'pending', 409, 'This purchase has already been received.');
    const items = (
      await tx.query(
        'SELECT * FROM purchase_items WHERE purchase_id=$1 AND store_id=$2 ORDER BY product_id',
        [pid, user.store_id],
      )
    ).rows;
    for (const i of items) {
      await moveStock(tx, user, i.product_id, i.quantity, 'purchase', p.number, pid);
      await tx.query('UPDATE products SET cost_price=$1 WHERE id=$2 AND store_id=$3', [
        i.cost_price,
        i.product_id,
        user.store_id,
      ]);
    }
    await tx.query(
      "UPDATE purchases SET receiving_status='received',received_at=now() WHERE id=$1 AND store_id=$2",
      [pid, user.store_id],
    );
    await audit(
      tx,
      user,
      'purchase.receive',
      'purchase',
      pid,
      `${p.number} received into inventory`,
    );
    return { ok: true };
  });
