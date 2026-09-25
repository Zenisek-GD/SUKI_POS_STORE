import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('hex');
export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const publicUser = (u) => ({
  id: u.id,
  store_id: u.store_id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
});
export const reference = (prefix) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
export async function audit(tx, user, action, entity, entityId, summary, details = {}) {
  await tx.query(
    'INSERT INTO audit_logs(id,store_id,user_id,action,entity_type,entity_id,summary,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id(), user.store_id, user.id, action, entity, entityId, summary, JSON.stringify(details)],
  );
}
// All money values are integer minor units, including API payloads.
export function totals(items, percent, rate, inclusive) {
  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    discount = Math.round((subtotal * percent) / 100),
    net = subtotal - discount;
  const tax = Math.round(inclusive ? net - net / (1 + rate / 100) : (net * rate) / 100),
    total = inclusive ? net : net + tax;
  assert(
    Number.isSafeInteger(total) && total <= 2_000_000_000,
    422,
    'Transaction exceeds the supported amount.',
  );
  return { subtotal, discount, tax, total };
}
