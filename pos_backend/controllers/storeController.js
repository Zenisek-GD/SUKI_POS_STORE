import { one } from '../models/database.js';
import { schemas, parseId } from '../validation.js';
import { id, audit, assert, hashPassword, publicUser } from '../utils.js';
const definitions = {
  products: { schema: 'product', roles: ['admin', 'manager', 'inventory'] },
  categories: { schema: 'category', roles: ['admin', 'manager', 'inventory'] },
  suppliers: { schema: 'supplier', roles: ['admin', 'manager', 'inventory'] },
  customers: { schema: 'customer', roles: ['admin', 'manager', 'cashier'] },
  expenses: { schema: 'expense', roles: ['admin', 'manager'] },
  discounts: { schema: 'discount', roles: ['admin'] },
  users: { schema: 'user', roles: ['admin'] },
};
export function storeController(db) {
  return {
    async bootstrap(req, res) {
      const store = req.user.store_id,
        role = req.user.role;
      const settings = await one(
        db,
        'SELECT ss.*,s.name,s.address,s.contact FROM store_settings ss JOIN stores s ON s.id=ss.store_id WHERE ss.store_id=$1',
        [store],
      );
      const result = { settings, user: publicUser(req.user) };
      const queries = {
        products:
          'SELECT p.*,c.name AS category,c.color AS category_color,s.name AS supplier FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.store_id=$1 ORDER BY p.name',
        categories: 'SELECT * FROM categories WHERE store_id=$1 ORDER BY name',
        discounts: 'SELECT * FROM discounts WHERE store_id=$1 ORDER BY name',
      };
      if (role !== 'inventory')
        queries.customers =
          "SELECT c.*,(SELECT COUNT(*)::int FROM sales s WHERE s.customer_id=c.id AND s.status='completed') AS visits,(SELECT COALESCE(SUM(total),0)::bigint FROM sales s WHERE s.customer_id=c.id AND s.status='completed') AS total_spent FROM customers c WHERE c.store_id=$1 ORDER BY c.name";
      if (role !== 'cashier') {
        queries.suppliers =
          'SELECT s.*,(SELECT COUNT(*)::int FROM products p WHERE p.supplier_id=s.id AND p.active=true) AS product_count FROM suppliers s WHERE s.store_id=$1 ORDER BY s.name';
        queries.purchases =
          'SELECT p.*,s.name AS supplier,u.name AS created_by FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN users u ON u.id=p.user_id WHERE p.store_id=$1 ORDER BY p.created_at DESC LIMIT 1000';
      }
      if (['admin', 'manager'].includes(role))
        queries.expenses =
          'SELECT e.*,u.name AS created_by FROM expenses e JOIN users u ON u.id=e.user_id WHERE e.store_id=$1 ORDER BY e.expense_date DESC LIMIT 1000';
      if (role === 'admin')
        queries.users =
          'SELECT id,name,email,role,active,created_at FROM users WHERE store_id=$1 ORDER BY name';
      for (const [key, sql] of Object.entries(queries))
        result[key] = (await db.query(sql, [store])).rows;
      if (role === 'cashier')
        result.products.forEach((p) => {
          delete p.cost_price;
          delete p.supplier_id;
          delete p.supplier;
        });
      res.json(result);
    },
    async save(req, res) {
      const table = req.params.entity,
        definition = definitions[table];
      assert(definition, 404, 'Resource not found.');
      assert(
        definition.roles.includes(req.user.role),
        403,
        'Your role does not have access to this action.',
      );
      const values = schemas[definition.schema].parse(req.body),
        recordId = req.params.id ? parseId(req.params.id) : id(),
        updating = Boolean(req.params.id);
      await db.transaction(async (tx) => {
        if (table === 'users')
          await tx.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE', [req.user.store_id]);
        const existing = updating
          ? await one(tx, `SELECT * FROM ${table} WHERE id=$1 AND store_id=$2 FOR UPDATE`, [
              recordId,
              req.user.store_id,
            ])
          : null;
        assert(!updating || existing, 404, 'Record not found.');
        if (table === 'products') {
          if (updating) delete values.stock;
          for (const [field, target] of [
            ['category_id', 'categories'],
            ['supplier_id', 'suppliers'],
          ])
            if (values[field])
              assert(
                await one(tx, `SELECT id FROM ${target} WHERE id=$1 AND store_id=$2`, [
                  values[field],
                  req.user.store_id,
                ]),
                422,
                `Invalid ${field.replace('_id', '')}.`,
              );
        }
        if (table === 'users') {
          assert(
            updating || values.password,
            422,
            'A password of at least 12 characters is required.',
          );
          if (recordId === req.user.id)
            assert(
              values.active && values.role === 'admin',
              422,
              'You cannot disable or demote your own admin account.',
            );
          if (
            existing?.role === 'admin' &&
            existing.active &&
            (!values.active || values.role !== 'admin')
          ) {
            const count = await one(
              tx,
              "SELECT COUNT(*)::int AS count FROM users WHERE store_id=$1 AND role='admin' AND active=true",
              [req.user.store_id],
            );
            assert(count.count > 1, 422, 'Keep at least one active administrator.');
          }
          if (values.password) values.password_hash = await hashPassword(values.password);
          delete values.password;
        }
        if (table === 'expenses' && !updating) values.user_id = req.user.id;
        const columns = Object.keys(values),
          parameters = Object.values(values);
        // All SQL identifiers are selected from fixed, validated schemas; values use parameters.
        if (updating)
          await tx.query(
            `UPDATE ${table} SET ${columns.map((c, i) => `${c}=$${i + 1}`).join(',')}${table === 'products' ? ',updated_at=now()' : ''} WHERE id=$${columns.length + 1} AND store_id=$${columns.length + 2}`,
            [...parameters, recordId, req.user.store_id],
          );
        else
          await tx.query(
            `INSERT INTO ${table}(id,store_id,${columns.join(',')}) VALUES($1,$2,${columns.map((_, i) => `$${i + 3}`).join(',')})`,
            [recordId, req.user.store_id, ...parameters],
          );
        if (table === 'products' && !updating)
          await tx.query(
            "INSERT INTO inventory_transactions(id,store_id,product_id,user_id,previous_quantity,quantity,new_quantity,type,reason) VALUES($1,$2,$3,$4,0,$5,$5,'opening','Opening stock')",
            [id(), req.user.store_id, recordId, req.user.id, values.stock],
          );
        if (
          table === 'users' &&
          updating &&
          (values.password_hash || !values.active || existing.role !== values.role)
        )
          await tx.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [recordId]);
        const details =
          table === 'products' && existing
            ? {
                previous_price: existing.price,
                price: values.price,
                previous_cost: existing.cost_price,
                cost: values.cost_price,
              }
            : {};
        await audit(
          tx,
          req.user,
          `${table}.${updating ? 'update' : 'create'}`,
          table,
          recordId,
          `${values.name || values.description} ${updating ? 'updated' : 'created'}`,
          details,
        );
      });
      res.status(updating ? 200 : 201).json({ id: recordId });
    },
    async archive(req, res) {
      const productId = parseId(req.params.id);
      await db.transaction(async (tx) => {
        const p = await one(
          tx,
          'UPDATE products SET active=false,updated_at=now() WHERE id=$1 AND store_id=$2 RETURNING name',
          [productId, req.user.store_id],
        );
        assert(p, 404, 'Product not found.');
        await audit(tx, req.user, 'product.archive', 'product', productId, `${p.name} archived`);
      });
      res.json({ ok: true });
    },
    async settings(req, res) {
      const data = schemas.settings.parse(req.body);
      await db.transaction(async (tx) => {
        const { name, address, contact, ...settings } = data;
        const previous = await one(
          tx,
          'SELECT currency FROM store_settings WHERE store_id=$1 FOR UPDATE',
          [req.user.store_id],
        );
        if (previous.currency !== settings.currency) {
          const activity = await one(
            tx,
            'SELECT (SELECT COUNT(*) FROM sales WHERE store_id=$1)+(SELECT COUNT(*) FROM expenses WHERE store_id=$1)+(SELECT COUNT(*) FROM purchases WHERE store_id=$1) AS count',
            [req.user.store_id],
          );
          assert(
            Number(activity.count) === 0,
            422,
            'Currency cannot change after financial activity. Create a new store for another currency.',
          );
        }
        await tx.query('UPDATE stores SET name=$1,address=$2,contact=$3 WHERE id=$4', [
          name,
          address,
          contact,
          req.user.store_id,
        ]);
        const columns = Object.keys(settings);
        await tx.query(
          `UPDATE store_settings SET ${columns.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE store_id=$${columns.length + 1}`,
          [
            ...Object.values(settings).map((v) => (Array.isArray(v) ? JSON.stringify(v) : v)),
            req.user.store_id,
          ],
        );
        await audit(
          tx,
          req.user,
          'settings.update',
          'store',
          req.user.store_id,
          'Store settings updated',
        );
      });
      res.json({ ok: true });
    },
    async movements(req, res) {
      const product = req.query.product_id ? parseId(req.query.product_id) : null;
      res.json(
        (
          await db.query(
            'SELECT m.*,p.name AS product,p.emoji,u.name AS user_name FROM inventory_transactions m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id WHERE m.store_id=$1 AND ($2::uuid IS NULL OR m.product_id=$2) ORDER BY m.created_at DESC LIMIT 1000',
            [req.user.store_id, product],
          )
        ).rows,
      );
    },
    async audit(req, res) {
      res.json(
        (
          await db.query(
            'SELECT a.*,u.name AS user_name FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE a.store_id=$1 ORDER BY a.created_at DESC LIMIT 1000',
            [req.user.store_id],
          )
        ).rows,
      );
    },
    async purchaseItems(req, res) {
      res.json(
        (
          await db.query(
            'SELECT i.*,p.name,p.emoji FROM purchase_items i JOIN products p ON p.id=i.product_id WHERE i.store_id=$1 AND i.purchase_id=$2 ORDER BY p.name',
            [req.user.store_id, parseId(req.params.id)],
          )
        ).rows,
      );
    },
    async purchasePayment(req, res) {
      const status = schemas.purchase.shape.payment_status.parse(req.body.payment_status),
        pid = parseId(req.params.id);
      await db.transaction(async (tx) => {
        assert(
          await one(
            tx,
            'UPDATE purchases SET payment_status=$1 WHERE id=$2 AND store_id=$3 RETURNING id',
            [status, pid, req.user.store_id],
          ),
          404,
          'Purchase not found.',
        );
        await audit(tx, req.user, 'purchase.payment', 'purchase', pid, `Purchase marked ${status}`);
      });
      res.json({ ok: true });
    },
    async sales(req, res) {
      const customer = req.query.customer_id ? parseId(req.query.customer_id) : null,
        cashier = req.user.role === 'cashier' ? req.user.id : null;
      res.json(
        (
          await db.query(
            `SELECT s.id,s.number,s.user_id,s.customer_id,s.subtotal,s.discount,s.tax,s.total,s.status,s.created_at,u.name AS cashier,c.name AS customer,p.method AS payment_method,(SELECT SUM(quantity)::int FROM sale_items WHERE sale_id=s.id) AS item_count
  FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id JOIN payments p ON p.sale_id=s.id WHERE s.store_id=$1 AND ($2::uuid IS NULL OR s.user_id=$2) AND ($3::uuid IS NULL OR s.customer_id=$3) ORDER BY s.created_at DESC LIMIT 1000`,
            [req.user.store_id, cashier, customer],
          )
        ).rows,
      );
    },
  };
}
