// src/routes/reviews.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createReview,
  getTransactionReviews,
} from '../controllers/reviewController.js';

const router = Router();

// Create review (auth)
router.post('/', requireAuth, asyncHandler(createReview));

// Get reviews dari 1 transaksi
router.get('/transaction/:transactionId', asyncHandler(getTransactionReviews));

export default router;