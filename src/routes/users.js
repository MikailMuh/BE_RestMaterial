// src/routes/users.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
} from '../controllers/userController.js';
import { getUserReviews } from '../controllers/reviewController.js';

const router = Router();

// ─── My profile (auth) ───
router.get('/me', requireAuth, asyncHandler(getMyProfile));
router.patch('/me', requireAuth, asyncHandler(updateMyProfile));

// ─── Public profile by ID ───
router.get('/:id', asyncHandler(getPublicProfile));

// buat review
router.get('/:id/reviews', asyncHandler(getUserReviews));
export default router;