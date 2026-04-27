// src/routes/impact.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getPlatformStats,
  getMyImpact,
  getLeaderboard,
} from '../controllers/impactController.js';

const router = Router();

// Public — landing page stats
router.get('/platform', asyncHandler(getPlatformStats));
router.get('/leaderboard', asyncHandler(getLeaderboard));

// Auth — personal dashboard
router.get('/me', requireAuth, asyncHandler(getMyImpact));

export default router;