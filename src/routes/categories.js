// src/routes/categories.js
import { Router } from 'express';
import {
  getAllCategories,
  getCategoryTree,
  getMainCategories,
  getCategoryBySlug,
} from '../controllers/categoryController.js';

const router = Router();

router.get('/', getAllCategories);
router.get('/tree', getCategoryTree);
router.get('/main', getMainCategories);
router.get('/:slug', getCategoryBySlug);

export default router;