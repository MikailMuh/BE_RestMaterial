// src/controllers/transactionController.js
import { supabaseAdmin } from '../config/supabase.js';
import {
  required,
  validString,
  validNumber,
  validEnum,
  validUUID,
  ValidationError,
} from '../utils/validator.js';

// ─── Constants ─────────────────────────────────────────────
const VALID_DELIVERY_METHODS = ['SELF_PICKUP', 'DELIVERY'];
const VALID_TRANSACTION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'PAID',
  'READY_FOR_HANDOVER',
  'COMPLETED',
  'CANCELLED',
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// tambahan helper buat accept and reject
// ─── Helper: restore listing quantity setelah reject/cancel ───
const restoreListingQuantity = async (listingId, qtyToRestore) => {
  const { data: listing, error: fetchErr } = await supabaseAdmin
    .from('listings')
    .select('id, quantity, status')
    .eq('id', listingId)
    .single();

  if (fetchErr || !listing) {
    console.error('[restoreListing] not found:', listingId);
    return { error: fetchErr || new Error('Listing not found') };
  }

  // Skip kalo listing udah SOLD/INACTIVE (gak relevan lagi)
  if (['SOLD', 'INACTIVE'].includes(listing.status)) {
    return { skipped: true };
  }

  const newQuantity = Number(listing.quantity) + Number(qtyToRestore);

  const { error: updateErr } = await supabaseAdmin
    .from('listings')
    .update({
      quantity: newQuantity,
      status: 'AVAILABLE',
    })
    .eq('id', listingId);

  if (updateErr) {
    console.error('[restoreListing] update failed:', updateErr);
    return { error: updateErr };
  }

  return { success: true, newQuantity };
};

