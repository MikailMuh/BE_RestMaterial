import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({
    message: 'Authenticated',
    user: {
      id: req.user.id,
      email: req.user.email,
      email_confirmed_at: req.user.email_confirmed_at,
    },
    profile: req.profile,
  });
});

router.get(
  '/seller-only',
  requireAuth,
  requireRole('SELLER', 'BOTH'),
  (req, res) => {
    res.json({
      message: `Hai seller! Role lu: ${req.profile.role}`,
      city: req.profile.city,
    });
  }
);

export default router;