// src/middleware/upload.js
import multer from 'multer';
import { ValidationError } from '../utils/validator.js';

// Konstanta upload
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES = 5;                    // max 5 foto per upload
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Multer config — pake memory storage.
 * File jadi Buffer di req.files[i].buffer, terus kita forward ke Supabase.
 *
 * Kenapa memory & bukan disk?
 * - BE deploy ke Railway, disk volatile
 * - Langsung forward ke Supabase Storage, no intermediate
 */
const storage = multer.memoryStorage();

/**
 * File filter — reject file selain image
 */
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(
      new ValidationError(
        `File '${file.originalname}' bukan format yang didukung. Gunakan: JPEG, PNG, atau WebP`,
        'photos'
      ),
      false
    );
  }
  cb(null, true);
};

/**
 * Multer instance buat upload listing photos.
 * Field name: 'photos' (multiple, max 5 files).
 *
 * Pake di route:
 *   router.post('/:id/photos', requireAuth, uploadPhotos.array('photos', 5), controller);
 */
export const uploadPhotos = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

/**
 * Multer error handler middleware — translate multer errors jadi JSON response.
 * Pasang DI BAWAH multer middleware di route stack.
 */
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Ukuran file maksimal ${MAX_FILE_SIZE / 1024 / 1024} MB`,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: `Maksimal ${MAX_FILES} foto per upload`,
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected field',
        message: `Gunakan field name 'photos' untuk upload`,
      });
    }
    return res.status(400).json({
      error: 'Upload failed',
      message: err.message,
    });
  }
  next(err); // bukan multer error, lanjutin ke global handler
};