// src/routes/impact.js
import express from 'express';
import {
  getPlatformStats,
  getMyImpact,
  getLeaderboard,
  getCategoryBreakdown,
} from '../controllers/impactController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// PUBLIC routes
router.get('/platform', getPlatformStats);
router.get('/breakdown', getCategoryBreakdown);
router.get('/leaderboard', getLeaderboard);

// PRIVATE — require auth
router.get('/me', requireAuth, getMyImpact);

export default router;