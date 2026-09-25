import { id, hashPassword, audit } from '../utils.js';
import { one } from './database.js';
import { completeSale } from '../services/sales.js';
import { createPurchase } from '../services/purchases.js';
export const DEMO_ACCOUNTS = {
  admin: { email: 'owner@suki.store', password: 'SukiOwner2026!' },
  cashier: { email: 'cashier@suki.store', password: 'SukiCashier2026!' },
  manager: { email: 'manager@suki.store', password: 'SukiManager2026!' },
  inventory: { email: 'inventory@suki.store', password: 'SukiInventory2026!' },
};
export async function seed(
  db,
  {
    demo = false,
    email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD,
    name = process.env.ADMIN_NAME?.trim() || 'Store Owner',
  } = {},
) {
  if (await one(db, 'SELECT id FROM stores LIMIT 1')) return;
  if (!demo && (!email || !password || password.length < 12))
    throw new Error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) to initialize the store.',
    );
  const accounts = demo ? Object.entries(DEMO_ACCOUNTS) : [['admin', { email, password }]];
  const hashes = await Promise.all(
    accounts.map(async ([role, a]) => ({ role, ...a, hash: await hashPassword(a.password) })),
  );
  await db.transaction(async (tx) => {
    const store = id();
    await tx.query('INSERT INTO stores(id,name,address,contact) VALUES($1,$2,$3,$4)', [
      store,
      demo ? 'Suki Neighborhood Store' : 'My Store',
      demo ? '123 Mabini Street, Calapan City, Oriental Mindoro' : '',
      demo ? '+63 917 123 4567' : '',
    ]);
    await tx.query('INSERT INTO store_settings(store_id) VALUES($1)', [store]);
    const users = [];
    for (const a of hashes) {
      const user = {
        id: id(),
        store_id: store,
        name: demo
          ? {
              admin: 'Gerald',
              cashier: 'Ana Reyes',
              manager: 'Marco Cruz',
              inventory: 'Liza Garcia',
            }[a.role]
          : name,
        email: a.email.toLowerCase(),
        role: a.role,
      };
      users.push(user);
      await tx.query(
        'INSERT INTO users(id,store_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',
        [user.id, store, user.name, user.email, a.hash, a.role],
      );
    }
    const owner = users[0];
    await audit(tx, owner, 'store.create', 'store', store, 'Store initialized');
    if (!demo) return;
    const cats = [
      ['Beverages', '#47705c'],
      ['Pantry essentials', '#c99d56'],
      ['Snacks', '#d08065'],
      ['Personal care', '#848eb3'],
      ['Household', '#748d9d'],
      ['Fresh & dairy', '#86a266'],
    ].map(([name, color]) => ({ id: id(), name, color }));
    for (const c of cats)
      await tx.query('INSERT INTO categories(id,store_id,name,color) VALUES($1,$2,$3,$4)', [
        c.id,
        store,
        c.name,
        c.color,
      ]);
    const suppliers = [
      ['Metro Wholesale Trading', 'Ramon Dela Cruz', '09171234501', 'sales@suki.store'],
      ['Island Fresh Distribution', 'Maria Garcia', '09171234502', 'hello@suki.store'],
      ['Everyday Essentials Co.', 'Jose Reyes', '09171234503', 'orders@suki.store'],
    ].map(([name, contact_person, phone, email]) => ({
      id: id(),
      name,
      contact_person,
      phone,
      email,
    }));
    for (const s of suppliers)
      await tx.query(
        'INSERT INTO suppliers(id,store_id,name,contact_person,phone,email,address) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [s.id, store, s.name, s.contact_person, s.phone, s.email, 'Calapan City, Oriental Mindoro'],
      );
    const customers = [
      'Maria Santos',
      'Juan Dela Cruz',
      'Isabel Reyes',
      'Carlo Mendoza',
      'Sofia Garcia',
    ].map((name) => ({ id: id(), name }));
    for (const [i, c] of customers.entries())
      await tx.query(
        'INSERT INTO customers(id,store_id,name,phone,email,address) VALUES($1,$2,$3,$4,$5,$6)',
        [
          c.id,
          store,
          c.name,
          `0917123400${i}`,
          `${c.name.split(' ')[0].toLowerCase()}@suki.store`,
          'Calapan City',
        ],
      );
    const catalog = [
      ['Coca-Cola Original 1.5L', 0, 6500, 4900, '🥤'],
      ['Absolute Water 500ml', 0, 2000, 1200, '💧'],
      ['Milo Chocolate Drink 300g', 0, 12500, 9800, '☕'],
      ['Nescafé Classic 50g', 0, 8900, 6800, '☕'],
      ['Jasmine Rice 1kg', 1, 5800, 4400, '🍚'],
      ['Lucky Me! Pancit Canton', 1, 1600, 1150, '🍜'],
      ['Argentina Corned Beef 150g', 1, 4500, 3400, '🥫'],
      ['Silver Swan Soy Sauce 385ml', 1, 2500, 1800, '🍶'],
      ['Piattos Cheese 85g', 2, 3800, 2850, '🥔'],
      ['Oreo Original 137g', 2, 5500, 4100, '🍪'],
      ['SkyFlakes Crackers 250g', 2, 6200, 4700, '🍘'],
      ['Gardenia Classic Bread', 5, 8500, 6500, '🍞'],
      ['Nestlé Fresh Milk 1L', 5, 10500, 8200, '🥛'],
      ['Colgate Toothpaste 100ml', 3, 7500, 5800, '🪥'],
      ['Safeguard Pure White 135g', 3, 4800, 3600, '🧼'],
      ['Joy Dishwashing Liquid 250ml', 4, 6500, 4800, '🫧'],
      ['Ariel Powder Detergent 70g', 4, 1500, 1050, '🧺'],
      ['Fresh Brown Eggs · 6 pack', 5, 6500, 4900, '🥚'],
      ['Kopiko Brown Coffee 10 pack', 0, 7800, 5800, '☕'],
      ['Dole Pineapple Juice 240ml', 0, 3500, 2500, '🍍'],
    ];
    const products = [];
    for (const [i, [name, category, price, cost, emoji]] of catalog.entries()) {
      const p = { id: id(), name, price, cost_price: cost },
        stock = i < 16 ? 160 : [6, 4, 0, 8][i - 16];
      products.push(p);
      await tx.query(
        'INSERT INTO products(id,store_id,name,sku,barcode,category_id,supplier_id,description,cost_price,price,stock,min_stock,unit,emoji) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,10,$12,$13)',
        [
          p.id,
          store,
          name,
          `SKU-${String(i + 1).padStart(4, '0')}`,
          `480000000${String(i + 1).padStart(4, '0')}`,
          cats[category].id,
          suppliers[i % 3].id,
          'An everyday favorite for your neighborhood store.',
          cost,
          price,
          stock,
          'pcs',
          emoji,
        ],
      );
      await tx.query(
        "INSERT INTO inventory_transactions(id,store_id,product_id,user_id,previous_quantity,quantity,new_quantity,type,reason,created_at) VALUES($1,$2,$3,$4,0,$5,$5,'opening','Demo opening stock',$6)",
        [id(), store, p.id, owner.id, stock, new Date(Date.now() - 32 * 86400000)],
      );
    }
    const scoped = { query: (...args) => tx.query(...args), transaction: (fn) => fn(tx) };
    for (let day = 29; day >= 0; day--)
      for (let j = 0; j < 4 + (day % 3); j++) {
        const p = products[(day * 3 + j * 2) % 16],
          q = products[(day * 5 + j * 3 + 1) % 16],
          qty = 1 + (j % 3);
        const total = p.price * qty + q.price;
        const method = ['Cash', 'Cash', 'GCash', 'Maya', 'Bank transfer'][j % 5];
        await completeSale(
          scoped,
          users[j % 2],
          {
            items: [
              { product_id: p.id, quantity: qty },
              { product_id: q.id, quantity: 1 },
            ],
            customer_id: j % 3 === 0 ? customers[j % 5].id : null,
            discount_percent: 0,
            payment_method: method,
            amount_received: method === 'Cash' ? Math.ceil(total / 10000) * 10000 : total,
            payment_reference: '',
            notes: 'Sample transaction',
            idempotency_key: id(),
          },
          new Date(Date.now() - day * 86400000 - j * 1000),
        );
      }
    for (const [description, category, amount, days] of [
      ['Store electricity', 'Electricity', 185000, 3],
      ['Monthly shop rent', 'Rent', 650000, 15],
      ['Restocking delivery', 'Transportation', 25000, 1],
      ['Packaging supplies', 'Supplies', 38000, 0],
    ])
      await tx.query(
        'INSERT INTO expenses(id,store_id,user_id,description,category,amount,expense_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id(),
          store,
          owner.id,
          description,
          category,
          amount,
          new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
          'Sample expense',
        ],
      );
    for (const [name, percent] of [
      ['Suki discount', 5],
      ['Store promotion', 10],
    ])
      await tx.query('INSERT INTO discounts(id,store_id,name,percent) VALUES($1,$2,$3,$4)', [
        id(),
        store,
        name,
        percent,
      ]);
    await createPurchase(scoped, owner, {
      supplier_id: suppliers[0].id,
      items: [
        { product_id: products[16].id, quantity: 48, cost_price: 1050 },
        { product_id: products[18].id, quantity: 24, cost_price: 5800 },
      ],
      purchase_date: new Date().toISOString().slice(0, 10),
      payment_status: 'unpaid',
      notes: 'Restocking low-stock favorites',
    });
  });
}
