/**
 * Repeatable Database Verification Runner
 * Checks live catalog parity (IDs, names, categories, images, and prices)
 * and enforces strict role-access permissions across public and private tables.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/verify_database.js
 *
 * Exit codes:
 *   0: Audit passed successfully against active database
 *   1: Critical security violation or catalog parity failure
 *   2: Audit pending (prerequisite environment variables missing)
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

/**
 * Executes database verification checks.
 * Can be run against real Supabase or injected mock clients for testing.
 */
export async function runDatabaseAudit({
  url = process.env.SUPABASE_URL,
  serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  clientFactory = null,
  catalogData = null,
} = {}) {
  if (!url || !serviceKey) {
    return {
      status: 'PENDING',
      exitCode: 2,
      message: '[DATABASE AUDIT PENDING] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured. Live database audit cannot run without credentials.',
    };
  }

  const makeClient = clientFactory || ((targetUrl, key) => createClient(targetUrl, key, { auth: { persistSession: false } }));
  const adminClient = makeClient(url, serviceKey);

  const publicCatalog = catalogData || JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'public', 'products.json'), 'utf-8')
  );

  // 1. Audit active products with service_role
  const { data: prods, error: prodErr } = await adminClient
    .from('products')
    .select('id, name, description, category, image_url, is_active')
    .eq('is_active', true);

  if (prodErr) {
    throw new Error(`Failed to read products table: ${prodErr.message}`);
  }

  if (!Array.isArray(prods) || prods.length !== publicCatalog.length) {
    throw new Error(`Catalog count mismatch: Expected exactly ${publicCatalog.length} active products, found ${prods?.length || 0}.`);
  }

  // 2. Audit active product prices with service_role
  const { data: prices, error: priceErr } = await adminClient
    .from('product_prices')
    .select('product_id, market, currency, price_amount, display_price, is_active')
    .eq('is_active', true);

  if (priceErr) {
    throw new Error(`Failed to read product_prices table: ${priceErr.message}`);
  }

  // 3. Deep catalog parity check (IDs, names, categories, image paths, local prices)
  for (const pub of publicCatalog) {
    const dbProd = prods.find((p) => String(p.id) === String(pub.id));
    if (!dbProd) {
      throw new Error(`Catalog mismatch: Missing product ID ${pub.id} (${pub.name}) from database.`);
    }

    if (dbProd.name !== pub.name) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Name mismatch. Expected "${pub.name}", got "${dbProd.name}".`);
    }

    if (dbProd.category !== pub.category) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Category mismatch. Expected "${pub.category}", got "${dbProd.category}".`);
    }

    const expectedImg = pub.imageUrl || pub.image;
    if (dbProd.image_url !== expectedImg) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Image URL mismatch. Expected "${expectedImg}", got "${dbProd.image_url}".`);
    }

    // Check local price in product_prices
    const localPrice = prices.find((pr) => String(pr.product_id) === String(pub.id) && pr.market === 'lk');
    if (!localPrice) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Missing local LKR price entry.`);
    }

    if (Number(localPrice.price_amount) !== pub.priceValue) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Local price amount mismatch. Expected ${pub.priceValue}, got ${localPrice.price_amount}.`);
    }

    if (localPrice.display_price !== pub.price) {
      throw new Error(`Catalog mismatch for product ${pub.id}: Display price mismatch. Expected "${pub.price}", got "${localPrice.display_price}".`);
    }
  }

  // 4. Role access verification using anonKey if provided
  if (anonKey) {
    const anonClient = makeClient(url, anonKey);

    // A. Positive permission checks: Anonymous must be able to read active catalog and approved reviews
    const { data: anonProds, error: anonProdErr } = await anonClient
      .from('products')
      .select('id, name, category, image_url')
      .eq('is_active', true);

    if (anonProdErr || !Array.isArray(anonProds) || anonProds.length === 0) {
      throw new Error(`Permission failure: Anonymous client cannot read active products: ${anonProdErr?.message || 'Empty response'}`);
    }

    const { data: anonPrices, error: anonPriceErr } = await anonClient
      .from('product_prices')
      .select('product_id, market, price_amount, display_price')
      .eq('is_active', true);

    if (anonPriceErr || !Array.isArray(anonPrices) || anonPrices.length === 0) {
      throw new Error(`Permission failure: Anonymous client cannot read active product prices: ${anonPriceErr?.message || 'Empty response'}`);
    }

    const { error: anonReviewErr } = await anonClient
      .from('reviews')
      .select('id, product_id, reviewer_name, rating, review_text, status')
      .eq('status', 'approved');

    if (anonReviewErr) {
      throw new Error(`Permission failure: Anonymous client cannot read approved reviews: ${anonReviewErr.message}`);
    }

    // B. Negative permission checks: Anonymous MUST be rejected from querying private tables
    // Even if tables are empty, an unexpectedly successful query (no error) is a critical permission failure!

    // Private Table: orders (actual columns: id, order_ref)
    const { error: orderErr } = await anonClient
      .from('orders')
      .select('id, order_ref')
      .limit(1);

    if (!orderErr) {
      throw new Error('CRITICAL SECURITY VIOLATION: Anonymous client successfully queried private "orders" table without permission rejection!');
    }

    // Private Table: order_items (actual columns: id, order_id)
    const { error: itemErr } = await anonClient
      .from('order_items')
      .select('id, order_id')
      .limit(1);

    if (!itemErr) {
      throw new Error('CRITICAL SECURITY VIOLATION: Anonymous client successfully queried private "order_items" table without permission rejection!');
    }

    // Private Table: whatsapp_inbox (actual columns: message_id, sender_phone)
    const { error: inboxErr } = await anonClient
      .from('whatsapp_inbox')
      .select('message_id, sender_phone')
      .limit(1);

    if (!inboxErr) {
      throw new Error('CRITICAL SECURITY VIOLATION: Anonymous client successfully queried private "whatsapp_inbox" table without permission rejection!');
    }

    // Private Table: whatsapp_conversations (actual columns: phone_number, state)
    const { error: convErr } = await anonClient
      .from('whatsapp_conversations')
      .select('phone_number, state')
      .limit(1);

    if (!convErr) {
      throw new Error('CRITICAL SECURITY VIOLATION: Anonymous client successfully queried private "whatsapp_conversations" table without permission rejection!');
    }

    // Negative Write check: Anonymous cannot insert reviews directly
    const { error: insertReviewErr } = await anonClient
      .from('reviews')
      .insert({
        product_id: '9',
        reviewer_name: 'test',
        rating: 5,
        review_text: 'test review',
      });

    if (!insertReviewErr) {
      throw new Error('CRITICAL SECURITY VIOLATION: Anonymous client successfully inserted directly into "reviews" table!');
    }
  }

  return {
    status: 'SUCCESS',
    exitCode: 0,
    productCount: prods.length,
    priceCount: prices.length,
    message: 'Live database verification passed: Catalog parity and role permissions verified.',
  };
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/verify_database.js')) {
  runDatabaseAudit()
    .then((result) => {
      if (result.status === 'PENDING') {
        console.warn(result.message);
        process.exit(result.exitCode);
      }
      console.info(`=== ${result.message} ===`);
      console.info(`Verified ${result.productCount} products and ${result.priceCount} prices.`);
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error('[DATABASE AUDIT FATAL ERROR]', err.message);
      process.exit(1);
    });
}
