// src/controllers/reviewController.js
import { supabaseAdmin } from '../config/supabase.js';
import {
  required,
  validString,
  validNumber,
  validUUID,
  ValidationError,
} from '../utils/validator.js';

// ═══════════════════════════════════════════════════════════
// POST /api/reviews
// Create review setelah transaction COMPLETED
// Body: { transaction_id, rating (1-5), comment? }
//
// Auto-determine reviewee dari transaction:
// - Kalo reviewer = buyer → reviewee = seller
// - Kalo reviewer = seller → reviewee = buyer
//
// RLS policy 'reviews_create' udah enforce:
// - Reviewer harus participant transaction
// - Transaction harus COMPLETED
// - Reviewer ≠ Reviewee
// ═══════════════════════════════════════════════════════════
export const createReview = async (req, res) => {
  const { transaction_id, rating, comment } = req.body;

  // ─── Validate input ───
  validUUID(required(transaction_id, 'transaction_id'), 'transaction_id');
  const validatedRating = validNumber(
    required(rating, 'rating'),
    'rating',
    { min: 1, max: 5, integer: true }
  );
  const validatedComment = comment
    ? validString(comment, 'comment', { max: 500 })
    : null;

  // ─── Fetch transaction ───
  const { data: tx } = await req.supabase
    .from('transactions')
    .select('id, status, buyer_id, seller_id')
    .eq('id', transaction_id)
    .maybeSingle();

  if (!tx) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Transaction tidak ditemukan atau lu bukan participant',
    });
  }

  // ─── Business rules ───
  if (tx.status !== 'COMPLETED') {
    return res.status(400).json({
      error: 'Invalid action',
      message: `Cuma transaksi COMPLETED yang bisa di-review. Status saat ini: '${tx.status}'`,
    });
  }

  // ─── Auto-determine reviewer & reviewee ───
  const reviewerId = req.user.id;
  let revieweeId;

  if (tx.buyer_id === reviewerId) {
    revieweeId = tx.seller_id;
  } else if (tx.seller_id === reviewerId) {
    revieweeId = tx.buyer_id;
  } else {
    // Shouldn't reach here karena RLS udah filter, tapi defensive
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Lu bukan participant transaction ini',
    });
  }

  // ─── Cek apakah review udah ada ───
  // UNIQUE constraint (transaction_id, reviewer_id) di DB udah jaga
  const { data: existing } = await req.supabase
    .from('reviews')
    .select('id')
    .eq('transaction_id', transaction_id)
    .eq('reviewer_id', reviewerId)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: 'Already reviewed',
      message: 'Lu udah pernah kasih review buat transaksi ini',
    });
  }

  // ─── Insert review ───
  // RLS 'reviews_create' policy bakal validate ulang business rules
  // Trigger 'on_review_created' auto-update users.rating_avg & total_reviews
  const { data: review, error } = await req.supabase
    .from('reviews')
    .insert({
      transaction_id,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      rating: validatedRating,
      comment: validatedComment,
    })
    .select(
      `
      *,
      reviewer:users!reviews_reviewer_id_fkey (id, full_name, avatar_url),
      reviewee:users!reviews_reviewee_id_fkey (id, full_name, avatar_url, rating_avg, total_reviews)
    `
    )
    .single();

  if (error) {
    console.error('[createReview]', error);
    throw error;
  }

  res.status(201).json({
    message: 'Review berhasil dibuat. Thanks for your feedback!',
    review,
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/users/:id/reviews
// Public list review buat user tertentu (sebagai reviewee)
// Buat tampilan profile page seller — "Apa kata buyer tentang dia"
// ═══════════════════════════════════════════════════════════
export const getUserReviews = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const {
    page = '1',
    limit = '20',
  } = req.query;

  const pageNum = validNumber(page, 'page', { min: 1, integer: true });
  const limitNum = validNumber(limit, 'limit', {
    min: 1,
    max: 50,
    integer: true,
  });
  const offset = (pageNum - 1) * limitNum;

  // Pake admin client karena reviews public-readable (RLS allow)
  const {
    data: reviews,
    error,
    count,
  } = await supabaseAdmin
    .from('reviews')
    .select(
      `
      id, rating, comment, created_at,
      reviewer:users!reviews_reviewer_id_fkey (id, full_name, avatar_url),
      transaction:transactions!reviews_transaction_id_fkey (
        id,
        listing:listings!transactions_listing_id_fkey (id, title)
      )
    `,
      { count: 'exact' }
    )
    .eq('reviewee_id', id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (error) throw error;

  // ─── Calculate rating breakdown (optional, buat UI yg lebih kaya) ───
  const { data: allRatings } = await supabaseAdmin
    .from('reviews')
    .select('rating')
    .eq('reviewee_id', id);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  (allRatings || []).forEach((r) => {
    breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
  });

  res.json({
    reviews,
    breakdown,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: count,
      total_pages: Math.ceil(count / limitNum),
      has_next: offset + limitNum < count,
      has_prev: pageNum > 1,
    },
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/reviews/transaction/:transactionId
// Get reviews untuk 1 transaksi specific (max 2 — buyer & seller)
// Berguna buat tampilan "review yg udah dibuat" di transaction detail
// ═══════════════════════════════════════════════════════════
export const getTransactionReviews = async (req, res) => {
  const { transactionId } = req.params;
  validUUID(transactionId, 'transactionId');

  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select(
      `
      id, rating, comment, created_at,
      reviewer:users!reviews_reviewer_id_fkey (id, full_name, avatar_url),
      reviewee:users!reviews_reviewee_id_fkey (id, full_name, avatar_url)
    `
    )
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  res.json({
    count: data.length,
    reviews: data,
  });
};