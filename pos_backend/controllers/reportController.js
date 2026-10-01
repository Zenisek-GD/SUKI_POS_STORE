import { schemas } from '../validation.js';
import { one } from '../models/database.js';
import { allocatePaidAmounts } from '../services/returns.js';
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
      "s.store_id=$1 AND s.status='completed' AND (s.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date",
    returnFilter =
      "r.store_id=$1 AND s.status='completed' AND (r.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date";
  const summary = await one(
    db,
    `SELECT COUNT(*)::int AS transactions,COALESCE(SUM(subtotal),0)::bigint AS gross_sales,COALESCE(SUM(discount),0)::bigint AS discounts,COALESCE(SUM(tax),0)::bigint AS tax,COALESCE(SUM(total),0)::bigint AS sales,COALESCE(SUM(cost_total),0)::bigint AS cost FROM sales s WHERE ${filter}`,
    args,
  );
  const refunds = await one(
    db,
    `SELECT COALESCE(SUM(r.total),0)::bigint AS refunds,COALESCE(SUM(r.tax),0)::bigint AS refund_tax,
      COALESCE(SUM(r.cost_total),0)::bigint AS returned_cost,COUNT(*)::int AS return_transactions
      FROM sales_returns r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id WHERE ${returnFilter}`,
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
      `SELECT date,SUM(total)::bigint AS total,SUM(refunds)::bigint AS refunds,SUM(transactions)::int AS transactions FROM (
        SELECT to_char(s.created_at AT TIME ZONE $4,'YYYY-MM-DD') AS date,s.total,0 AS refunds,1 AS transactions FROM sales s WHERE ${filter}
        UNION ALL SELECT to_char(r.created_at AT TIME ZONE $4,'YYYY-MM-DD'),-r.total,r.total,0 FROM sales_returns r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id WHERE ${returnFilter}
      ) events GROUP BY date ORDER BY date`,
      args,
    )
  ).rows;
  const soldLines = (
    await db.query(
      `SELECT i.*,s.subtotal,s.discount,s.tax,s.receipt_store,p.emoji,p.image_url
      FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id
      WHERE ${filter} ORDER BY s.id,i.id`,
      args,
    )
  ).rows;
  const returnedLines = (
    await db.query(
      `SELECT i.product_id,i.name,i.category_name,p.emoji,p.image_url,-ri.quantity AS quantity,
        -(ri.refund_amount-ri.tax) AS total
        FROM return_items ri JOIN sales_returns r ON r.id=ri.return_id
        JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id
        JOIN sale_items i ON i.id=ri.sale_item_id JOIN products p ON p.id=i.product_id WHERE ${returnFilter}`,
      args,
    )
  ).rows;
  const saleGroups = new Map(),
    categoryTotals = new Map(),
    productTotals = new Map();
  for (const item of soldLines) {
    if (!saleGroups.has(item.sale_id)) saleGroups.set(item.sale_id, []);
    saleGroups.get(item.sale_id).push(item);
  }
  const addLine = (line, grossSales, netSales) => {
    const category = categoryTotals.get(line.category_name) || {
      name: line.category_name,
      total: 0,
      quantity: 0,
    };
    category.total += netSales;
    category.quantity += line.quantity;
    categoryTotals.set(line.category_name, category);
    const key = `${line.product_id}:${line.name}`;
    const product = productTotals.get(key) || {
      product_id: line.product_id,
      name: line.name,
      emoji: line.emoji,
      image_url: line.image_url,
      quantity: 0,
      gross_sales: 0,
      total: 0,
    };
    product.quantity += line.quantity;
    product.gross_sales += grossSales;
    product.total += netSales;
    productTotals.set(key, product);
  };
  // Use exactly the receipt allocation used by returns, including residual cents.
  for (const items of saleGroups.values()) {
    for (const item of allocatePaidAmounts(items[0], items))
      addLine(item, item.total, item.paid_total - item.tax_total);
  }
  for (const item of returnedLines) addLine(item, 0, item.total);
  const categories = [...categoryTotals.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const products = [...productTotals.values()].sort(
    (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name),
  );
  const payments = (
    await db.query(
      `SELECT name,SUM(total)::bigint AS total,SUM(transactions)::int AS transactions FROM (
        SELECT p.method AS name,p.amount AS total,1 AS transactions FROM payments p JOIN sales s ON s.id=p.sale_id WHERE ${filter}
        UNION ALL SELECT p.method,-r.total,0 FROM sales_returns r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id JOIN payments p ON p.sale_id=s.id WHERE ${returnFilter}
      ) events GROUP BY name ORDER BY total DESC`,
      args,
    )
  ).rows;
  const cashiers = (
    await db.query(
      `SELECT u.name,SUM(e.transactions)::int AS transactions,SUM(e.total)::bigint AS total FROM (
        SELECT s.user_id,1 AS transactions,s.total FROM sales s WHERE ${filter}
        UNION ALL SELECT s.user_id,0,-r.total FROM sales_returns r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id WHERE ${returnFilter}
      ) e JOIN users u ON u.id=e.user_id GROUP BY u.id,u.name ORDER BY total DESC`,
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
      'SELECT p.name AS product,m.previous_quantity,m.quantity,m.new_quantity,m.type,m.reason,u.name AS user_name,m.created_at FROM inventory_transactions m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id WHERE m.store_id=$1 AND (m.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date ORDER BY m.created_at DESC,m.sequence DESC',
      args,
    )
  ).rows;
  const transactions = (
    await db.query(
      `SELECT s.number,s.created_at,u.name AS cashier,s.subtotal,s.discount,s.tax,s.total,p.method AS payment_method FROM sales s JOIN users u ON u.id=s.user_id JOIN payments p ON p.sale_id=s.id WHERE ${filter} ORDER BY s.created_at DESC`,
      args,
    )
  ).rows;
  const returns = (
    await db.query(
      `SELECT r.number,s.number AS original_receipt,r.created_at,u.name AS operator,r.reason,r.total,r.tax,r.cost_total
      FROM sales_returns r JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id JOIN users u ON u.id=r.user_id WHERE ${returnFilter} ORDER BY r.created_at DESC,r.id`,
      args,
    )
  ).rows;
  for (const key of Object.keys(summary)) summary[key] = Number(summary[key]);
  for (const key of Object.keys(refunds)) summary[key] = Number(refunds[key]);
  summary.collected_sales = summary.sales;
  summary.sales -= summary.refunds;
  summary.tax -= summary.refund_tax;
  summary.cost -= summary.returned_cost;
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
    returns,
    basis:
      'Sales and profit deduct linked refunds on their processing date in the store timezone. Only sellable returns reverse cost of goods. Original transaction rows remain unchanged.',
  });
};
