// src/routes/listings.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadPhotos, handleUploadError } from '../middleware/upload.js';
import {
  getAllListings,
  getMyListings,
  getListingById,
  createListing,
  updateListing,
  updateListingStatus,
  deleteListing,
  uploadListingPhotos,    // ← baru
  deleteListingPhoto,     // ← baru
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

// ─── AUTH — owner only ───
router.patch('/:id', requireAuth, asyncHandler(updateListing));
router.patch('/:id/status', requireAuth, asyncHandler(updateListingStatus));
router.delete('/:id', requireAuth, asyncHandler(deleteListing));

// ─── Photos ───
// Upload — multer parse dulu, terus controller handle
router.post(
  '/:id/photos',
  requireAuth,
  uploadPhotos.array('photos', 5),    // multer middleware
  handleUploadError,                   // catch multer-specific errors
  asyncHandler(uploadListingPhotos)
);

// Delete 1 photo
router.delete(
  '/:id/photos/:photoId',
  requireAuth,
  asyncHandler(deleteListingPhoto)
);

export default router;