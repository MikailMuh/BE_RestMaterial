// src/routes/transactions.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  uploadPaymentProof as paymentUploadMiddleware,
  handleUploadError,
} from '../middleware/upload.js';
import {
  createTransaction,
  getMyTransactions,
  getTransactionById,
  acceptTransaction,
  rejectTransaction,
  cancelTransaction,
  uploadPaymentProof,        // ← controller (beda dari middleware)
  markReadyForHandover,
  completeTransaction,
} from '../controllers/transactionController.js';

const router = Router();

router.use(requireAuth);

// Read & Create
router.post('/', asyncHandler(createTransaction));
router.get('/', asyncHandler(getMyTransactions));
router.get('/:id', asyncHandler(getTransactionById));

// State Transitions (Step 7b)
router.patch('/:id/accept', asyncHandler(acceptTransaction));
router.patch('/:id/reject', asyncHandler(rejectTransaction));
router.patch('/:id/cancel', asyncHandler(cancelTransaction));

// Payment & Completion (Step 7c)
router.post(
  '/:id/payment',
  paymentUploadMiddleware.single('payment_proof'),
  handleUploadError,
  asyncHandler(uploadPaymentProof)
);
router.patch('/:id/ready', asyncHandler(markReadyForHandover));
router.patch('/:id/complete', asyncHandler(completeTransaction));

export default router;