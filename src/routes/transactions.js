// src/routes/transactions.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTransaction,
  getMyTransactions,
  getTransactionById,
} from '../controllers/transactionController.js';

const router = Router();

// Semua endpoint butuh auth
router.use(requireAuth);

router.post('/', asyncHandler(createTransaction));
router.get('/', asyncHandler(getMyTransactions));
router.get('/:id', asyncHandler(getTransactionById));

export default router;