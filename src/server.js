import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabaseAdmin } from './config/supabase.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';


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

app.use((req, res) => {
    res.status(404).json({eror: 'Route not found'});
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  console.log(`📊 Env: ${process.env.NODE_ENV || 'development'}`);
});