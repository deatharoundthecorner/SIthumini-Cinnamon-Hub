/**
 * Server-side Database Repository & Supabase Access Layer
 * Sithumini Cinnamon Hub
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { isTest, safeMaskPhone } from '../config.js';
import { parsePriceString, getNumericPrice } from '../../utils/pricingCore.js';

const isProduction = () => process.env.NODE_ENV === 'production';

const PUBLIC_PRODUCTS_PATH = path.resolve(process.cwd(), 'public', 'products.json');
const ROOT_PRODUCTS_PATH = path.resolve(process.cwd(), 'products.json');

// In-memory fallback layer for local dev/testing
const memoryConversationStore = new Map();
const memoryInbox = new Map();
let memoryCatalogFallback = null;

let supabaseInstance = null;

export function getSupabase() {
  if (supabaseInstance) return supabaseInstance;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    try {
      supabaseInstance = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return supabaseInstance;
    } catch (err) {
      console.error('[Supabase Init Error]', err);
      return null;
    }
  }

  return null;
}

export function isSupabaseConnected() {
  return !!getSupabase();
}

/**
 * Loads products from Supabase database with prices.
 * Actionable setup error if database is connected but contains 0 active products.
 */
export async function getProducts() {
  const supabase = getSupabase();

  if (supabase) {
    try {
      const { data: dbProducts, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true);

      if (prodErr) throw prodErr;

      // Actionable setup error if database contains 0 active products
      if (!dbProducts || dbProducts.length === 0) {
        const setupMsg = '[CATALOG SETUP REQUIRED] Database is connected but contains 0 active products. Please execute "supabase/seed/20261027_initial_catalog_seed.sql" to initialize the catalog.';
        console.warn(setupMsg);
        if (isProduction()) {
          throw new Error(setupMsg);
        }
      }

      const { data: dbPrices, error: priceErr } = await supabase
        .from('product_prices')
        .select('*')
        .eq('is_active', true);

      if (priceErr) throw priceErr;

      const pricesByProduct = new Map();
      for (const row of dbPrices || []) {
        if (!pricesByProduct.has(row.product_id)) {
          pricesByProduct.set(row.product_id, {});
        }
        pricesByProduct.get(row.product_id)[row.market] = row;
      }

      return (dbProducts || []).map((p) => {
        const prices = pricesByProduct.get(p.id) || {};
        const lk = prices['lk'];
        const intl = prices['intl'];

        const hasValidExport = intl && Number(intl.price_amount) > 0;

        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          category: p.category,
          imageUrl: p.image_url,
          stock: p.stock ?? undefined,
          price: lk ? lk.display_price : 'Rs. 0',
          priceValue: lk ? Number(lk.price_amount) : 0,
          exportPrice: hasValidExport ? intl.display_price : undefined,
          exportPriceValue: hasValidExport ? Number(intl.price_amount) : undefined,
        };
      });
    } catch (err) {
      if (isProduction()) {
        console.error('[Database Error] Failed loading products from Supabase in production:', err.message);
        throw new Error(`Database unavailable: ${err.message}`);
      }
      console.warn('[Database Warning] Falling back to local catalog file:', err.message);
    }
  }

  // Memory fallback for tests / local dev
  if (memoryCatalogFallback) {
    return memoryCatalogFallback;
  }

  // Fallback: Read from public/products.json (the verified storefront catalog)
  try {
    const rawPublic = await fs.readFile(PUBLIC_PRODUCTS_PATH, 'utf-8');
    const parsed = JSON.parse(rawPublic);
    memoryCatalogFallback = parsed;
    return parsed;
  } catch (err) {
    try {
      const rawRoot = await fs.readFile(ROOT_PRODUCTS_PATH, 'utf-8');
      const parsed = JSON.parse(rawRoot);
      memoryCatalogFallback = parsed;
      return parsed;
    } catch (fallbackErr) {
      console.error('[Catalog File Error] Could not read fallback products:', fallbackErr.message);
      return [];
    }
  }
}

/**
 * Persists products and independent local/export prices.
 * - Fails safely in production if Supabase is unavailable.
 * - Executes atomic PostgreSQL function save_products_atomic when database is connected.
 * - Robust price parsing; invalid or unconfigured export prices are strictly deleted (never USD 0.00).
 */
