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


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true,
    })
);

app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
    res.json({
        status: 'oke',
        service: 'REST Material API',
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/health/supabase', async (req, res) => {
  try {
    // Query ringan ke tabel categories (harusnya udah ada seed data)
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

// ini api routesnya
app.use('/api/auth', authRoutes);
// tambahin category routes
app.use('/api/categories', categoryRoutes);
// tambahin listing routes
app.use('/api/listings', listingRoutes);
// buat conversation routes
app.use('/api/conversations', conversationRoutes);
// buat user routes
app.use('/api/users', userRoutes);
// buat transaction routes
app.use('/api/transactions', transactionRoutes);

app.use((req, res) => {
    res.status(404).json({eror: 'Route not found'});
});

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

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  console.log(`📊 Env: ${process.env.NODE_ENV || 'development'}`);
});