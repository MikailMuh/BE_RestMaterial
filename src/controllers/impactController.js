// src/controllers/impactController.js
import { supabaseAdmin } from '../config/supabase.js';
import { validNumber } from '../utils/validator.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ═══════════════════════════════════════════════════════════
// CATEGORY GROUPS MAPPING
// Selaras dengan UI mockup FE - 11 group categories
// ═══════════════════════════════════════════════════════════
const CATEGORY_GROUPS = {
  'Steel & Iron': ['rebar', 'steel-profile', 'iron-pipe'],
  'Aluminium': ['aluminum-frame'],
  'Concrete': ['cement', 'readymix', 'sand', 'gravel'],
  'Wood & Plywood': ['solid-wood', 'plywood', 'wood-frame'],
  'Bricks & Blocks': ['clay-brick', 'aac-block'],
  'Ceramic & Granite': ['ceramic-tile', 'granite-tile', 'marble'],
  'Glass': ['clear-glass'],
  'Frames & Doors': ['door', 'roof-tile'],
  'Pipes & Installation': ['pvc-pipe', 'electrical-cable', 'sanitary-fitting', 'toilet', 'sink'],
  'Paints & Coatings': ['paint'],
  'Others': ['gypsum', 'wallpaper'],
};

// ═══════════════════════════════════════════════════════════
// GET /api/impact/platform
// Platform-wide impact stats (PUBLIC — buat landing page)
// Total users, listings, transactions, kg saved, co2 saved, GMV
// ═══════════════════════════════════════════════════════════
export const getPlatformStats = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('platform_stats')
    .select('*')
    .single();

  if (error) {
    console.error('[getPlatformStats]', error);
    throw error;
  }

  // Round angka biar lebih readable di UI
  const rounded = {
    total_users: Number(data.total_users) || 0,
    total_listings: Number(data.total_listings) || 0,
    total_transactions: Number(data.total_transactions) || 0,
    total_kg_saved: Math.round(Number(data.total_kg_saved) || 0),
    total_co2_saved: Math.round(Number(data.total_co2_saved) || 0),
    total_gmv: Math.round(Number(data.total_gmv) || 0),
  };

  // Bonus calculations buat narrative angka yang impressive
  // Source: EPA — 1 kg CO2e ≈ 4.6 km drive passenger car
  const equivalentCarKm = Math.round(rounded.total_co2_saved * 4.6);
  // Source: 1 tree absorbs ~21 kg CO2/year
  const equivalentTrees = Math.round(rounded.total_co2_saved / 21);

  res.json({
    stats: rounded,
    equivalents: {
      car_km_avoided: equivalentCarKm,
      trees_planted_equivalent: equivalentTrees,
    },
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/impact/me
// Personal impact stats untuk user yang lagi login
// ═══════════════════════════════════════════════════════════
export const getMyImpact = async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('user_impact')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // User baru tanpa transaksi — return zero stats
    return res.json({
      impact: {
        user_id: userId,
        sales_count: 0,
        purchase_count: 0,
        kg_sold: 0,
        kg_bought: 0,
        total_co2_saved: 0,
        total_earned: 0,
        total_spent: 0,
      },
      equivalents: {
        car_km_avoided: 0,
        trees_planted_equivalent: 0,
      },
    });
  }

  const rounded = {
    user_id: data.user_id,
    full_name: data.full_name,
    sales_count: Number(data.sales_count) || 0,
    purchase_count: Number(data.purchase_count) || 0,
    kg_sold: Math.round(Number(data.kg_sold) || 0),
    kg_bought: Math.round(Number(data.kg_bought) || 0),
    total_co2_saved: Math.round(Number(data.total_co2_saved) || 0),
    total_earned: Math.round(Number(data.total_earned) || 0),
    total_spent: Math.round(Number(data.total_spent) || 0),
  };

  res.json({
    impact: rounded,
    equivalents: {
      car_km_avoided: Math.round(rounded.total_co2_saved * 4.6),
      trees_planted_equivalent: Math.round(rounded.total_co2_saved / 21),
    },
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/impact/leaderboard
// Top contributors by total CO2 saved
// PUBLIC — buat showcase di landing page
// ═══════════════════════════════════════════════════════════
export const getLeaderboard = async (req, res) => {
  const { limit = '10' } = req.query;
  const limitNum = validNumber(limit, 'limit', {
    min: 1,
    max: 50,
    integer: true,
  });

  const { data, error } = await supabaseAdmin
    .from('user_impact')
    .select('user_id, full_name, total_co2_saved, sales_count, purchase_count')
    .gt('total_co2_saved', 0) // exclude user 0 impact
    .order('total_co2_saved', { ascending: false })
    .limit(limitNum);

  if (error) throw error;

  // Add rank
  const ranked = (data || []).map((u, idx) => ({
    rank: idx + 1,
    user_id: u.user_id,
    full_name: u.full_name,
    total_co2_saved: Math.round(Number(u.total_co2_saved) || 0),
    transactions_count:
      (Number(u.sales_count) || 0) + (Number(u.purchase_count) || 0),
  }));

  res.json({
    leaderboard: ranked,
    count: ranked.length,
  });
};

/// ═══════════════════════════════════════════════════════════
// GET /api/impact/breakdown
// CO2 saved breakdown by FE display category groups
// PUBLIC — buat dashboard breakdown chart
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// GET /api/impact/breakdown
// CO2 saved breakdown by FE display category groups
// PUBLIC — buat dashboard breakdown chart
// ═══════════════════════════════════════════════════════════
export const getCategoryBreakdown = asyncHandler(async (req, res) => {
  console.log('[getCategoryBreakdown] Starting...');

  // Step 1: Get all completed transactions with co2_saved
  const { data: transactions, error: txError } = await supabaseAdmin
    .from('transactions')
    .select('id, status, co2_saved, listing_id')
    .gt('co2_saved', 0); // hanya yang punya co2_saved > 0

  if (txError) {
    console.error('[getCategoryBreakdown] Transaction query error:', txError);
    return res.status(500).json({
      error: 'Database error pada query transactions',
      message: txError.message,
      details: txError,
    });
  }

  console.log(`[getCategoryBreakdown] Found ${transactions?.length || 0} transactions with co2_saved > 0`);

  if (!transactions || transactions.length === 0) {
    return res.json({
      total_co2_saved_kg: 0,
      total_transactions: 0,
      breakdown: [],
    });
  }

  // Step 2: Get unique listing IDs
  const listingIds = [...new Set(transactions.map((tx) => tx.listing_id).filter(Boolean))];
  console.log(`[getCategoryBreakdown] Unique listing IDs: ${listingIds.length}`);

  // Step 3: Fetch listings dengan category info
  const { data: listings, error: lError } = await supabaseAdmin
    .from('listings')
    .select('id, category_id, categories(slug, name)')
    .in('id', listingIds);

  if (lError) {
    console.error('[getCategoryBreakdown] Listings query error:', lError);
    return res.status(500).json({
      error: 'Database error pada query listings',
      message: lError.message,
      details: lError,
    });
  }

  console.log(`[getCategoryBreakdown] Found ${listings?.length || 0} listings`);

  // Step 4: Map listing_id → category_slug
  const listingToSlug = {};
  for (const l of listings || []) {
    const slug = l.categories?.slug;
    if (slug) {
      listingToSlug[l.id] = slug;
    }
  }

  console.log(`[getCategoryBreakdown] Listings with valid slug: ${Object.keys(listingToSlug).length}`);

  // Step 5: Initialize breakdown
  const breakdown = {};
  for (const groupName of Object.keys(CATEGORY_GROUPS)) {
    breakdown[groupName] = 0;
  }

  // Step 6: Aggregate co2_saved per group
  let totalCo2 = 0;

  for (const tx of transactions) {
    const co2 = parseFloat(tx.co2_saved) || 0;
    if (co2 <= 0) continue;

    const slug = listingToSlug[tx.listing_id];
    if (!slug) {
      console.log(`[getCategoryBreakdown] Skip tx ${tx.id} - no slug for listing ${tx.listing_id}`);
      continue;
    }

    // Find which group this slug belongs to
    let foundGroup = null;
    for (const [groupName, slugs] of Object.entries(CATEGORY_GROUPS)) {
      if (slugs.includes(slug)) {
        foundGroup = groupName;
        break;
      }
    }

    if (foundGroup) {
      breakdown[foundGroup] += co2;
      totalCo2 += co2;
    } else {
      console.log(`[getCategoryBreakdown] Slug "${slug}" tidak ada di CATEGORY_GROUPS mapping`);
    }
  }

  // Step 7: Convert to sorted array with percentage
  const breakdownArray = Object.entries(breakdown)
    .map(([category, co2_kg]) => ({
      category,
      co2_kg: Math.round(co2_kg * 100) / 100,
      percentage: totalCo2 > 0 ? Math.round((co2_kg / totalCo2) * 1000) / 10 : 0,
    }))
    .filter((item) => item.co2_kg > 0)
    .sort((a, b) => b.co2_kg - a.co2_kg);

  console.log(`[getCategoryBreakdown] Final breakdown:`, breakdownArray);

  res.json({
    total_co2_saved_kg: Math.round(totalCo2 * 100) / 100,
    total_transactions: transactions.length,
    breakdown: breakdownArray,
  });
});