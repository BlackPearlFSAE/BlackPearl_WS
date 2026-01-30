import express from 'express';
import { Op } from 'sequelize';
import { Stat } from '../models/stat_schema.js';

const router = express.Router();

/**
 * GET /
 * ดึงข้อมูล stat ทั้งหมด (เรียงล่าสุดก่อน)
 */
router.get('/', async (req, res) => {
  try {
    const stats = await Stat.findAll({
      order: [['createdAt', 'DESC']]
    });

    res.json(stats);
  } catch (err) {
    console.error('GET /api/stat error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * DELETE /delete
 * ลบข้อมูลตาม session_id และ experiment_id
 * body:
 * {
 *   "session_id": 20,
 *   "experiment_id": 3
 * }
 */
router.delete('/delete', async (req, res) => {
  try {
    const { session_id, experiment_id } = req.body;

    if (session_id == null || experiment_id == null) {
      return res.status(400).json({
        error: 'session_id and experiment_id are required'
      });
    }

    const deletedCount = await Stat.destroy({
      where: {
        session_id: Number(session_id),
        experiment_id: Number(experiment_id)
      }
    });

    if (deletedCount === 0) {
      return res.status(404).json({
        message: 'No records found to delete'
      });
    }

    res.json({
      message: 'Successfully deleted records',
      deleted_count: deletedCount,
      criteria: { session_id, experiment_id }
    });

  } catch (err) {
    console.error('DELETE /api/stat/delete error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      details: err.message
    });
  }
});

export default router;
