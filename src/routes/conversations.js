// src/routes/conversations.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  startConversation,
  getMyConversations,
  getMessages,
  sendMessage,
  markAsRead,
} from '../controllers/conversationController.js';

const router = Router();

// Semua endpoint butuh auth — chat private
router.use(requireAuth);

// ─── Conversations ───
router.post('/', asyncHandler(startConversation));
router.get('/', asyncHandler(getMyConversations));

// ─── Messages dalam 1 conversation ───
router.get('/:id/messages', asyncHandler(getMessages));
router.post('/:id/messages', asyncHandler(sendMessage));
router.patch('/:id/read', asyncHandler(markAsRead));

export default router;