// ═══════════════════════════════════════════════════════════
// POST /api/transactions
// Create new order (BUYER initiating)
// Body: { listing_id, quantity, delivery_method, delivery_address?,
//         buyer_message? }
//
// Logic:
// 1. Validate listing exists & status AVAILABLE
// 2. Validate buyer ≠ seller
// 3. Validate quantity ≤ stock available
// 4. Calculate total_price & total_weight (proportional)
// 5. Insert transaction (status PENDING)
// 6. Reduce listing quantity (proper split)
// 7. If qty habis → status RESERVED (jangan update quantity ke 0,
//    karena DB constraint quantity > 0)
// ═══════════════════════════════════════════════════════════
export const createTransaction = async (req, res) => {
  const {
    listing_id,
    quantity,
    delivery_method,
    delivery_address,
    buyer_message,
  } = req.body;

  // ─── Validate input ───
  validUUID(required(listing_id, 'listing_id'), 'listing_id');
  const orderQty = validNumber(
    required(quantity, 'quantity'),
    'quantity',
    { min: 0.001 }
  );
  validEnum(
    required(delivery_method, 'delivery_method'),
    'delivery_method',
    VALID_DELIVERY_METHODS
  );

  // Conditional: kalo DELIVERY, alamat wajib
  if (delivery_method === 'DELIVERY' && !delivery_address) {
    throw new ValidationError(
      'delivery_address wajib diisi kalo pilih DELIVERY',
      'delivery_address'
    );
  }

  const validatedAddress = delivery_address
    ? validString(delivery_address, 'delivery_address', { min: 5, max: 500 })
    : null;
  const validatedMessage = buyer_message
    ? validString(buyer_message, 'buyer_message', { max: 500 })
    : null;

  // ─── Fetch listing ───
  const { data: listing, error: listingErr } = await supabaseAdmin
    .from('listings')
    .select(
      'id, seller_id, status, quantity, unit, price_per_unit, ' +
        'estimated_weight_kg, title, address, city, province'
    )
    .eq('id', listing_id)
    .single();

  if (listingErr || !listing) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Listing tidak ditemukan',
    });
  }

  // ─── Business rules ───
  if (listing.seller_id === req.user.id) {
    return res.status(400).json({
      error: 'Invalid action',
      message: 'Lu gak bisa beli listing sendiri bre',
    });
  }

  if (listing.status !== 'AVAILABLE') {
    return res.status(400).json({
      error: 'Listing not available',
      message: `Listing status '${listing.status}', tidak bisa di-order`,
    });
  }

  if (orderQty > Number(listing.quantity)) {
    return res.status(400).json({
      error: 'Insufficient stock',
      message: `Stok tersedia ${listing.quantity} ${listing.unit}, kamu order ${orderQty}`,
    });
  }

  // ─── Calculate totals ───
  // total_price = orderQty × price_per_unit
  // total_weight_kg = proportional
  const totalPrice = orderQty * Number(listing.price_per_unit);
  const totalWeight =
    (Number(listing.estimated_weight_kg) / Number(listing.quantity)) * orderQty;

  // ─── Insert transaction (pake user context untuk RLS) ───
  const { data: transaction, error: txErr } = await req.supabase
    .from('transactions')
    .insert({
      listing_id,
      buyer_id: req.user.id,
      seller_id: listing.seller_id,
      quantity: orderQty,
      total_price: totalPrice,
      total_weight_kg: totalWeight,
      delivery_method,
      delivery_address: validatedAddress,
      buyer_message: validatedMessage,
      status: 'PENDING',
    })
    .select()
    .single();

  if (txErr) {
    console.error('[createTransaction]', txErr);
    throw txErr;
  }

  // ─── Reduce listing quantity (proper split) ───
  const newQuantity = Number(listing.quantity) - orderQty;
  const isFullyReserved = newQuantity <= 0;

  // Build update payload.
  // Kalo stok habis, JANGAN update quantity ke 0 (DB constraint quantity > 0).
  // Cukup ubah status ke RESERVED. Quantity tetep di nilai sebelumnya,
  // gak ngaruh karena status RESERVED bikin listing gak bisa di-order lagi.
  const updatePayload = isFullyReserved
    ? { status: 'RESERVED' }
    : { quantity: newQuantity, status: 'AVAILABLE' };

  const { error: updateErr } = await supabaseAdmin
    .from('listings')
    .update(updatePayload)
    .eq('id', listing_id);

  if (updateErr) {
    // Rollback transaksi kalo gagal update listing
    console.error('[createTransaction rollback]', updateErr);
    await supabaseAdmin
      .from('transactions')
      .delete()
      .eq('id', transaction.id);

    return res.status(500).json({
      error: 'Failed to reserve stock',
      message: updateErr.message,
    });
  }

  res.status(201).json({
    message: 'Order berhasil dibuat. Tunggu konfirmasi seller.',
    transaction: {
      ...transaction,
      listing_title: listing.title,
      listing_unit: listing.unit,
    },
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/transactions
// List transactions user (sebagai buyer ATAU seller)
// Query params:
//   role  → 'BUYER' | 'SELLER' | 'ALL' (default ALL)
//   status → filter status
//   page, limit
// ═══════════════════════════════════════════════════════════
export const getMyTransactions = async (req, res) => {
  const userId = req.user.id;
  const {
    role = 'ALL',
    status,
    page = '1',
    limit = String(DEFAULT_LIMIT),
  } = req.query;

  validEnum(role, 'role', ['BUYER', 'SELLER', 'ALL']);

  if (status) {
    validEnum(status, 'status', VALID_TRANSACTION_STATUSES);
  }

  const pageNum = validNumber(page, 'page', { min: 1, integer: true });
  const limitNum = validNumber(limit, 'limit', {
    min: 1,
    max: MAX_LIMIT,
    integer: true,
  });
  const offset = (pageNum - 1) * limitNum;

  // ─── Build query ───
  let query = req.supabase
    .from('transactions')
    .select(
      `
      id, listing_id, buyer_id, seller_id, quantity, total_price,
      total_weight_kg, co2_saved, delivery_method, delivery_address,
      delivery_fee, status, buyer_message, payment_proof_url,
      created_at, accepted_at, paid_at, completed_at, cancelled_at,
      listing:listings!transactions_listing_id_fkey (
        id, title, unit, price_per_unit,
        photos:listing_photos (url, is_primary)
      ),
      buyer:users!transactions_buyer_id_fkey (id, full_name, avatar_url),
      seller:users!transactions_seller_id_fkey (id, full_name, avatar_url, phone)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false });

  // Apply role filter
  if (role === 'BUYER') {
    query = query.eq('buyer_id', userId);
  } else if (role === 'SELLER') {
    query = query.eq('seller_id', userId);
  } else {
    // ALL — buyer OR seller
    query = query.or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
  }

  if (status) {
    query = query.eq('status', status);
  }

  query = query.range(offset, offset + limitNum - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  // Enrich tiap transaction dengan "my_role" indicator
  const enriched = (data || []).map((tx) => ({
    ...tx,
    my_role: tx.buyer_id === userId ? 'BUYER' : 'SELLER',
    primary_photo:
      tx.listing?.photos?.find((p) => p.is_primary)?.url || null,
  }));

  res.json({
    data: enriched,
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
// GET /api/transactions/:id
// Detail 1 transaction (participant only — RLS enforced)
// ═══════════════════════════════════════════════════════════
export const getTransactionById = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const { data, error } = await req.supabase
    .from('transactions')
    .select(
      `
      *,
      listing:listings!transactions_listing_id_fkey (
        id, title, description, condition, unit, price_per_unit,
        address, city, province,
        category:categories!listings_category_id_fkey (name, slug),
        photos:listing_photos (id, url, is_primary, order_index)
      ),
      buyer:users!transactions_buyer_id_fkey (
        id, full_name, avatar_url, phone, city
      ),
      seller:users!transactions_seller_id_fkey (
        id, full_name, avatar_url, phone, city, rating_avg, total_reviews
      )
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Transaction tidak ditemukan atau lu bukan participant',
    });
  }

  // Tambahin info "my_role"
  const myRole = data.buyer_id === req.user.id ? 'BUYER' : 'SELLER';

  res.json({
    transaction: { ...data, my_role: myRole },
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/transactions/:id/accept
// SELLER accept order — PENDING → ACCEPTED
// ═══════════════════════════════════════════════════════════
export const acceptTransaction = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const { data: tx } = await req.supabase
    .from('transactions')
    .select('id, status, seller_id, buyer_id, listing_id, quantity')
    .eq('id', id)
    .maybeSingle();

  if (!tx) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Transaction tidak ditemukan atau lu bukan participant',
    });
  }

  if (tx.seller_id !== req.user.id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cuma seller yang bisa accept order',
    });
  }

  if (tx.status !== 'PENDING') {
    return res.status(400).json({
      error: 'Invalid state transition',
      message: `Status saat ini '${tx.status}'. Cuma transaction PENDING yang bisa di-accept.`,
    });
  }

  const { data: updated, error } = await req.supabase
    .from('transactions')
    .update({
      status: 'ACCEPTED',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  res.json({
    message: 'Order accepted. Buyer bisa lanjut bayar.',
    transaction: updated,
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/transactions/:id/reject
// SELLER reject order — PENDING → REJECTED + restore stok
// Body: { reason? }
// ═══════════════════════════════════════════════════════════
export const rejectTransaction = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const { reason } = req.body;
  const validatedReason = reason
    ? validString(reason, 'reason', { max: 500 })
    : null;

  const { data: tx } = await req.supabase
    .from('transactions')
    .select('id, status, seller_id, buyer_id, listing_id, quantity, buyer_message')
    .eq('id', id)
    .maybeSingle();

  if (!tx) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Transaction tidak ditemukan atau lu bukan participant',
    });
  }

  if (tx.seller_id !== req.user.id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cuma seller yang bisa reject order',
    });
  }

  if (tx.status !== 'PENDING') {
    return res.status(400).json({
      error: 'Invalid state transition',
      message: `Status saat ini '${tx.status}'. Reject hanya valid untuk PENDING. Kalo udah ACCEPTED, harus pake cancel.`,
    });
  }

  const updatePayload = {
    status: 'REJECTED',
    cancelled_at: new Date().toISOString(),
  };

  if (validatedReason) {
    const prefix = tx.buyer_message ? `${tx.buyer_message}\n\n` : '';
    updatePayload.buyer_message = `${prefix}[REJECTED by seller]: ${validatedReason}`;
  }

  const { data: updated, error } = await req.supabase
    .from('transactions')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Restore stok ke listing
  const restoreResult = await restoreListingQuantity(tx.listing_id, tx.quantity);
  if (restoreResult.error) {
    console.warn('[rejectTransaction] restore qty failed:', restoreResult.error);
  }

  res.json({
    message: 'Order rejected. Stok dikembalikan ke listing.',
    transaction: updated,
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/transactions/:id/cancel
// Cancel order — PENDING/ACCEPTED → CANCELLED + restore stok
// Bisa dari buyer ATAU seller
// Body: { reason? }
// ═══════════════════════════════════════════════════════════
export const cancelTransaction = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const { reason } = req.body;
  const validatedReason = reason
    ? validString(reason, 'reason', { max: 500 })
    : null;

  const { data: tx } = await req.supabase
    .from('transactions')
    .select('id, status, seller_id, buyer_id, listing_id, quantity, buyer_message')
    .eq('id', id)
    .maybeSingle();

  if (!tx) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Transaction tidak ditemukan atau lu bukan participant',
    });
  }

  const isBuyer = tx.buyer_id === req.user.id;
  const isSeller = tx.seller_id === req.user.id;

  if (!isBuyer && !isSeller) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cuma participant yang bisa cancel',
    });
  }

  if (!['PENDING', 'ACCEPTED'].includes(tx.status)) {
    return res.status(400).json({
      error: 'Invalid state transition',
      message: `Status saat ini '${tx.status}'. Cancel hanya valid untuk PENDING atau ACCEPTED.`,
    });
  }

  const cancelledBy = isBuyer ? 'buyer' : 'seller';
  const updatePayload = {
    status: 'CANCELLED',
    cancelled_at: new Date().toISOString(),
  };

  if (validatedReason) {
    const prefix = tx.buyer_message ? `${tx.buyer_message}\n\n` : '';
    updatePayload.buyer_message = `${prefix}[CANCELLED by ${cancelledBy}]: ${validatedReason}`;
  }

  const { data: updated, error } = await req.supabase
    .from('transactions')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  const restoreResult = await restoreListingQuantity(tx.listing_id, tx.quantity);
  if (restoreResult.error) {
    console.warn('[cancelTransaction] restore qty failed:', restoreResult.error);
  }

  res.json({
    message: `Order cancelled by ${cancelledBy}. Stok dikembalikan.`,
    transaction: updated,
  });
};