// src/controllers/listingController.js
import { supabaseAdmin } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';
import {
  required,
  validNumber,
  validString,
  validEnum,
  validUUID,
  ValidationError,
} from '../utils/validator.js';

// ─── Constants ─────────────────────────────────────────────
const VALID_CONDITIONS = ['GRADE_A', 'GRADE_B', 'GRADE_C', 'GRADE_D'];
const VALID_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'INACTIVE'];
const VALID_SORTS = ['newest', 'oldest', 'price_asc', 'price_desc'];

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// ═══════════════════════════════════════════════════════════
// GET /api/listings
// Browse listings (PUBLIC — status AVAILABLE only)
// Query params:
//   city, category_id, category_slug, condition,
//   min_price, max_price, q (search), sort, page, limit
// ═══════════════════════════════════════════════════════════
export const getAllListings = async (req, res) => {
  const {
    city,
    category_id,
    category_slug,
    condition,
    min_price,
    max_price,
    q,
    sort = 'newest',
    page = '1',
    limit = String(DEFAULT_LIMIT),
  } = req.query;

  // ─── Validate pagination ───
  const pageNum = validNumber(page, 'page', { min: 1, integer: true });
  const limitNum = validNumber(limit, 'limit', {
    min: 1,
    max: MAX_LIMIT,
    integer: true,
  });
  const offset = (pageNum - 1) * limitNum;

  // ─── Validate sort ───
  validEnum(sort, 'sort', VALID_SORTS);

  // ─── Validate filter enums (kalo ada) ───
  if (condition) validEnum(condition, 'condition', VALID_CONDITIONS);

  // ─── Build query ───
  // Pake `count: 'exact'` biar dapet total count buat pagination meta.
  // Select nested: photos, category (nama + slug), seller (nama + rating)
  let query = supabaseAdmin
    .from('listings')
    .select(
      `
      id, title, description, condition, quantity, unit,
      estimated_weight_kg, price_per_unit, total_price, estimated_co2_saved,
      city, province, status, delivery_available, view_count, created_at,
      category:categories!listings_category_id_fkey (id, name, slug),
      seller:users!listings_seller_id_fkey (id, full_name, rating_avg, city),
      photos:listing_photos (url, is_primary, order_index)
    `,
      { count: 'exact' }
    )
    .eq('status', 'AVAILABLE'); // publik cuma liat yg available

  // ─── Apply filters ───
  if (city) query = query.ilike('city', `%${city}%`);
  if (category_id) {
    validUUID(category_id, 'category_id');
    query = query.eq('category_id', category_id);
  }
  if (condition) query = query.eq('condition', condition);
  if (min_price) {
    const min = validNumber(min_price, 'min_price', { min: 0 });
    query = query.gte('total_price', min);
  }
  if (max_price) {
    const max = validNumber(max_price, 'max_price', { min: 0 });
    query = query.lte('total_price', max);
  }

  // ─── Search (title + description) ───
  // Pake `or()` di Supabase buat OR condition lintas kolom
  if (q) {
    const search = validString(q, 'q', { min: 1, max: 100 });
    query = query.or(
      `title.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  // ─── Category slug filter (include semua sub-cat) ───
  // Misal slug = 'structural' → ambil main + semua sub-cat di bawah-nya
  if (category_slug) {
    // 1. Cari main category by slug
    const { data: mainCat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', category_slug)
      .single();

    if (mainCat) {
      // 2. Cari semua sub-category yang parent-nya = main cat
      const { data: children } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('parent_id', mainCat.id);

      // 3. Gabung ID main + children, filter listing yang category_id-nya di list itu
      const ids = [mainCat.id, ...(children || []).map((c) => c.id)];
      query = query.in('category_id', ids);
    }
  }

  // ─── Sort ───
  const sortMap = {
    newest: { column: 'created_at', ascending: false },
    oldest: { column: 'created_at', ascending: true },
    price_asc: { column: 'total_price', ascending: true },
    price_desc: { column: 'total_price', ascending: false },
  };
  const { column, ascending } = sortMap[sort];
  query = query.order(column, { ascending });

  // ─── Pagination ───
  // Supabase pake range(from, to) — inclusive, jadi limit-1 di to
  query = query.range(offset, offset + limitNum - 1);

  // ─── Execute ───
  const { data, error, count } = await query;
  if (error) throw error;

  // ─── Format response ───
  res.json({
    data,
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
// GET /api/listings/me
// My listings (AUTH required, semua status)
// WAJIB didaftarin SEBELUM /:id biar gak ke-match sebagai ID
// ═══════════════════════════════════════════════════════════
export const getMyListings = async (req, res) => {
  const { status } = req.query; // optional filter status

  let query = supabaseAdmin
    .from('listings')
    .select(
      `
      id, title, condition, quantity, unit, price_per_unit, total_price,
      estimated_co2_saved, city, status, view_count, created_at,
      category:categories!listings_category_id_fkey (name, slug),
      photos:listing_photos (url, is_primary)
    `,
      { count: 'exact' }
    )
    .eq('seller_id', req.user.id) // dari middleware requireAuth
    .order('created_at', { ascending: false });

  if (status) {
    validEnum(status, 'status', VALID_STATUSES);
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  res.json({ count, data });
};

// ═══════════════════════════════════════════════════════════
// GET /api/listings/:id
// Detail listing (PUBLIC) + auto increment view_count
// ═══════════════════════════════════════════════════════════
export const getListingById = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  // ─── Fetch detail dengan relations ───
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select(
      `
      *,
      category:categories!listings_category_id_fkey (id, name, slug, co2_factor),
      seller:users!listings_seller_id_fkey (
        id, full_name, avatar_url, bio, city, province,
        rating_avg, total_reviews, created_at
      ),
      photos:listing_photos (id, url, is_primary, order_index)
    `
    )
    .eq('id', id)
    .single();

  if (error || !data) {
    return res.status(404).json({
      error: 'Not found',
      message: `Listing ${id} tidak ditemukan`,
    });
  }

  // ─── Increment view_count (fire & forget, gak block response) ───
  supabaseAdmin
    .from('listings')
    .update({ view_count: data.view_count + 1 })
    .eq('id', id)
    .then(() => {}); // gak pake await, biar cepet

  // Urutkan photos by order_index
  if (data.photos) {
    data.photos.sort((a, b) => a.order_index - b.order_index);
  }

  res.json(data);
};

// ═══════════════════════════════════════════════════════════
// POST /api/listings
// Create listing (AUTH required, role SELLER/BOTH)
// estimated_co2_saved auto-computed via DB trigger
// ═══════════════════════════════════════════════════════════
export const createListing = async (req, res) => {
  const body = req.body;

  // ─── Validate required fields ───
  const title = validString(required(body.title, 'title'), 'title', {
    min: 5,
    max: 200,
  });
  const category_id = validUUID(
    required(body.category_id, 'category_id'),
    'category_id'
  );
  const condition = validEnum(
    required(body.condition, 'condition'),
    'condition',
    VALID_CONDITIONS
  );
  const quantity = validNumber(
    required(body.quantity, 'quantity'),
    'quantity',
    { min: 0.001 }
  );
  const unit = validString(required(body.unit, 'unit'), 'unit', { max: 20 });
  const estimated_weight_kg = validNumber(
    required(body.estimated_weight_kg, 'estimated_weight_kg'),
    'estimated_weight_kg',
    { min: 0 }
  );
  const price_per_unit = validNumber(
    required(body.price_per_unit, 'price_per_unit'),
    'price_per_unit',
    { min: 0 }
  );
  const address = validString(
    required(body.address, 'address'),
    'address',
    { min: 5, max: 500 }
  );
  const city = validString(required(body.city, 'city'), 'city', { max: 100 });
  const province = validString(
    required(body.province, 'province'),
    'province',
    { max: 100 }
  );

  // ─── Optional fields ───
  const description = body.description
    ? validString(body.description, 'description', { max: 2000 })
    : null;
  const latitude = body.latitude
    ? validNumber(body.latitude, 'latitude', { min: -90, max: 90 })
    : null;
  const longitude = body.longitude
    ? validNumber(body.longitude, 'longitude', { min: -180, max: 180 })
    : null;
  const delivery_available = Boolean(body.delivery_available);

  // ─── Verify category exists ───
  // Biar user gak masukin UUID random yg gak ada di DB
  const { data: cat, error: catErr } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('id', category_id)
    .single();

  if (catErr || !cat) {
    throw new ValidationError(
      `Category ${category_id} tidak ditemukan`,
      'category_id'
    );
  }

  // ─── Insert ───
  // Pake req.supabase (user context) biar RLS policy 'listings_seller_insert' jalan:
  //   WITH CHECK (auth.uid() = seller_id)
  // estimated_co2_saved auto-computed di trigger `listings_compute_co2`
  const { data, error } = await req.supabase
    .from('listings')
    .insert({
      seller_id: req.user.id,
      category_id,
      title,
      description,
      condition,
      quantity,
      unit,
      estimated_weight_kg,
      price_per_unit,
      address,
      city,
      province,
      latitude,
      longitude,
      delivery_available,
      // status default 'AVAILABLE' di DB
      // total_price generated di DB
      // estimated_co2_saved computed di trigger
    })
    .select()
    .single();

  if (error) {
    console.error('[createListing DB error]', error);
    return res.status(500).json({
      error: 'Failed to create listing',
      message: error.message,
    });
  }

  res.status(201).json({
    message: 'Listing berhasil dibuat',
    listing: data,
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/listings/:id
// Update listing (AUTH required, seller only, milik sendiri)
// Partial update — kirim field yg mau diubah aja
// ═══════════════════════════════════════════════════════════
export const updateListing = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const body = req.body;

  // ─── Build update payload — hanya field yang di-kirim ───
  // Ini pattern "selective update" — field yg `undefined` di-skip
  const updates = {};

  if (body.title !== undefined) {
    updates.title = validString(body.title, 'title', { min: 5, max: 200 });
  }
  if (body.description !== undefined) {
    updates.description = body.description
      ? validString(body.description, 'description', { max: 2000 })
      : null;
  }
  if (body.category_id !== undefined) {
    updates.category_id = validUUID(body.category_id, 'category_id');

    // Verify category exists
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('id', updates.category_id)
      .single();
    if (!cat) {
      throw new ValidationError(
        `Category ${updates.category_id} tidak ditemukan`,
        'category_id'
      );
    }
  }
  if (body.condition !== undefined) {
    updates.condition = validEnum(body.condition, 'condition', VALID_CONDITIONS);
  }
  if (body.quantity !== undefined) {
    updates.quantity = validNumber(body.quantity, 'quantity', { min: 0.001 });
  }
  if (body.unit !== undefined) {
    updates.unit = validString(body.unit, 'unit', { max: 20 });
  }
  if (body.estimated_weight_kg !== undefined) {
    updates.estimated_weight_kg = validNumber(
      body.estimated_weight_kg,
      'estimated_weight_kg',
      { min: 0 }
    );
  }
  if (body.price_per_unit !== undefined) {
    updates.price_per_unit = validNumber(body.price_per_unit, 'price_per_unit', {
      min: 0,
    });
  }
  if (body.address !== undefined) {
    updates.address = validString(body.address, 'address', {
      min: 5,
      max: 500,
    });
  }
  if (body.city !== undefined) {
    updates.city = validString(body.city, 'city', { max: 100 });
  }
  if (body.province !== undefined) {
    updates.province = validString(body.province, 'province', { max: 100 });
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
  if (body.delivery_available !== undefined) {
    updates.delivery_available = Boolean(body.delivery_available);
  }

  // ─── Nothing to update ───
  if (Object.keys(updates).length === 0) {
    throw new ValidationError(
      'Minimal 1 field harus di-update',
      'body'
    );
  }

  // ─── Execute update pake user context (RLS enforce ownership) ───
  // RLS policy 'listings_seller_update' cek: USING (auth.uid() = seller_id)
  // Jadi kalo user coba update listing orang lain, affected rows = 0
  const { data, error } = await req.supabase
    .from('listings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    // RLS block atau listing gak ada → error PGRST116 ("no rows")
    if (error.code === 'PGRST116') {
      return res.status(404).json({
        error: 'Not found',
        message:
          'Listing tidak ditemukan atau bukan milik lu',
      });
    }
    console.error('[updateListing DB error]', error);
    throw error;
  }

  res.json({
    message: 'Listing berhasil diupdate',
    listing: data,
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/listings/:id/status
// Change listing status (AUTH required, seller only, milik sendiri)
// Dipake buat: pause listing (AVAILABLE → INACTIVE), re-activate, dll
// ═══════════════════════════════════════════════════════════
export const updateListingStatus = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const { status } = req.body;
  validEnum(required(status, 'status'), 'status', VALID_STATUSES);

  // ─── Business rule: seller gak boleh ubah ke SOLD manual ───
  // SOLD harus lewat transaction flow (nanti di Step 7)
  if (status === 'SOLD') {
    return res.status(400).json({
      error: 'Forbidden status change',
      message:
        'Status SOLD otomatis diset waktu transaksi selesai. Gak bisa manual.',
    });
  }

  // ─── Update pake user context ───
  const { data, error } = await req.supabase
    .from('listings')
    .update({ status })
    .eq('id', id)
    .select('id, title, status, updated_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({
        error: 'Not found',
        message: 'Listing tidak ditemukan atau bukan milik lu',
      });
    }
    throw error;
  }

  res.json({
    message: `Status berhasil diubah ke ${status}`,
    listing: data,
  });
};

// ═══════════════════════════════════════════════════════════
// DELETE /api/listings/:id
// Delete listing (AUTH required, seller only, milik sendiri)
// Cascade: listing_photos otomatis ke-hapus (ON DELETE CASCADE)
// ═══════════════════════════════════════════════════════════
export const deleteListing = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  // ─── Business rule: gak boleh hapus kalo ada transaksi aktif ───
  // Transaksi dengan status PENDING/ACCEPTED/PAID/READY_FOR_HANDOVER
  // berarti lagi proses jual-beli. Hapus bisa bikin data inconsistent.
  const { data: activeTxs } = await supabaseAdmin
    .from('transactions')
    .select('id, status')
    .eq('listing_id', id)
    .in('status', ['PENDING', 'ACCEPTED', 'PAID', 'READY_FOR_HANDOVER']);

  if (activeTxs && activeTxs.length > 0) {
    return res.status(409).json({
      error: 'Conflict',
      message: `Listing tidak bisa dihapus karena ada ${activeTxs.length} transaksi aktif. Batalkan atau selesaikan transaksi dulu.`,
    });
  }

  // ─── Delete pake user context (RLS enforce ownership) ───
  const { data, error } = await req.supabase
    .from('listings')
    .delete()
    .eq('id', id)
    .select('id, title')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({
        error: 'Not found',
        message: 'Listing tidak ditemukan atau bukan milik lu',
      });
    }
    throw error;
  }

  res.json({
    message: `Listing "${data.title}" berhasil dihapus`,
    deleted_id: data.id,
  });
};

// ═══════════════════════════════════════════════════════════
// POST /api/listings/:id/photos
// Upload 1+ foto ke Supabase Storage, simpen URL ke listing_photos
// AUTH required, owner only
// Field: 'photos' (multipart, max 5 files, max 5MB each)
// ═══════════════════════════════════════════════════════════

export const uploadListingPhotos = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  // ─── Validate file ada ───
  if (!req.files || req.files.length === 0) {
    throw new ValidationError(
      'Minimal 1 foto harus di-upload (field: photos)',
      'photos'
    );
  }

  // ─── Verify ownership listing ───
  // Pake supabaseAdmin biar liat semua data, tapi cek seller_id manual.
  // Alternatif: pake req.supabase + RLS, tapi error message jadi kurang clear.
  const { data: listing, error: listingErr } = await supabaseAdmin
    .from('listings')
    .select('id, seller_id, title')
    .eq('id', id)
    .single();

  if (listingErr || !listing) {
    return res.status(404).json({
      error: 'Not found',
      message: `Listing ${id} tidak ditemukan`,
    });
  }

  if (listing.seller_id !== req.user.id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Lu cuma bisa upload foto ke listing milik sendiri',
    });
  }

  // ─── Cek jumlah foto existing biar gak over limit ───
  const { count: existingCount } = await supabaseAdmin
    .from('listing_photos')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', id);

  const MAX_PHOTOS_PER_LISTING = 10;
  if ((existingCount || 0) + req.files.length > MAX_PHOTOS_PER_LISTING) {
    return res.status(400).json({
      error: 'Too many photos',
      message: `Maksimal ${MAX_PHOTOS_PER_LISTING} foto per listing. Sekarang ada ${existingCount}, mau tambah ${req.files.length}.`,
    });
  }

  // ─── Upload ke Supabase Storage ───
  // Path convention: <listing_id>/<random_uuid>.<ext>
  // Random filename biar gak collision kalo user upload nama file sama
  const uploadedUrls = [];
  const errors = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];

    // Extract extension dari MIME (jpeg → jpg, png → png, webp → webp)
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[file.mimetype] || 'jpg';
    const filename = `${uuidv4()}.${ext}`;
    const path = `${id}/${filename}`;

    // Upload pake user context (req.supabase) biar Storage RLS apply
    const { data: uploadData, error: uploadErr } = await req.supabase.storage
      .from('listing-photos')
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600', // browser cache 1 jam
        upsert: false,
      });

    if (uploadErr) {
      console.error('[Upload error]', file.originalname, uploadErr);
      errors.push({
        file: file.originalname,
        error: uploadErr.message,
      });
      continue;
    }

    // Generate public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('listing-photos')
      .getPublicUrl(uploadData.path);

    uploadedUrls.push({
      path: uploadData.path,
      url: urlData.publicUrl,
      order_index: (existingCount || 0) + i,
    });
  }

  // ─── Kalo semua gagal upload ───
  if (uploadedUrls.length === 0) {
    return res.status(500).json({
      error: 'Upload failed',
      message: 'Tidak ada foto yang berhasil di-upload',
      details: errors,
    });
  }

  // ─── Insert ke listing_photos ───
  // Foto pertama yg di-upload jadi primary KALAU listing belom punya foto
  const isFirstUpload = (existingCount || 0) === 0;
  const photosToInsert = uploadedUrls.map((p, idx) => ({
    listing_id: id,
    url: p.url,
    order_index: p.order_index,
    is_primary: isFirstUpload && idx === 0, // foto pertama dari batch pertama = primary
  }));

  const { data: photos, error: insertErr } = await req.supabase
    .from('listing_photos')
    .insert(photosToInsert)
    .select();

  if (insertErr) {
    // Rollback storage uploads kalo DB insert fail
    console.error('[DB insert error]', insertErr);
    for (const p of uploadedUrls) {
      await supabaseAdmin.storage.from('listing-photos').remove([p.path]);
    }
    return res.status(500).json({
      error: 'Database error',
      message: insertErr.message,
    });
  }

  res.status(201).json({
    message: `${photos.length} foto berhasil di-upload`,
    photos,
    failed: errors.length > 0 ? errors : undefined,
  });
};

// ═══════════════════════════════════════════════════════════
// DELETE /api/listings/:id/photos/:photoId
// Delete 1 foto specific (dari Storage + DB)
// AUTH required, owner only
// ═══════════════════════════════════════════════════════════
export const deleteListingPhoto = async (req, res) => {
  const { id, photoId } = req.params;
  validUUID(id, 'id');
  validUUID(photoId, 'photoId');

  // ─── Verify ownership ───
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('seller_id')
    .eq('id', id)
    .single();

  if (!listing) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Listing tidak ditemukan',
    });
  }

  if (listing.seller_id !== req.user.id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Lu cuma bisa hapus foto listing milik sendiri',
    });
  }

  // ─── Get photo URL buat extract storage path ───
  const { data: photo, error: photoErr } = await supabaseAdmin
    .from('listing_photos')
    .select('id, url, is_primary')
    .eq('id', photoId)
    .eq('listing_id', id)
    .single();

  if (photoErr || !photo) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Foto tidak ditemukan',
    });
  }

  // ─── Extract storage path dari public URL ───
  // URL: https://xxx.supabase.co/storage/v1/object/public/listing-photos/<listing_id>/<filename>
  // Path yg kita butuh: <listing_id>/<filename>
  const urlParts = photo.url.split('/listing-photos/');
  const storagePath = urlParts[1];

  if (!storagePath) {
    return res.status(500).json({
      error: 'Invalid photo URL',
      message: 'Cannot extract storage path from URL',
    });
  }

  // ─── Delete dari Storage ───
  const { error: storageErr } = await supabaseAdmin.storage
    .from('listing-photos')
    .remove([storagePath]);

  if (storageErr) {
    console.error('[Storage delete error]', storageErr);
    // Lanjut hapus DB record meski Storage delete gagal (orphan file di-handle nanti)
  }

  // ─── Delete dari DB ───
  const { error: dbErr } = await req.supabase
    .from('listing_photos')
    .delete()
    .eq('id', photoId);

  if (dbErr) {
    return res.status(500).json({
      error: 'Database error',
      message: dbErr.message,
    });
  }

  // ─── Kalo yg dihapus adalah primary, promote foto pertama jadi primary ───
  if (photo.is_primary) {
    const { data: nextPhoto } = await supabaseAdmin
      .from('listing_photos')
      .select('id')
      .eq('listing_id', id)
      .order('order_index', { ascending: true })
      .limit(1)
      .single();

    if (nextPhoto) {
      await supabaseAdmin
        .from('listing_photos')
        .update({ is_primary: true })
        .eq('id', nextPhoto.id);
    }
  }

  res.json({
    message: 'Foto berhasil dihapus',
    deleted_id: photoId,
  });
};


