// src/controllers/impactController.js
import { supabaseAdmin } from '../config/supabase.js';
import { validNumber } from '../utils/validator.js';

// ═══════════════════════════════════════════════════════════
// GET /api/impact/platform
// Platform-wide impact stats (PUBLIC — buat landing page)
// Total users, listings, transactions, kg saved, co2 saved, GMV
// ═══════════════════════════════════════════════════════════
export const getPlatformStats = async (req, res) => {
  // ─── Query 1: platform stats (sama kayak sebelumnya) ───
  const { data, error } = await supabaseAdmin
    .from('platform_stats')
    .select('*')
    .single();

  if (error) {
    console.error('[getPlatformStats]', error);
    throw error;
  }

  const rounded = {
    total_users:        Number(data.total_users)        || 0,
    total_listings:     Number(data.total_listings)     || 0,
    total_transactions: Number(data.total_transactions) || 0,
    total_kg_saved:     Math.round(Number(data.total_kg_saved)  || 0),
    total_co2_saved:    Math.round(Number(data.total_co2_saved) || 0),
    total_gmv:          Math.round(Number(data.total_gmv)       || 0),
  };

  const equivalentCarKm = Math.round(rounded.total_co2_saved * 4.6);
  const equivalentTrees = Math.round(rounded.total_co2_saved / 21);

  // ─── Query 2: CO2 breakdown per category dari transaksi COMPLETED ───
  const { data: txData, error: txError } = await supabaseAdmin
    .from('transactions')
    .select(`
      co2_saved,
      listing:listings!transactions_listing_id_fkey (
        category:categories!listings_category_id_fkey (
          name
        )
      )
    `)
    .eq('status', 'COMPLETED')
    .gt('co2_saved', 0);

  // Kalo query breakdown gagal, tetap return stats tanpa breakdown
  let breakdown = [];
  if (!txError && txData) {
    // Group by category name, sum co2_saved
    const grouped = {};
    txData.forEach(tx => {
      const catName = tx.listing?.category?.name || 'Other';
      grouped[catName] = (grouped[catName] || 0) + Number(tx.co2_saved);
    });

    const total = rounded.total_co2_saved || 1; // hindari division by zero
    breakdown = Object.entries(grouped)
  .map(([category, co2_saved]) => ({
    category,
    co2_saved: Math.round(co2_saved * 10) / 10, // 1 desimal, bukan integer
    percentage: Math.round((co2_saved / total) * 1000) / 10,
  }))
  .filter(item => item.co2_saved > 0) // filter setelah sum
  .sort((a, b) => b.co2_saved - a.co2_saved)
  }

  res.json({
    stats: rounded,
    equivalents: {
      car_km_avoided:         equivalentCarKm,
      trees_planted_equivalent: equivalentTrees,
    },
    breakdown, // [] kalau belum ada transaksi COMPLETED
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
    .gt('co2_saved', 0) // exclude user 0 impact
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