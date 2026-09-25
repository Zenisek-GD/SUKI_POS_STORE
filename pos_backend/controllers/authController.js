import { one } from '../models/database.js';
import { schemas } from '../validation.js';
import { token, hashPassword, verifyPassword, assert, audit, publicUser } from '../utils.js';
export function authController(db, { demo = false } = {}) {
  const dummy = hashPassword(token());
  return {
    info: (_req, res) => res.json({ demo }),
    async login(req, res) {
      const data = schemas.login.parse(req.body),
        user = await one(db, 'SELECT * FROM users WHERE email=$1', [data.email]);
      const valid = await verifyPassword(data.password, user?.password_hash || (await dummy));
      assert(user?.active && valid, 401, 'The email or password is incorrect.');
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.userId = user.id;
      req.session.csrfToken = token();
      await db.query('DELETE FROM sessions WHERE expires_at<now()');
      await audit(db, user, 'auth.login', 'user', user.id, `${user.name} signed in`);
      await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
      res.json({ user: publicUser(user), csrf_token: req.session.csrfToken });
    },
    me: (req, res) => res.json({ user: publicUser(req.user), csrf_token: req.session.csrfToken }),
    async logout(req, res) {
      await new Promise((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      res.clearCookie('suki.sid', { path: '/' }).json({ ok: true });
    },
    async password(req, res) {
      const data = schemas.password.parse(req.body);
      assert(
        await verifyPassword(data.current_password, req.user.password_hash),
        422,
        'Current password is incorrect.',
      );
      const hash = await hashPassword(data.password);
      await db.transaction(async (tx) => {
        await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
        await tx.query("DELETE FROM sessions WHERE sess->>'userId'=$1 AND sid<>$2", [
          req.user.id,
          req.sessionID,
        ]);
        await audit(tx, req.user, 'user.password', 'user', req.user.id, 'Account password changed');
      });
      res.json({ ok: true });
    },
  };
}
