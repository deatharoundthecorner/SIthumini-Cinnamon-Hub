/**
 * Cloudflare D1 Database Operations
 * Sithumini Cinnamon Hub
 * Parameterized queries, prepared statements, and atomic batch execution
 */

import { parsePriceString } from '../utils/pricingCore.js';

/**
 * Loads products from D1 database.
 * Never exposes private cost_price on public requests.
 */
export async function getProducts(db, { includeCost = false, isProduction = false, fallbackCatalog = null } = {}) {
  if (!db) {
    if (isProduction) {
      throw new Error('D1 database binding DB is not available in production.');
    }
    // Non-production fallback to static catalog
    if (fallbackCatalog && Array.isArray(fallbackCatalog)) {
      return fallbackCatalog;
    }
    return [];
  }

  const query = `
    SELECT
      p.id,
      p.name,
      p.description,
      p.category,
      p.image_url,
      p.stock,
      p.sort_order,
      p.is_active,
      p.cost_price,
      lk.price_amount as lk_price,
      lk.display_price as lk_display,
      intl.price_amount as intl_price,
      intl.display_price as intl_display
    FROM products p
    LEFT JOIN product_prices lk ON p.id = lk.product_id AND lk.market = 'lk' AND lk.is_active = 1
    LEFT JOIN product_prices intl ON p.id = intl.product_id AND intl.market = 'intl' AND intl.is_active = 1
    WHERE p.is_active = 1
    ORDER BY p.sort_order ASC, CAST(p.id AS INTEGER) ASC;
  `;

  const stmt = db.prepare(query);
  const { results, error } = await stmt.all();

  if (error) {
    throw new Error(`D1 query failed: ${error}`);
  }

  if (!results || results.length === 0) {
    return [];
  }

  return results.map((row) => {
    const item = {
      id: row.id,
      name: row.name,
      description: row.description || '',
      category: row.category || 'General',
      imageUrl: row.image_url || '',
      stock: row.stock !== null && row.stock !== undefined ? Number(row.stock) : null,
      sortOrder: row.sort_order ?? 0,
      price: row.lk_display || (row.lk_price ? `Rs. ${Number(row.lk_price).toLocaleString('en-US')}` : 'Rs. 0'),
      priceValue: row.lk_price ? Number(row.lk_price) : 0,
      exportPrice: row.intl_display || undefined,
      exportPriceValue: row.intl_price ? Number(row.intl_price) : undefined,
    };

    if (includeCost && row.cost_price !== null && row.cost_price !== undefined) {
      item.costPrice = Number(row.cost_price);
    }

    return item;
  });
}

/**
 * Validates and atomically saves catalog updates using D1 batch transaction.
 */
export async function saveProducts(db, productsList, actor = 'admin') {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Catalog could not be persisted.');
  }

  if (!Array.isArray(productsList) || productsList.length === 0) {
    throw new Error('Invalid products payload: Expected non-empty array of products.');
  }

  // Pre-batch validation: all items must be strictly valid
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

  const statements = [];

  for (let idx = 0; idx < productsList.length; idx++) {
    const item = productsList[idx];
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

    const exportDisplay = exportVal
      ? (item.exportPrice && parsePriceString(item.exportPrice) === exportVal ? item.exportPrice : `$${exportVal.toFixed(2)}`)
      : null;

    const stock = typeof item.stock === 'number' ? item.stock : null;
    const sortOrder = typeof item.sortOrder === 'number' ? item.sortOrder : idx + 1;
    const costPrice = typeof item.costPrice === 'number' ? item.costPrice : null;

    // 1. Upsert product
    statements.push(
      db.prepare(`
        INSERT INTO products (id, name, description, category, image_url, stock, sort_order, cost_price, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          image_url = excluded.image_url,
          stock = excluded.stock,
          sort_order = excluded.sort_order,
          cost_price = COALESCE(excluded.cost_price, products.cost_price),
          is_active = 1,
          updated_at = datetime('now');
      `).bind(
        item.id,
        item.name,
        item.description || '',
        item.category || 'General',
        item.imageUrl || item.image || '',
        stock,
        sortOrder,
        costPrice
      )
    );

    // 2. Upsert local LKR price
    const lkPriceId = `price_lk_${item.id}`;
    statements.push(
      db.prepare(`
        INSERT INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active, updated_at)
        VALUES (?, ?, 'lk', 'LKR', ?, ?, 1, datetime('now'))
        ON CONFLICT (product_id, market) DO UPDATE SET
          price_amount = excluded.price_amount,
          display_price = excluded.display_price,
          is_active = 1,
          updated_at = datetime('now');
      `).bind(lkPriceId, item.id, localVal, localDisplay)
    );

    // 3. Upsert or delete international USD price
    if (exportVal && exportDisplay) {
      const intlPriceId = `price_intl_${item.id}`;
      statements.push(
        db.prepare(`
          INSERT INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active, updated_at)
          VALUES (?, ?, 'intl', 'USD', ?, ?, 1, datetime('now'))
          ON CONFLICT (product_id, market) DO UPDATE SET
            price_amount = excluded.price_amount,
            display_price = excluded.display_price,
            is_active = 1,
            updated_at = datetime('now');
        `).bind(intlPriceId, item.id, exportVal, exportDisplay)
      );
    } else {
      // Unconfigured export price: ensure no 0.00 row exists
      statements.push(
        db.prepare(`DELETE FROM product_prices WHERE product_id = ? AND market = 'intl'`).bind(item.id)
      );
    }
  }

  // 4. Audit log entry
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  statements.push(
    db.prepare(`
      INSERT INTO admin_audit_logs (id, actor, action, target_type, target_id, details)
      VALUES (?, ?, 'BULK_UPDATE_PRODUCTS', 'catalog', 'all', ?)
    `).bind(auditId, actor, JSON.stringify({ productCount: productsList.length }))
  );

  // Atomic batch execution: all succeed or all roll back
  const results = await db.batch(statements);
  return { ok: true, savedToDb: true, statementCount: results.length };
}

