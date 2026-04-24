// src/controllers/listingController.js
import { supabaseAdmin } from '../config/supabase.js';
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