export async function saveProducts(productsList) {
  if (!Array.isArray(productsList) || productsList.length === 0) {
    throw new Error('Invalid products payload: Expected non-empty array of products.');
  }

  // Validate all products before starting database transaction
  for (const item of productsList) {
    if (!item.id || typeof item.id !== 'string' || item.id.trim() === '') {
      throw new Error('Product update rejected: Missing or invalid product ID.');
    }
    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      throw new Error(`Product update rejected for ID ${item.id}: Missing product name.`);
    }
    const localVal = typeof item.priceValue === 'number' && !isNaN(item.priceValue) && item.priceValue > 0
      ? item.priceValue
      : parsePriceString(item.price);
    if (!localVal || localVal <= 0) {
      throw new Error(`Product update rejected for ID ${item.id} (${item.name}): Local LKR price must be a strictly positive amount.`);
    }
  }

  // Invalidate in-memory cache so subsequent reads reflect authoritative writes
  memoryCatalogFallback = null;

  const cleansedList = productsList.map((item) => {
    const localVal = typeof item.priceValue === 'number' && !isNaN(item.priceValue) && item.priceValue > 0
      ? item.priceValue
      : parsePriceString(item.price);

    const localDisplay = item.price && parsePriceString(item.price) === localVal
      ? item.price
      : `Rs. ${localVal.toLocaleString('en-US')}`;

    let exportVal = null;
    if (typeof item.exportPriceValue === 'number' && !isNaN(item.exportPriceValue) && item.exportPriceValue > 0) {
      exportVal = item.exportPriceValue;
    } else if (item.exportPrice && typeof item.exportPrice === 'string') {
      const raw = item.exportPrice.trim().toLowerCase();
      if (raw !== 'request export pricing' && raw !== 'n/a' && raw !== 'none' && raw !== '') {
        const parsed = parsePriceString(item.exportPrice);
        if (parsed > 0) exportVal = parsed;
      }
    }

    const exportDisplay = exportVal ? (item.exportPrice && parsePriceString(item.exportPrice) === exportVal ? item.exportPrice : `$${exportVal.toFixed(2)}`) : undefined;

    return {
      ...item,
      price: localDisplay,
      priceValue: localVal,
      exportPrice: exportDisplay,
      exportPriceValue: exportVal || undefined,
    };
  });

  const supabase = getSupabase();

  if (isProduction() && !supabase) {
    throw new Error('Database connection unavailable: Cannot save catalog in production.');
  }

  if (supabase) {
    // Transactional atomic update via RPC
    const { error: rpcErr } = await supabase.rpc('save_products_atomic', {
      p_products: cleansedList,
    });

    if (rpcErr) {
      console.error('[Database Error] save_products_atomic failed:', rpcErr.message);
      throw new Error(`Catalog persistence failed: ${rpcErr.message}`);
    }

    return { ok: true, savedToDb: true };
  }

  // Non-production fallback
  memoryCatalogFallback = cleansedList;

  const allowDiskFallbackWrite = process.env.NODE_ENV === 'development' && process.env.ENABLE_LOCAL_DISK_SAVE === 'true';
  if (allowDiskFallbackWrite) {
    try {
      await fs.writeFile(PUBLIC_PRODUCTS_PATH, JSON.stringify(cleansedList, null, 2), 'utf-8');
      await fs.writeFile(ROOT_PRODUCTS_PATH, JSON.stringify(cleansedList, null, 2), 'utf-8');
    } catch (fsErr) {
      console.warn('[Storage Warning] Local catalog disk write failed:', fsErr.message);
    }
  }

  return { ok: true, savedToDb: false, simulated: true };
}

/**
 * Saves a new order request with server-side validation and atomic RPC persistence.
 * Prevents partial writes (orphaned orders without line items).
 */
