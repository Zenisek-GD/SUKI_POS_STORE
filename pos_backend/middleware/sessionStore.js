import session from 'express-session';
// XianFire uses express-session. Persist its sessions in the application database.
export class DatabaseSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }
  get(sid, callback) {
    this.db
      .query('SELECT sess FROM sessions WHERE sid=$1 AND expires_at>now()', [sid])
      .then((r) => callback(null, r.rows[0]?.sess || null))
      .catch(callback);
  }
  set(sid, sess, callback = () => {}) {
    const expires = sess.cookie.expires || new Date(Date.now() + 12 * 60 * 60 * 1000);
    this.db
      .query(
        'INSERT INTO sessions(sid,sess,expires_at) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expires_at=EXCLUDED.expires_at',
        [sid, JSON.stringify(sess), expires],
      )
      .then(() => callback())
      .catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.db
      .query('DELETE FROM sessions WHERE sid=$1', [sid])
      .then(() => callback())
      .catch(callback);
  }
  touch(sid, sess, callback = () => {}) {
    this.db
      .query('UPDATE sessions SET expires_at=$1 WHERE sid=$2', [sess.cookie.expires, sid])
      .then(() => callback())
      .catch(callback);
  }
}
