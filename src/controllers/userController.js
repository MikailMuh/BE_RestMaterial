// src/controllers/userController.js
import { supabaseAdmin } from '../config/supabase.js';
import {
  validString,
  validEnum,
  validNumber,
  ValidationError,
} from '../utils/validator.js';

const VALID_ROLES = ['SELLER', 'BUYER', 'BOTH'];

// ═══════════════════════════════════════════════════════════
// GET /api/users/me
// Get profile lengkap user yang lagi login.
// ═══════════════════════════════════════════════════════════
export const getMyProfile = async (req, res) => {
  // req.profile udah di-fetch di middleware requireAuth
  // tapi kita refresh dari DB biar paling up-to-date
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Profile tidak ditemukan',
    });
  }

  res.json({ profile: data });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/users/me
// Update profile sendiri. Field optional, partial update.
// Body: { full_name?, phone?, bio?, address?, city?, province?,
//         latitude?, longitude?, role?, avatar_url? }
//
// Khusus 'role': ada business rule — gak bisa downgrade dari BOTH
// ke BUYER kalo masih punya listing AVAILABLE/RESERVED.
// ═══════════════════════════════════════════════════════════
export const updateMyProfile = async (req, res) => {
  const body = req.body;
  const updates = {};

  if (body.full_name !== undefined) {
    updates.full_name = validString(body.full_name, 'full_name', {
      min: 2,
      max: 100,
    });
  }
  if (body.phone !== undefined) {
    updates.phone = body.phone
      ? validString(body.phone, 'phone', { max: 20 })
      : null;
  }
  if (body.bio !== undefined) {
    updates.bio = body.bio
      ? validString(body.bio, 'bio', { max: 500 })
      : null;
  }
  if (body.address !== undefined) {
    updates.address = body.address
      ? validString(body.address, 'address', { max: 500 })
      : null;
  }
  if (body.city !== undefined) {
    updates.city = body.city
      ? validString(body.city, 'city', { max: 100 })
      : null;
  }
  if (body.province !== undefined) {
    updates.province = body.province
      ? validString(body.province, 'province', { max: 100 })
      : null;
  }
  if (body.latitude !== undefined) {
    updates.latitude = body.latitude
      ? validNumber(body.latitude, 'latitude', { min: -90, max: 90 })
      : null;
  }
  if (body.longitude !== undefined) {
    updates.longitude = body.longitude
      ? validNumber(body.longitude, 'longitude', { min: -180, max: 180 })
      : null;
  }
  if (body.avatar_url !== undefined) {
    updates.avatar_url = body.avatar_url
      ? validString(body.avatar_url, 'avatar_url', { max: 500 })
      : null;
  }

  // ─── Role change — ada business rule ───
  if (body.role !== undefined) {
    const newRole = validEnum(body.role, 'role', VALID_ROLES);

    // Cek role lama
    const currentRole = req.profile.role;

    // Block downgrade dari BOTH/SELLER ke BUYER kalo masih punya listing aktif
    if (
      newRole === 'BUYER' &&
      ['SELLER', 'BOTH'].includes(currentRole)
    ) {
      const { count } = await supabaseAdmin
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', req.user.id)
        .in('status', ['AVAILABLE', 'RESERVED']);

      if ((count || 0) > 0) {
        return res.status(400).json({
          error: 'Cannot downgrade role',
          message: `Lu masih punya ${count} listing aktif (AVAILABLE/RESERVED). Hapus atau set INACTIVE dulu sebelum downgrade ke BUYER.`,
        });
      }
    }

    updates.role = newRole;
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError(
      'Minimal 1 field harus di-update',
      'body'
    );
  }

  // ─── Execute update pake user context (RLS: 'users_update_own') ───
  const { data, error } = await req.supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    console.error('[updateMyProfile]', error);
    throw error;
  }

  res.json({
    message: 'Profile berhasil diupdate',
    profile: data,
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/users/:id
// Public profile by user ID (buat liat profil seller, buyer history, dll)
// Return data yg public-safe doang (gak ada email/phone)
// ═══════════════════════════════════════════════════════════
export const getPublicProfile = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('users')
    .select(
      'id, full_name, avatar_url, bio, city, province, rating_avg, total_reviews, created_at, role'
    )
    .eq('id', id)
    .single();

  if (error || !data) {
    return res.status(404).json({
      error: 'Not found',
      message: 'User tidak ditemukan',
    });
  }

  res.json({ profile: data });
};