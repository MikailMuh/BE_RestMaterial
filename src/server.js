import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabaseAdmin } from './config/supabase.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import listingRoutes from './routes/listings.js';
import conversationRoutes from './routes/conversations.js';
import userRoutes from './routes/users.js';
import transactionRoutes from './routes/transactions.js';
import reviewRoutes from './routes/reviews.js';
import impactRoutes from './routes/impact.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// CORS Configuration (single, multi-origin)
// ═══════════════════════════════════════════════════════════
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://fe-restmaterial.vercel.app', // production FE (hardcode safety net)
  process.env.FRONTEND_URL, // dari Railway env (bisa di-update tanpa redeploy code)
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests dengan no origin (Postman, mobile apps, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS blocked] origin: ${origin}`);
        callback(new Error(`Origin "${origin}" not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ═══════════════════════════════════════════════════════════
// Body Parsers
// ═══════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════════════════
// Health Check Routes
// ═══════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    status: 'oke',
    service: 'REST Material API',
    timestamp: new Date().toISOString(),
    cors_origins: allowedOrigins, // bantu debug — bisa dihapus nanti
  });
});

app.get('/api/health/supabase', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('id, name')
      .limit(1);

    if (error) throw error;

    res.json({
      status: 'connected',
      sample: data,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════════════════════
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/impact', impactRoutes);

// ═══════════════════════════════════════════════════════════
// 404 Handler
// ═══════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ═══════════════════════════════════════════════════════════
// Global Error Handler
// ═══════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);

  // Validation error dari validator helper
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      message: err.message,
      field: err.field,
    });
  }

  // Default error handler
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ═══════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  console.log(`📊 Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Allowed CORS origins:`, allowedOrigins);
});