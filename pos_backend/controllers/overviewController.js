import { salesOverview } from '../services/salesOverview.js';

export const overviewController = (db) => async (req, res) => {
  res.json(await salesOverview(db, req.user.store_id, req.query));
};
