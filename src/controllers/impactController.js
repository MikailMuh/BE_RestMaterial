// src/controllers/impactController.js
import { supabaseAdmin } from '../config/supabase.js';
import { validNumber } from '../utils/validator.js';

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