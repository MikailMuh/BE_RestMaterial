// src/routes/users.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
} from '../controllers/userController.js';

const router = Router();

// ─── My profile (auth) ───
router.get('/me', requireAuth, asyncHandler(getMyProfile));
router.patch('/me', requireAuth, asyncHandler(updateMyProfile));

// ─── Public profile by ID ───
router.get('/:id', asyncHandler(getPublicProfile));

export default router;