/**
 * Creates customer order request with authoritative database price recalculation.
 */
export async function createOrderRequest(db, {
  orderRef,
  customerName = '',
  customerPhone = '',
  market = 'lk',
  currency = 'LKR',
  destinationCountry = '',
  deliveryCity = '',
  customerNotes = '',
  items = [],
  source = 'web',
  status = 'draft',
} = {}) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Order could not be created.');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Order creation rejected: Order must contain at least one item.');
  }

  // Validate market & currency consistency
  if (market === 'lk' && currency !== 'LKR') {
    throw new Error(`Market currency mismatch: Market 'lk' requires 'LKR', got '${currency}'.`);
  }
  if (market === 'intl' && currency !== 'USD') {
    throw new Error(`Market currency mismatch: Market 'intl' requires 'USD', got '${currency}'.`);
  }

  const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let recalculatedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    const qty = parseInt(item.quantity, 10);
    if (isNaN(qty) || qty <= 0 || qty > 1000) {
      throw new Error(`Invalid item quantity ${item.quantity} for product ${item.productId}. Must be between 1 and 1000.`);
    }

    // Look up authoritative price from D1 product_prices
    const priceRow = await db.prepare(`
      SELECT p.name, pr.price_amount, pr.display_price
      FROM products p
      JOIN product_prices pr ON p.id = pr.product_id
      WHERE p.id = ? AND pr.market = ? AND pr.is_active = 1 AND p.is_active = 1
    `).bind(item.productId, market).first();

    if (!priceRow) {
      throw new Error(`Product ${item.productId} is not available in market '${market}'.`);
    }

    const unitPrice = Number(priceRow.price_amount);
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    recalculatedSubtotal += lineTotal;

    verifiedItems.push({
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      productId: item.productId,
      productName: priceRow.name,
      quantity: qty,
      unitPrice,
      lineTotal,
    });
  }

  recalculatedSubtotal = Math.round(recalculatedSubtotal * 100) / 100;

  // Batch insert order and order_items
  const statements = [
    db.prepare(`
      INSERT INTO orders (id, order_ref, customer_name, customer_phone, market, currency, destination_country, delivery_city, customer_notes, subtotal, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderId,
      orderRef,
      customerName,
      customerPhone,
      market,
      currency,
      destinationCountry || (market === 'lk' ? 'Sri Lanka' : 'Export'),
      deliveryCity,
      customerNotes,
      recalculatedSubtotal,
      status || 'draft',
      source
    )
  ];

  for (const vi of verifiedItems) {
    statements.push(
      db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(vi.id, orderId, vi.productId, vi.productName, vi.quantity, vi.unitPrice, vi.lineTotal)
    );
  }

  await db.batch(statements);

  return {
    orderId,
    orderRef,
    status: status || 'draft',
    market,
    currency,
    subtotal: recalculatedSubtotal,
    items: verifiedItems,
    persisted: true,
  };
}


/**
 * Retrieves an order and its associated line items by unique order_ref.
 */
export async function getOrderByRef(db, orderRef) {
  if (!db || !orderRef) return null;
  const order = await db.prepare(
    'SELECT * FROM orders WHERE order_ref = ?'
  ).bind(orderRef).first();

  if (!order) return null;

  const { results: items } = await db.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(order.id).all();

  return {
    ...order,
    items: items || [],
  };
}

/**
 * Transitions an existing web checkout draft to confirmed status upon receipt of the WhatsApp message.
 * Preserves the exact same order reference and prevents duplicate order creation.
 */
export async function confirmDraftOrder(db, orderRef, { customerPhone = null } = {}) {
  if (!db || !orderRef) {
    throw new Error('D1 database binding and orderRef are required to confirm draft order.');
  }

  const existing = await getOrderByRef(db, orderRef);
  if (!existing) {
    return null;
  }

  // Idempotency: If already confirmed, processing, or completed, do not re-update
  if (existing.status === 'confirmed' || existing.status === 'processing' || existing.status === 'completed') {
    return {
      order: existing,
      alreadyConfirmed: true,
    };
  }

  const updatedPhone = customerPhone || existing.customer_phone;

  await db.prepare(`
    UPDATE orders
    SET status = 'confirmed',
        customer_phone = COALESCE(?, customer_phone),
        updated_at = datetime('now')
    WHERE order_ref = ?
  `).bind(updatedPhone, orderRef).run();

  const updated = await getOrderByRef(db, orderRef);
  return {
    order: updated,
    alreadyConfirmed: false,
  };
}

/**
 * Transitions stale draft checkouts to abandoned status.
 */
export async function markAbandonedDrafts(db, olderThanMinutes = 60) {
  if (!db) return 0;
  const result = await db.prepare(`
    UPDATE orders
    SET status = 'abandoned',
        updated_at = datetime('now')
    WHERE status = 'draft'
      AND datetime(created_at) <= datetime('now', '-' || ? || ' minutes')
  `).bind(olderThanMinutes).run();

  return result?.meta?.changes || 0;
}

/**
 * Durably persists incoming WhatsApp webhook message to D1 inbox.
 * Uses INSERT ... ON CONFLICT DO NOTHING for deduplication.
 */
export async function persistInboxEvent(db, { messageId, senderPhone, rawPayload, messageText }) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot persist webhook event.');
  }

  const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload || {});

  await db.prepare(`
    INSERT INTO whatsapp_inbox (message_id, sender_phone, raw_payload, message_text, status, attempts, created_at)
    VALUES (?, ?, ?, ?, 'received', 0, datetime('now'))
    ON CONFLICT (message_id) DO NOTHING;
  `).bind(messageId, senderPhone, payloadStr, messageText || '').run();

  return { persisted: true, messageId };
}

/**
 * Atomically claims inbox message lock using conditional update.
 */
export async function claimInboxLock(db, messageId, { bypassBackoff = false, leaseTimeoutMs = 120000 } = {}) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot claim inbox lock.');
  }

  const now = Date.now();
  const leaseThreshold = now - leaseTimeoutMs;

  // Retrieve current state
  const entry = await db.prepare(`
    SELECT status, attempts, max_attempts, locked_at FROM whatsapp_inbox WHERE message_id = ?
  `).bind(messageId).first();

  if (!entry) {
    return { claimed: false, reason: 'not_found' };
  }

  if (entry.status === 'completed' || entry.status === 'dead_letter') {
    return { claimed: false, reason: entry.status, attempts: entry.attempts };
  }

  // Active unexpired processing lock
  if (entry.status === 'processing' && entry.locked_at && entry.locked_at > leaseThreshold) {
    return { claimed: false, reason: 'concurrent_lock_active', attempts: entry.attempts };
  }

  // Exponential backoff check for failed status
  if (entry.status === 'failed' && !bypassBackoff && entry.locked_at) {
    const backoffMs = Math.pow(2, Math.min(entry.attempts - 1, 6)) * 10000;
    if (now - entry.locked_at < backoffMs) {
      return { claimed: false, reason: 'backoff_active', attempts: entry.attempts };
    }
  }

  // Attempt atomic conditional claim
  const nextAttempts = (entry.attempts || 0) + 1;
  const updateResult = await db.prepare(`
    UPDATE whatsapp_inbox
    SET status = 'processing', attempts = ?, locked_at = ?
    WHERE message_id = ?
      AND (
        status = 'received'
        OR (status = 'failed' AND attempts < max_attempts)
        OR (status = 'processing' AND (locked_at IS NULL OR locked_at <= ?))
      );
  `).bind(nextAttempts, now, messageId, leaseThreshold).run();

  const claimed = updateResult?.meta?.changes > 0 || updateResult?.changes > 0;
  return {
    claimed: !!claimed,
    reason: claimed ? 'lock_acquired' : 'conflict_lost',
    attempts: nextAttempts,
  };
}

/**
 * Marks inbox message completed upon successful execution.
 */
export async function completeInboxMessage(db, messageId) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot complete inbox message.');
  }

  await db.prepare(`
    UPDATE whatsapp_inbox
    SET status = 'completed', completed_at = datetime('now')
    WHERE message_id = ?;
  `).bind(messageId).run();
}

/**
 * Records inbox message failure and transitions to dead_letter if max attempts reached.
 */
export async function recordInboxFailure(db, messageId, errorMessage) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot record inbox failure.');
  }

  const entry = await db.prepare(`
    SELECT attempts, max_attempts FROM whatsapp_inbox WHERE message_id = ?
  `).bind(messageId).first();

  const isDeadLetter = entry && entry.attempts >= (entry.max_attempts || 5);
  const newStatus = isDeadLetter ? 'dead_letter' : 'failed';

  await db.prepare(`
    UPDATE whatsapp_inbox
    SET status = ?, last_error = ?, locked_at = ?
    WHERE message_id = ?;
  `).bind(newStatus, errorMessage || 'Unknown failure', Date.now(), messageId).run();

  return { status: newStatus };
}

/**
 * Retrieves pending or retry-eligible inbox messages.
 */
export async function getPendingInboxMessages(db, limit = 10) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot query pending inbox messages.');
  }

  const now = Date.now();
  const leaseThreshold = now - 120000; // 2 minutes

  // Retrieve candidates
  const { results } = await db.prepare(`
    SELECT message_id, sender_phone, message_text, raw_payload, status, attempts, max_attempts, locked_at
    FROM whatsapp_inbox
    WHERE status = 'received'
       OR (status = 'failed' AND attempts < max_attempts)
       OR (status = 'processing' AND (locked_at IS NULL OR locked_at <= ?))
    ORDER BY created_at ASC
    LIMIT ?;
  `).bind(leaseThreshold, limit).all();

  if (!results) return [];

  // Filter failed items by exponential backoff
  return results.filter((row) => {
    if (row.status === 'received') return true;
    if (row.status === 'processing') return true;
    if (row.status === 'failed') {
      const backoffMs = Math.pow(2, Math.min((row.attempts || 1) - 1, 6)) * 10000;
      return (now - (row.locked_at || 0)) >= backoffMs;
    }
    return false;
  });
}

/**
 * Retrieves conversation state machine session.
 */
export async function getConversation(db, phone) {
  if (!db) return null;

  const row = await db.prepare(`
    SELECT state, session_data FROM whatsapp_conversations WHERE phone_number = ?
  `).bind(phone).first();

  if (!row) return null;

  try {
    return {
      state: row.state,
      data: JSON.parse(row.session_data || '{}'),
    };
  } catch (e) {
    return { state: row.state, data: {} };
  }
}

/**
 * Saves conversation state machine session.
 */
export async function saveConversation(db, phone, state, sessionData) {
  if (!db) {
    throw new Error('D1 database binding DB is not available: Cannot save conversation state.');
  }

  const dataStr = JSON.stringify(sessionData || {});

  await db.prepare(`
    INSERT INTO whatsapp_conversations (phone_number, state, session_data, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (phone_number) DO UPDATE SET
      state = excluded.state,
      session_data = excluded.session_data,
      updated_at = datetime('now');
  `).bind(phone, state, dataStr).run();
}

/**
 * Records outbound message in whatsapp_outbox table.
 */
export async function recordOutboundMessage(db, { inboxMessageId, recipientPhone, messageBody }) {
  if (!db) return null;
  const outboxId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.prepare(`
      INSERT INTO whatsapp_outbox (id, inbox_message_id, recipient_phone, message_type, message_body, status, created_at)
      VALUES (?, ?, ?, 'text', ?, 'sent', datetime('now'))
    `).bind(outboxId, inboxMessageId || null, recipientPhone, messageBody).run();
    return outboxId;
  } catch (e) {
    console.warn('[Outbox Warning] Could not record outbound message:', e.message);
    return null;
  }
}
