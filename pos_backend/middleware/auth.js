import { one } from '../models/database.js';
import { assert, wrap } from '../utils.js';
export const authenticate = (db) =>
  wrap(async (req, res, next) => {
    assert(req.session.userId, 401, 'Please sign in to continue.');
    const user = await one(db, 'SELECT * FROM users WHERE id=$1 AND active=true', [
      req.session.userId,
    ]);
    assert(user, 401, 'Your session has expired. Please sign in again.');
    req.user = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      assert(
        req.get('x-csrf-token') === req.session.csrfToken,
        403,
        'Reload the page and try again.',
      );
    next();
  });
export const allow =
  (...roles) =>
  (req, res, next) => {
    try {
      assert(roles.includes(req.user.role), 403, 'Your role does not have access to this action.');
      next();
    } catch (e) {
      next(e);
    }
  };
