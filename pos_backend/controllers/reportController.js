import { schemas } from '../validation.js';
import { one } from '../models/database.js';
export const reportController = (db) => async (req, res) => {
  const { from, to } = schemas.range.parse(req.query),
    store = req.user.store_id;
  const settings = await one(
    db,
    'SELECT timezone,low_stock_threshold FROM store_settings WHERE store_id=$1',
    [store],
  );
  const args = [store, from, to, settings.timezone],
    filter =
      "s.store_id=$1 AND s.status='completed' AND (s.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date";
  const summary = await one(
    db,
    `SELECT COUNT(*)::int AS transactions,COALESCE(SUM(subtotal),0)::bigint AS gross_sales,COALESCE(SUM(discount),0)::bigint AS discounts,COALESCE(SUM(tax),0)::bigint AS tax,COALESCE(SUM(total),0)::bigint AS sales,COALESCE(SUM(cost_total),0)::bigint AS cost FROM sales s WHERE ${filter}`,
    args,
  );
  const expenses = (
    await db.query(
      'SELECT * FROM expenses WHERE store_id=$1 AND expense_date BETWEEN $2::date AND $3::date ORDER BY expense_date DESC',
      args.slice(0, 3),
    )
  ).rows;
  const purchases = (
    await db.query(
      'SELECT p.*,s.name AS supplier FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.store_id=$1 AND p.purchase_date BETWEEN $2::date AND $3::date ORDER BY p.purchase_date DESC',
      args.slice(0, 3),
    )
  ).rows;
  const daily = (
    await db.query(
      `SELECT to_char(s.created_at AT TIME ZONE $4,'YYYY-MM-DD') AS date,SUM(s.total)::bigint AS total,COUNT(*)::int AS transactions FROM sales s WHERE ${filter} GROUP BY 1 ORDER BY 1`,
      args,
    )
  ).rows;
  const categories = (
    await db.query(
      `SELECT i.category_name AS name,SUM(ROUND(i.total::numeric*(s.total-s.tax)/NULLIF(s.subtotal,0)))::bigint AS total,SUM(i.quantity)::int AS quantity FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE ${filter} GROUP BY i.category_name ORDER BY total DESC`,
      args,
    )
  ).rows;
  const products = (
    await db.query(
      `SELECT i.product_id,i.name,p.emoji,p.image_url,SUM(i.quantity)::int AS quantity,SUM(i.total)::bigint AS gross_sales,SUM(ROUND(i.total::numeric*(s.total-s.tax)/NULLIF(s.subtotal,0)))::bigint AS total FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE ${filter} GROUP BY i.product_id,i.name,p.emoji,p.image_url ORDER BY quantity DESC`,
      args,
    )
  ).rows;
  const payments = (
    await db.query(
      `SELECT p.method AS name,SUM(p.amount)::bigint AS total,COUNT(*)::int AS transactions FROM payments p JOIN sales s ON s.id=p.sale_id WHERE ${filter} GROUP BY p.method ORDER BY total DESC`,
      args,
    )
  ).rows;
  const cashiers = (
    await db.query(
      `SELECT u.name,COUNT(*)::int AS transactions,SUM(s.total)::bigint AS total FROM sales s JOIN users u ON u.id=s.user_id WHERE ${filter} GROUP BY u.id,u.name ORDER BY total DESC`,
      args,
    )
  ).rows;
  const inventory = (
    await db.query(
      'SELECT p.name,p.sku,p.stock,COALESCE(p.min_stock,$2) AS min_stock,p.cost_price,p.price,p.stock*p.cost_price::bigint AS value,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.store_id=$1 AND p.active=true ORDER BY p.stock,p.name',
      [store, settings.low_stock_threshold],
    )
  ).rows;
  const movements = (
    await db.query(
      'SELECT p.name AS product,m.previous_quantity,m.quantity,m.new_quantity,m.type,m.reason,u.name AS user_name,m.created_at FROM inventory_transactions m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id WHERE m.store_id=$1 AND (m.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date ORDER BY m.created_at DESC',
      args,
    )
  ).rows;
  const transactions = (
    await db.query(
      `SELECT s.number,s.created_at,u.name AS cashier,s.subtotal,s.discount,s.tax,s.total,p.method AS payment_method FROM sales s JOIN users u ON u.id=s.user_id JOIN payments p ON p.sale_id=s.id WHERE ${filter} ORDER BY s.created_at DESC`,
      args,
    )
  ).rows;
  for (const key of Object.keys(summary)) summary[key] = Number(summary[key]);
  summary.expenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  summary.profit = summary.sales - summary.tax - summary.cost - summary.expenses;
  summary.total_products = inventory.length;
  summary.low_stock = inventory.filter((p) => p.stock > 0 && p.stock <= p.min_stock).length;
  summary.out_of_stock = inventory.filter((p) => p.stock === 0).length;
  res.json({
    from,
    to,
    summary,
    daily,
    categories,
    products,
    payments,
    cashiers,
    inventory,
    movements,
    expenses,
    purchases,
    transactions,
  });
};