export async function createOrderRequest({
  orderRef,
  market,
  currency,
  destinationCountry,
  customerName,
  customerPhone,
  items,
  customerNotes,
  source = 'whatsapp_bot',
}) {
  if (market === 'lk' && currency !== 'LKR') {
    throw new Error(`Currency mismatch: Market 'lk' requires 'LKR', got '${currency}'`);
  }
  if (market === 'intl' && currency !== 'USD') {
    throw new Error(`Currency mismatch: Market 'intl' requires 'USD', got '${currency}'`);
  }
  if (market !== 'lk' && market !== 'intl') {
    throw new Error(`Invalid market '${market}'`);
  }
  if (!orderRef || !Array.isArray(items) || items.length === 0) {
    throw new Error('Invalid order request payload');
  }

  // 1. Authoritative Server-side Price & Quantity Validation
  const catalog = await getProducts();
  let authoritativeSubtotal = 0;
  const validatedItems = [];

  for (const it of items) {
    const qty = parseInt(String(it.quantity), 10);
    if (isNaN(qty) || qty <= 0 || !Number.isInteger(Number(it.quantity)) || qty > 1000) {
      throw new Error(`Invalid quantity ${it.quantity} for product ${it.productId || it.productName}`);
    }

    const catalogItem = catalog.find((c) => String(c.id) === String(it.productId));
    if (!catalogItem) {
      throw new Error(`Product ${it.productId} not found in catalog`);
    }

    const unitPrice = getNumericPrice(catalogItem, market);
    if (unitPrice === null || unitPrice <= 0) {
      throw new Error(`Product ${catalogItem.name} does not have a configured price in market '${market}'`);
    }

    const lineTotal = unitPrice * qty;
    authoritativeSubtotal += lineTotal;

    validatedItems.push({
      product_id: String(catalogItem.id),
      product_name: catalogItem.name,
      quantity: qty,
      unit_price: unitPrice,
      line_total: lineTotal,
    });
  }

  const supabase = getSupabase();

  if (isProduction() && !supabase) {
    throw new Error('Database connection unavailable: Cannot record order in production.');
  }

  if (supabase) {
    // Atomic PostgreSQL RPC call
    const { data: orderId, error: rpcErr } = await supabase.rpc('create_order_request_atomic', {
      p_order_ref: orderRef,
      p_customer_name: customerName || 'Valued Customer',
      p_customer_phone: customerPhone,
      p_market: market,
      p_currency: currency,
      p_destination_country: destinationCountry || null,
      p_customer_notes: customerNotes || null,
      p_subtotal: authoritativeSubtotal,
      p_source: source,
      p_items: validatedItems,
    });

    if (rpcErr) {
      console.error('[Database Error] create_order_request_atomic failed:', rpcErr.message);
      throw new Error(`Order creation failed: ${rpcErr.message}`);
    }

    return { ok: true, persisted: true, orderRef, orderId, subtotal: authoritativeSubtotal };
  }

  return { ok: true, persisted: false, orderRef, subtotal: authoritativeSubtotal, simulated: true };
}

/**
 * Saves a customer review with strict 'pending_moderation' status.
 */
export async function saveCustomerReview({
  productId,
  customerName,
  customerPhone,
  rating,
  comment,
  source = 'whatsapp_bot',
}) {
  const numRating = parseInt(String(rating), 10);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    throw new Error('Rating must be an integer between 1 and 5');
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    throw new Error('Review comment cannot be empty');
  }

  const supabase = getSupabase();

  if (isProduction() && !supabase) {
    throw new Error('Database connection unavailable: Cannot record customer review in production.');
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        product_id: productId ? String(productId) : null,
        customer_name: customerName || 'WhatsApp Customer',
        customer_phone: customerPhone,
        rating: numRating,
        comment: comment.trim(),
        status: 'pending_moderation',
        source,
      })
      .select('id')
      .single();

    if (error) throw error;
    return { ok: true, persisted: true, id: data.id };
  }

  return { ok: true, persisted: false, id: `local-${Date.now()}`, simulated: true };
}

/**
 * Durably persists an incoming webhook event into whatsapp_inbox BEFORE acknowledgment.
 */
