// src/controllers/conversationController.js
import { supabaseAdmin } from '../config/supabase.js';
import {
  required,
  validString,
  validUUID,
  validNumber,
  ValidationError,
} from '../utils/validator.js';

const MESSAGE_MAX_LEN = 500;
const DEFAULT_MSG_LIMIT = 50;
const MAX_MSG_LIMIT = 100;

// ═══════════════════════════════════════════════════════════
// POST /api/conversations
// Start atau resume conversation di sebuah listing.
// Body: { listing_id, message }
//
// Logic:
// 1. Cek listing exists & status AVAILABLE
// 2. Cek pengirim BUKAN seller listing (gak bisa chat diri sendiri)
// 3. Cek apa udah ada conversation buyer↔listing
//    - Ada  → reuse, kirim message ke conversation itu
//    - Belum → bikin baru, kirim message pertama
// 4. Insert message
// 5. Trigger DB auto-update last_message_at
// ═══════════════════════════════════════════════════════════
export const startConversation = async (req, res) => {
  const { listing_id, message } = req.body;

  // ─── Validate input ───
  validUUID(required(listing_id, 'listing_id'), 'listing_id');
  const content = validString(
    required(message, 'message'),
    'message',
    { min: 1, max: MESSAGE_MAX_LEN }
  );

  const buyerId = req.user.id;

  // ─── Fetch listing ───
  const { data: listing, error: listingErr } = await supabaseAdmin
    .from('listings')
    .select('id, seller_id, status, title')
    .eq('id', listing_id)
    .single();

  if (listingErr || !listing) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Listing tidak ditemukan',
    });
  }

  // ─── Business rule: gak bisa chat listing sendiri ───
  if (listing.seller_id === buyerId) {
    return res.status(400).json({
      error: 'Invalid action',
      message: 'Lu gak bisa chat ke listing sendiri bre',
    });
  }

  // ─── Business rule: cuma listing AVAILABLE/RESERVED yang bisa di-chat ───
  if (!['AVAILABLE', 'RESERVED'].includes(listing.status)) {
    return res.status(400).json({
      error: 'Invalid action',
      message: `Listing status '${listing.status}' tidak bisa di-chat`,
    });
  }

  // ─── Cek apa udah ada conversation existing ───
  // UNIQUE constraint di DB: (listing_id, buyer_id)
  let { data: conversation, error: convErr } = await req.supabase
    .from('conversations')
    .select('id, listing_id, buyer_id, seller_id')
    .eq('listing_id', listing_id)
    .eq('buyer_id', buyerId)
    .maybeSingle(); // maybeSingle = boleh null, beda dari single() yg error kalo 0 rows

  if (convErr) {
    console.error('[fetchConversation]', convErr);
    throw convErr;
  }

  // ─── Kalo belum ada, bikin baru ───
  if (!conversation) {
    const { data: newConv, error: createErr } = await req.supabase
      .from('conversations')
      .insert({
        listing_id,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
      })
      .select()
      .single();

    if (createErr) {
      console.error('[createConversation]', createErr);
      throw createErr;
    }

    conversation = newConv;
  }

  // ─── Insert message ───
  const { data: msg, error: msgErr } = await req.supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_id: buyerId,
      content,
    })
    .select()
    .single();

  if (msgErr) {
    console.error('[insertMessage]', msgErr);
    throw msgErr;
  }

  res.status(201).json({
    message: 'Conversation berhasil dibuat',
    conversation: {
      ...conversation,
      listing_title: listing.title,
    },
    first_message: msg,
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/conversations
// List semua conversation user (sebagai buyer ATAU seller).
// Diurutkan by last_message_at (chat terbaru di atas).
// Include preview last message + unread count.
// ═══════════════════════════════════════════════════════════
export const getMyConversations = async (req, res) => {
  const userId = req.user.id;

  // ─── Fetch conversations ───
  // RLS udah jaga: cuma yg user adalah buyer ATAU seller
  // Tapi tambahin filter eksplisit biar query plan-nya lebih efisien
  const { data: conversations, error } = await req.supabase
    .from('conversations')
    .select(
      `
      id, listing_id, buyer_id, seller_id, last_message_at, created_at,
      listing:listings!conversations_listing_id_fkey (
        id, title, status,
        photos:listing_photos (url, is_primary)
      ),
      buyer:users!conversations_buyer_id_fkey (id, full_name, avatar_url),
      seller:users!conversations_seller_id_fkey (id, full_name, avatar_url)
    `
    )
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) throw error;

  // ─── Enrich tiap conversation dengan last message + unread count ───
  // Loop sequentially. Buat MVP cukup, kalo perf jadi issue nanti optimize.
  const enriched = await Promise.all(
    conversations.map(async (conv) => {
      // Last message preview
      const { data: lastMsg } = await req.supabase
        .from('messages')
        .select('id, sender_id, content, created_at, read_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Unread count (message dari LAWAN BICARA yang belum dibaca)
      const { count: unreadCount } = await req.supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', userId) // bukan dari diri sendiri
        .is('read_at', null);

      // Tentuin "lawan bicara" buat FE display
      const isBuyer = conv.buyer_id === userId;
      const otherUser = isBuyer ? conv.seller : conv.buyer;
      const myRole = isBuyer ? 'BUYER' : 'SELLER';

      // Filter primary photo dari listing
      const primaryPhoto = conv.listing?.photos?.find((p) => p.is_primary);

      return {
        id: conv.id,
        listing: {
          id: conv.listing.id,
          title: conv.listing.title,
          status: conv.listing.status,
          primary_photo: primaryPhoto?.url || null,
        },
        other_user: otherUser,
        my_role: myRole,
        last_message: lastMsg,
        unread_count: unreadCount || 0,
        last_message_at: conv.last_message_at,
        created_at: conv.created_at,
      };
    })
  );

  res.json({
    count: enriched.length,
    conversations: enriched,
  });
};

// ═══════════════════════════════════════════════════════════
// GET /api/conversations/:id/messages
// Get message history dari 1 conversation, dengan pagination.
// Default urutan: terbaru dulu (chat UI render dari bawah).
// ═══════════════════════════════════════════════════════════
export const getMessages = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const {
    page = '1',
    limit = String(DEFAULT_MSG_LIMIT),
  } = req.query;

  const pageNum = validNumber(page, 'page', { min: 1, integer: true });
  const limitNum = validNumber(limit, 'limit', {
    min: 1,
    max: MAX_MSG_LIMIT,
    integer: true,
  });
  const offset = (pageNum - 1) * limitNum;

  // ─── Verify access ───
  // RLS udah jaga, tapi tambahin explicit check biar response-nya 404 yang clear
  // (bukan error generik PGRST116)
  const { data: conv } = await req.supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (!conv) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Conversation tidak ditemukan atau lu bukan participant',
    });
  }

  // ─── Fetch messages ───
  const {
    data: messages,
    error,
    count,
  } = await req.supabase
    .from('messages')
    .select(
      `
      id, conversation_id, sender_id, content, read_at, created_at,
      sender:users!messages_sender_id_fkey (id, full_name, avatar_url)
    `,
      { count: 'exact' }
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (error) throw error;

  res.json({
    messages, // newest first — FE bisa .reverse() kalo perlu oldest-first
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
// POST /api/conversations/:id/messages
// Kirim message baru ke conversation yang udah ada.
// AUTH required, harus participant.
// ═══════════════════════════════════════════════════════════
export const sendMessage = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  const content = validString(
    required(req.body.content, 'content'),
    'content',
    { min: 1, max: MESSAGE_MAX_LEN }
  );

  // ─── Verify conversation accessible ───
  // RLS udah filter, tapi cek dulu biar error message-nya jelas
  const { data: conv } = await req.supabase
    .from('conversations')
    .select('id, listing_id, buyer_id, seller_id')
    .eq('id', id)
    .maybeSingle();

  if (!conv) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Conversation tidak ditemukan atau lu bukan participant',
    });
  }

  // ─── Insert message ───
  // Trigger DB auto-update conversations.last_message_at
  const { data: msg, error } = await req.supabase
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: req.user.id,
      content,
    })
    .select(
      `
      id, conversation_id, sender_id, content, read_at, created_at,
      sender:users!messages_sender_id_fkey (id, full_name, avatar_url)
    `
    )
    .single();

  if (error) {
    console.error('[sendMessage]', error);
    throw error;
  }

  res.status(201).json({
    message: 'Message terkirim',
    data: msg,
  });
};

// ═══════════════════════════════════════════════════════════
// PATCH /api/conversations/:id/read
// Mark all unread messages dari LAWAN BICARA sebagai read.
// Dipake waktu user buka chat — auto-mark-as-read.
// ═══════════════════════════════════════════════════════════
export const markAsRead = async (req, res) => {
  const { id } = req.params;
  validUUID(id, 'id');

  // ─── Update messages: yang sender_id ≠ me, AND read_at IS NULL ───
  // RLS policy 'messages_receiver_update' restrict: auth.uid() != sender_id
  const { data, error } = await req.supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', id)
    .neq('sender_id', req.user.id)
    .is('read_at', null)
    .select('id');

  if (error) {
    console.error('[markAsRead]', error);
    throw error;
  }

  res.json({
    message: 'Marked as read',
    updated_count: data?.length || 0,
  });
};