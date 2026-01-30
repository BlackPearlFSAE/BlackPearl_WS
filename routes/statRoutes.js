
import express from 'express';
import { Stat } from '../models/stat_schema.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const stats = await Stat.findAll({ order: [['createdAt', 'DESC']] });
  res.json(stats);
});

export default router;