export async function persistWebhookEventToInbox({ messageId, senderPhone, messageText, rawPayload }) {
  if (!messageId) throw new Error('Missing message ID for webhook ingestion');

  const supabase = getSupabase();

  if (isProduction() && !supabase) {
    throw new Error('Durable database unavailable: Webhook event cannot be persisted in production.');
  }

  if (supabase) {
    const { error } = await supabase.from('whatsapp_inbox').insert({
      message_id: messageId,
      sender_phone: senderPhone,
      message_text: messageText,
      raw_payload: rawPayload || {},
      status: 'received',
      attempts: 0,
      created_at: new Date().toISOString(),
    });

    if (error && !error.message.includes('duplicate key') && !error.code?.includes('23505')) {
      throw error;
    }

    return { ok: true, persisted: true };
  }

  // Memory fallback for tests / local dev
  if (!memoryInbox.has(messageId)) {
    memoryInbox.set(messageId, {
      messageId,
      senderPhone,
      messageText,
      rawPayload,
      status: 'received',
      attempts: 0,
      createdAt: Date.now(),
    });
  }

  return { ok: true, persisted: false, simulated: true };
}

/**
 * Atomically claims an inbox message for processing using FOR UPDATE.
 */
export async function claimInboxLock(messageId, { bypassBackoff = false } = {}) {
  if (!messageId) return { claimed: false, reason: 'missing_id' };

  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot acquire inbox lock in production.');
  }

  if (supabase) {
    const { data, error } = await supabase.rpc('claim_inbox_message_atomic', {
      p_message_id: messageId,
    });
    if (error) {
      if (isProduction()) {
        throw new Error(`Database lock RPC failed: ${error.message}`);
      }
      console.warn('[Inbox Lock RPC Error]', error.message);
    } else if (Array.isArray(data) && data.length > 0) {
      return {
        claimed: data[0].claimed,
        reason: data[0].reason,
        attempts: data[0].attempts,
      };
    }
  }

  // Atomic in-memory lock for dev/tests
  const now = Date.now();
  const entry = memoryInbox.get(messageId);
  if (!entry) {
    memoryInbox.set(messageId, {
      status: 'processing',
      attempts: 1,
      lockedAt: now,
    });
    return { claimed: true, reason: 'lock_acquired', attempts: 1 };
  }

  if (entry.status === 'completed') {
    return { claimed: false, reason: 'already_completed', attempts: entry.attempts };
  }
  if (entry.status === 'dead_letter' || (entry.attempts >= (entry.maxAttempts || 5))) {
    entry.status = 'dead_letter';
    return { claimed: false, reason: 'dead_letter', attempts: entry.attempts };
  }
  if (entry.status === 'processing' && (now - (entry.lockedAt || 0)) < 60000) {
    return { claimed: false, reason: 'concurrent_lock_active', attempts: entry.attempts };
  }
  if (entry.status === 'failed' && !bypassBackoff) {
    const backoffMs = Math.pow(2, Math.min((entry.attempts || 1) - 1, 6)) * 10000;
    if ((now - (entry.lockedAt || 0)) < backoffMs) {
      return { claimed: false, reason: 'backoff_active', attempts: entry.attempts };
    }
  }

  entry.status = 'processing';
  entry.attempts = (entry.attempts || 0) + 1;
  entry.lockedAt = now;
  return { claimed: true, reason: 'lock_acquired', attempts: entry.attempts };
}

export async function completeInboxMessage(messageId) {
  if (!messageId) return;
  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot complete inbox message in production.');
  }

  if (supabase) {
    const { error } = await supabase.from('whatsapp_inbox').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('message_id', messageId);
    if (error) {
      if (isProduction()) {
        throw new Error(`Database error completing inbox message: ${error.message}`);
      }
      console.warn('[Inbox Complete Error]', error.message);
    }
    return;
  }

  const mem = memoryInbox.get(messageId);
  if (mem) {
    mem.status = 'completed';
    mem.completedAt = Date.now();
  }
}

