// src/controllers/categoryController.js
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/categories
 * Return semua kategori (main + sub) flat, urut alfabet.
 * Pake supabaseAdmin karena data ini public (RLS policy juga udah allow).
 */
export const getAllCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      count: data.length,
      categories: data,
    });
  } catch (err) {
    console.error('[getAllCategories]', err);
    res.status(500).json({
      error: 'Failed to fetch categories',
      message: err.message,
    });
  }
};

/**
 * GET /api/categories/tree
 * Return kategori dalam bentuk nested tree (main → children).
 * FE tinggal render rapi tanpa perlu process ulang.
 *
 * Format:
 * [
 *   { id, name, slug, ..., children: [{ id, name, slug, ... }] },
 *   ...
 * ]
 */
export const getCategoryTree = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    // Bikin map { id → category } biar lookup cepat
    const map = new Map();
    data.forEach((cat) => {
      map.set(cat.id, { ...cat, children: [] });
    });

    // Pisahin jadi root (main) & nested (sub)
    const tree = [];
    map.forEach((cat) => {
      if (cat.parent_id === null) {
        // Kategori utama → push ke root
        tree.push(cat);
      } else {
        // Subkategori → push ke children parent-nya
        const parent = map.get(cat.parent_id);
        if (parent) parent.children.push(cat);
      }
    });

    res.json({
      count: tree.length,
      tree,
    });
  } catch (err) {
    console.error('[getCategoryTree]', err);
    res.status(500).json({
      error: 'Failed to fetch category tree',
      message: err.message,
    });
  }
};

/**
 * GET /api/categories/main
 * Return hanya kategori utama (parent_id = NULL).
 * Berguna buat landing page atau filter cepat.
 */
export const getMainCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .is('parent_id', null)
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      count: data.length,
      categories: data,
    });
  } catch (err) {
    console.error('[getMainCategories]', err);
    res.status(500).json({
      error: 'Failed to fetch main categories',
      message: err.message,
    });
  }
};

/**
 * GET /api/categories/:slug
 * Detail 1 kategori berdasarkan slug + list subcategory-nya (kalo ada).
 * Dipake di page "Browse by Category" → /categories/structural
 */
export const getCategoryBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1. Cari kategori by slug
    const { data: category, error: catError } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .single();

    if (catError || !category) {
      return res.status(404).json({
        error: 'Category not found',
        message: `Kategori dengan slug '${slug}' tidak ada`,
      });
    }

    // 2. Cari subcategory-nya (kalo ini main category)
    const { data: children, error: childError } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('parent_id', category.id)
      .order('name', { ascending: true });

    if (childError) throw childError;

    res.json({
      ...category,
      children: children || [],
    });
  } catch (err) {
    console.error('[getCategoryBySlug]', err);
    res.status(500).json({
      error: 'Failed to fetch category',
      message: err.message,
    });
  }
};