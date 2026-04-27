import {supabaseAdmin, getSupabaseForUser} from '../config/supabase.js';

export const requireAuth = async (req, res, next) => {
  try {
    // 1. Ambil token dari header "Authorization: Bearer xxx"
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token tidak ditemukan di header Authorization',
      });
    }

    const token = authHeader.split(' ')[1]; // "Bearer xxx" → "xxx"

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token kosong',
      });
    }

    // 2. Verify token ke Supabase — getUser() bakal validate JWT
    //    dan return data user kalo valid, atau error kalo expired/invalid
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token invalid atau expired',
      });
    }

    // 3. Ambil data profile dari public.users (role, city, rating, dll)
    //    Ini yang kita bikin via trigger waktu signup
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User profile tidak ditemukan. Pastikan trigger auto-create jalan.',
      });
    }

    // 4. Attach ke req biar bisa diakses di controller
    req.user = user;                              // dari auth.users
    req.profile = profile;                        // dari public.users
    req.token = token;                            // raw JWT
    req.supabase = getSupabaseForUser(token);     // client dengan RLS context

    // 5. Lanjut ke handler berikutnya
    next();
  } catch (err) {
    console.error('[Auth Middleware Error]', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Gagal verify token',
    });
  }
};


export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Kalo gak ada token, skip aja — lanjut tanpa req.user
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next();

    // Coba verify, tapi kalo gagal, tetep lanjut (gak tolak)
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (!error && user) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      req.user = user;
      req.profile = profile;
      req.token = token;
      req.supabase = getSupabaseForUser(token);
    }

    next();
  } catch (err) {
    // Error di optional auth jangan blokir request
    console.error('[Optional Auth Error]', err);
    next();
  }
};

export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.profile) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'requireRole harus dipasang setelah requireAuth',
      });
    }

    if (!allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.profile.role}' tidak punya akses. Butuh: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};