export async function recordInboxFailure(messageId, errorMsg) {
  if (!messageId) return;
  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot record inbox failure in production.');
  }

  if (supabase) {
    const { data, error: fetchErr } = await supabase
      .from('whatsapp_inbox')
      .select('attempts, max_attempts')
      .eq('message_id', messageId)
      .single();
    if (fetchErr) {
      if (isProduction()) {
        throw new Error(`Database error fetching inbox message state: ${fetchErr.message}`);
      }
    }

    const isDeadLetter = data && data.attempts >= (data.max_attempts || 5);
    const { error: updateErr } = await supabase.from('whatsapp_inbox').update({
      status: isDeadLetter ? 'dead_letter' : 'failed',
      last_error: errorMsg,
      locked_at: new Date().toISOString(),
    }).eq('message_id', messageId);
    if (updateErr) {
      if (isProduction()) {
        throw new Error(`Database error recording inbox failure: ${updateErr.message}`);
      }
    }
    return;
  }

  const mem = memoryInbox.get(messageId);
  if (mem) {
    mem.status = (mem.attempts >= (mem.maxAttempts || 5)) ? 'dead_letter' : 'failed';
    mem.lastError = errorMsg;
    mem.lockedAt = Date.now();
  }
}

export async function getConversationSession(phone) {
  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot load conversation session in production.');
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('phone_number', phone)
      .single();

    if (error && error.code !== 'PGRST116') {
      if (isProduction()) {
        throw new Error(`Database error loading conversation session: ${error.message}`);
      }
    }

    if (data) {
      return {
        state: data.state,
        data: data.session_data || {},
      };
    }
    return { state: 'AWAITING_MARKET', data: {} };
  }

  return memoryConversationStore.get(phone) || { state: 'AWAITING_MARKET', data: {} };
}

export async function saveConversationSession(phone, state, sessionData) {
  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot persist conversation session in production.');
  }

  if (supabase) {
    const { error } = await supabase.from('whatsapp_conversations').upsert({
      phone_number: phone,
      state,
      session_data: sessionData || {},
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isProduction()) {
        throw new Error(`Failed to persist conversation session in database: ${error.message}`);
      }
      console.warn('[Session Save Error]', error.message);
    }
    return;
  }

  memoryConversationStore.set(phone, { state, data: sessionData });
}

export async function getPendingInboxMessages(limit = 20) {
  const supabase = getSupabase();
  if (isProduction() && !supabase) {
    throw new Error('Database unavailable: Cannot query pending inbox messages in production.');
  }

  if (supabase) {
    const { data, error } = await supabase.rpc('get_pending_inbox_messages', {
      p_limit: limit,
    });
    if (error) {
      if (isProduction()) {
        throw new Error(`Database error querying pending inbox messages: ${error.message}`);
      }
      console.warn('[Inbox Pending RPC Error]', error.message);
    }
    return data || [];
  }

  const now = Date.now();
  const eligible = [];
  for (const [id, entry] of memoryInbox.entries()) {
    const attempts = entry.attempts || 0;
    const maxAttempts = entry.maxAttempts || 5;
    if (entry.status === 'received') {
      eligible.push({ message_id: id, sender_phone: entry.senderPhone, message_text: entry.messageText, attempts, status: entry.status });
    } else if (entry.status === 'failed' && attempts < maxAttempts) {
      const backoffMs = Math.pow(2, Math.min(attempts - 1, 6)) * 10000;
      if (now - (entry.lockedAt || 0) >= backoffMs) {
        eligible.push({ message_id: id, sender_phone: entry.senderPhone, message_text: entry.messageText, attempts, status: entry.status });
      }
    } else if (entry.status === 'processing' && now - (entry.lockedAt || 0) >= 120000) {
      eligible.push({ message_id: id, sender_phone: entry.senderPhone, message_text: entry.messageText, attempts, status: entry.status });
    }
    if (eligible.length >= limit) break;
  }
  return eligible;
}

export async function acquireMessageLock(messageId, senderPhone, messageText) {
  const result = await claimInboxLock(messageId, { bypassBackoff: true });
  return {
    canProcess: result.claimed,
    reason: result.reason === 'lock_acquired' ? 'lock_acquired' : (result.reason === 'concurrent_lock_active' ? 'currently_processing' : result.reason),
    attempts: result.attempts,
  };
}

export async function completeMessage(messageId) {
  return completeInboxMessage(messageId);
}

export async function failMessage(messageId, errorMsg) {
  return recordInboxFailure(messageId, errorMsg);
}
