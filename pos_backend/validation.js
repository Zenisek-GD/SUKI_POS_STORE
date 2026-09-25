import { z } from 'zod';
const text = z.string().trim().max(250),
  optional = text.default(''),
  uuid = z.string().uuid(),
  nullable = uuid.nullable().default(null);
const money = z.number().int().min(0).max(100_000_000),
  quantity = z.number().int().min(1).max(1_000_000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    'Enter a valid date',
  );
const image = z
  .string()
  .max(2000)
  .refine((s) => !s || /^https?:\/\//i.test(s), 'Use an http or https image URL')
  .default('');
const email = z.union([z.string().email().max(250), z.literal('')]).default('');
export const schemas = {
  login: z.object({
    email: z
      .string()
      .email()
      .max(250)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(72),
  }),
  product: z.object({
    name: text.min(1),
    sku: text.min(1),
    barcode: text
      .nullable()
      .default(null)
      .transform((s) => s || null),
    category_id: nullable,
    supplier_id: nullable,
    description: z.string().trim().max(2000).default(''),
    cost_price: money,
    price: money,
    stock: z.number().int().min(0).max(1_000_000).default(0),
    min_stock: z.number().int().min(0).max(1_000_000).nullable().default(null),
    unit: text.min(1).default('pcs'),
    image_url: image,
    emoji: z.string().max(16).default('📦'),
    active: z.boolean().default(true),
  }),
  category: z.object({
    name: text.min(1),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .default('#2b7059'),
  }),
  supplier: z.object({
    name: text.min(1),
    contact_person: optional,
    phone: optional,
    email,
    address: z.string().trim().max(500).default(''),
  }),
  customer: z.object({
    name: text.min(1),
    phone: optional,
    email,
    address: z.string().trim().max(500).default(''),
  }),
  expense: z.object({
    description: text.min(1),
    category: z.enum([
      'Electricity',
      'Water',
      'Rent',
      'Transportation',
      'Salaries',
      'Supplies',
      'Maintenance',
      'Other',
    ]),
    amount: money.refine((v) => v > 0),
    expense_date: date,
    notes: optional,
  }),
  discount: z.object({
    name: text.min(1),
    percent: z.number().min(0).max(100),
    active: z.boolean().default(true),
  }),
  user: z.object({
    name: text.min(1),
    email: z
      .string()
      .email()
      .max(250)
      .transform((s) => s.toLowerCase()),
    role: z.enum(['admin', 'manager', 'cashier', 'inventory']),
    password: z.string().min(12).max(72).optional(),
    active: z.boolean().default(true),
  }),
  movement: z.object({
    product_id: uuid,
    type: z.enum(['stock_in', 'stock_out', 'adjustment', 'damaged', 'return']),
    quantity,
    direction: z.enum(['add', 'remove']).default('add'),
    reason: text.min(3),
  }),
  sale: z.object({
    items: z
      .array(z.object({ product_id: uuid, quantity }))
      .min(1)
      .max(200),
    customer_id: nullable,
    discount_percent: z.number().min(0).max(100).default(0),
    payment_method: text.min(1),
    amount_received: money,
    payment_reference: optional,
    notes: optional,
    idempotency_key: uuid,
  }),
  purchase: z.object({
    supplier_id: uuid,
    items: z
      .array(z.object({ product_id: uuid, quantity, cost_price: money }))
      .min(1)
      .max(200),
    purchase_date: date,
    payment_status: z.enum(['paid', 'unpaid', 'partial']),
    notes: optional,
  }),
  settings: z.object({
    name: text.min(1),
    address: z.string().trim().max(500),
    contact: optional,
    currency: z.enum(['PHP', 'USD', 'EUR', 'GBP', 'SGD']),
    tax_rate: z.number().min(0).max(100),
    tax_inclusive: z.boolean(),
    logo_url: image,
    receipt_footer: z.string().trim().max(500),
    payment_methods: z
      .array(text.min(1))
      .min(1)
      .max(12)
      .refine(
        (v) => new Set(v.map((s) => s.toLowerCase())).size === v.length,
        'Payment methods must be unique',
      ),
    low_stock_threshold: z.number().int().min(0).max(100000),
    cashier_discount_limit: z.number().min(0).max(100),
    loyalty_enabled: z.boolean(),
    timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
  }),
  cancel: z.object({ reason: text.min(3) }),
  password: z.object({
    current_password: z.string().min(1).max(72),
    password: z.string().min(12).max(72),
  }),
  range: z
    .object({ from: date, to: date })
    .refine((v) => v.from <= v.to, 'Start date must be before end date')
    .refine(
      (v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
      'Choose a range of up to one year',
    ),
};
export const parseId = (value) => uuid.parse(value);
