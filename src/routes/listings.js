// src/routes/listings.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getAllListings,
  getMyListings,
  getListingById,
  createListing,
  updateListing,          // ← baru
  updateListingStatus,    // ← baru
  deleteListing,          // ← baru
} from '../controllers/listingController.js';

const router = Router();

// ─── PUBLIC ───
router.get('/', asyncHandler(getAllListings));
router.get('/me', requireAuth, asyncHandler(getMyListings));
router.get('/:id', asyncHandler(getListingById));

// ─── AUTH — SELLER/BOTH only ───
router.post(
  '/',
  requireAuth,
  requireRole('SELLER', 'BOTH'),
  asyncHandler(createListing)
);

// ─── AUTH — owner only (enforced by RLS + controller) ───
router.patch('/:id', requireAuth, asyncHandler(updateListing));
router.patch('/:id/status', requireAuth, asyncHandler(updateListingStatus));
router.delete('/:id', requireAuth, asyncHandler(deleteListing));

export default router;