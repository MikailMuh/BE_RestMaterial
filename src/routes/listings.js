// src/routes/listings.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getAllListings,
  getMyListings,
  getListingById,
  createListing,
} from '../controllers/listingController.js';

const router = Router();

// ─── PUBLIC ───
// GET /api/listings           → browse
// GET /api/listings/:id       → detail
// ⚠️ /me HARUS di atas /:id biar gak ke-match sebagai UUID
router.get('/', asyncHandler(getAllListings));
router.get('/me', requireAuth, asyncHandler(getMyListings));
router.get('/:id', asyncHandler(getListingById));

// ─── AUTH ───
// POST /api/listings → create (SELLER/BOTH only)
router.post(
  '/',
  requireAuth,
  requireRole('SELLER', 'BOTH'),
  asyncHandler(createListing)
);

export default router;