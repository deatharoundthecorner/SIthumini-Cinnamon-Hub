import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {
  hashPassword,
  verifyPassword,
  verifyAdminCredentials,
  createSessionToken,
  verifySessionToken,
  buildSessionCookie,
} from '../worker/auth.js';
import {
  getProducts,
  saveProducts,
  createOrderRequest,
  getOrderByRef,
  confirmDraftOrder,
  markAbandonedDrafts,
  persistInboxEvent,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
} from '../worker/db.js';
import {
  verifyMetaSignature,
  sendWhatsAppMessage,
  handleIncomingMessage,
  getMetaGraphVersion,
  DEFAULT_META_GRAPH_VERSION,
} from '../worker/whatsapp.js';
import { processD1InboxQueue } from '../worker/inboxWorker.js';
import { compareCatalogue } from '../scripts/compare_catalogue.js';

/**
 * In-Memory SQLite / D1 Mock Engine
 * Emulates Cloudflare D1 prepared statements, batch execution, and constraint checks
 */
function createMockD1() {
  const tables = {
    products: new Map(),
    product_prices: new Map(),
    orders: new Map(),
    order_items: new Map(),
    whatsapp_inbox: new Map(),
    whatsapp_conversations: new Map(),
    whatsapp_outbox: new Map(),
    admin_audit_logs: new Map(),
  };

  // Seed sample products
  tables.products.set('9', {
    id: '9',
    name: 'Cinnamon Sticks (100g)',
    description: 'Premium whole cinnamon sticks',
    category: 'Spices',
    image_url: '/images/42.png',
    stock: 50,
    sort_order: 1,
    cost_price: 600,
    is_active: 1,
  });
  tables.product_prices.set('price_lk_9', {
    id: 'price_lk_9',
    product_id: '9',
    market: 'lk',
    currency: 'LKR',
    price_amount: 1000,
    display_price: 'Rs. 1,000',
    is_active: 1,
  });

  tables.products.set('10', {
    id: '10',
    name: 'Cinnamon Tea Cut (100g)',
    description: 'Finely cut cinnamon pieces',
    category: 'Tea & Infusions',
    image_url: '/images/clear 11.png',
    stock: 40,
    sort_order: 2,
    cost_price: 500,
    is_active: 1,
  });
  tables.product_prices.set('price_lk_10', {
    id: 'price_lk_10',
    product_id: '10',
    market: 'lk',
    currency: 'LKR',
    price_amount: 800,
    display_price: 'Rs. 800',
    is_active: 1,
  });

  return {
    _tables: tables,
    prepare(sql) {
      let boundArgs = [];
      return {
        bind(...args) {
          boundArgs = args;
          return this;
        },
        async first() {
          const res = await this.all();
          return res.results?.[0] || null;
        },
        async all() {
          const cleanSql = sql.replace(/\s+/g, ' ').trim();

          // Authoritative price lookup for order item
          if (cleanSql.includes('SELECT p.name, pr.price_amount, pr.display_price')) {
            const [prodId, market] = boundArgs;
            const prod = tables.products.get(prodId);
            if (!prod || prod.is_active !== 1) return { results: [], error: null };
            for (const pr of tables.product_prices.values()) {
              if (pr.product_id === prodId && pr.market === market && pr.is_active === 1) {
                return { results: [{ name: prod.name, price_amount: pr.price_amount, display_price: pr.display_price }], error: null };
              }
            }
            return { results: [], error: null };
          }

          // SELECT products join prices
          if (cleanSql.includes('FROM products p')) {
            const rows = [];
            for (const p of tables.products.values()) {
              if (p.is_active !== 1) continue;
              let lk = null;
              let intl = null;
              for (const pr of tables.product_prices.values()) {
                if (pr.product_id === p.id && pr.is_active === 1) {
                  if (pr.market === 'lk') lk = pr;
                  if (pr.market === 'intl') intl = pr;
                }
              }
              rows.push({
                ...p,
                lk_price: lk?.price_amount,
                lk_display: lk?.display_price,
                intl_price: intl?.price_amount,
                intl_display: intl?.display_price,
              });
            }
            rows.sort((a, b) => a.sort_order - b.sort_order);
            return { results: rows, error: null };
          }

          // Authoritative price lookup for order item
          if (cleanSql.includes('SELECT p.name, pr.price_amount, pr.display_price')) {
            const [prodId, market] = boundArgs;
            const prod = tables.products.get(prodId);
            if (!prod || prod.is_active !== 1) return { results: [], error: null };
            for (const pr of tables.product_prices.values()) {
              if (pr.product_id === prodId && pr.market === market && pr.is_active === 1) {
                return { results: [{ name: prod.name, price_amount: pr.price_amount, display_price: pr.display_price }], error: null };
              }
            }
            return { results: [], error: null };
          }

          // Inbox pending messages query
          if (cleanSql.includes('FROM whatsapp_inbox')) {
            const now = Date.now();
            const [leaseThreshold] = boundArgs;
            if (cleanSql.includes('WHERE message_id = ?')) {
              const msg = tables.whatsapp_inbox.get(boundArgs[0]);
              return { results: msg ? [msg] : [], error: null };
            }

            const candidates = [];
            for (const msg of tables.whatsapp_inbox.values()) {
              if (msg.status === 'received') candidates.push(msg);
              else if (msg.status === 'failed' && msg.attempts < msg.max_attempts) candidates.push(msg);
              else if (msg.status === 'processing' && (!msg.locked_at || msg.locked_at <= leaseThreshold)) candidates.push(msg);
            }
            return { results: candidates, error: null };
          }

          // Conversation query
          if (cleanSql.includes('FROM whatsapp_conversations WHERE phone_number = ?')) {
            const conv = tables.whatsapp_conversations.get(boundArgs[0]);
            return { results: conv ? [conv] : [], error: null };
          }

          // Order query by order_ref
          if (cleanSql.includes('FROM orders WHERE order_ref = ?')) {
            const orderRef = boundArgs[0];
            const found = [];
            for (const o of tables.orders.values()) {
              if (o.order_ref === orderRef) found.push(o);
            }
            return { results: found, error: null };
          }

          // Order items query
          if (cleanSql.includes('FROM order_items WHERE order_id = ?')) {
            const orderId = boundArgs[0];
            const items = [];
            for (const it of tables.order_items.values()) {
              if (it.order_id === orderId) items.push(it);
            }
            return { results: items, error: null };
          }



          return { results: [], error: null };
        },
        async run() {
          const cleanSql = sql.replace(/\s+/g, ' ').trim();

          // INSERT into whatsapp_inbox
          if (cleanSql.includes('INSERT INTO whatsapp_inbox')) {
            const [message_id, sender_phone, raw_payload, message_text] = boundArgs;
            if (!tables.whatsapp_inbox.has(message_id)) {
              tables.whatsapp_inbox.set(message_id, {
                message_id,
                sender_phone,
                raw_payload,
                message_text,
                status: 'received',
                attempts: 0,
                max_attempts: 5,
                locked_at: null,
                last_error: null,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }

          // UPDATE whatsapp_inbox lock
          if (cleanSql.includes('UPDATE whatsapp_inbox SET status = \'processing\'')) {
            const [attempts, locked_at, message_id] = boundArgs;
            const entry = tables.whatsapp_inbox.get(message_id);
            if (entry) {
              entry.status = 'processing';
              entry.attempts = attempts;
              entry.locked_at = locked_at;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

          // UPDATE whatsapp_inbox complete
          if (cleanSql.includes('UPDATE whatsapp_inbox SET status = \'completed\'')) {
            const [message_id] = boundArgs;
            const entry = tables.whatsapp_inbox.get(message_id);
            if (entry) {
              entry.status = 'completed';
              return { success: true, meta: { changes: 1 } };
            }
          }

          // UPDATE whatsapp_inbox failure
          if (cleanSql.includes('UPDATE whatsapp_inbox SET status = ?')) {
            const [status, last_error, locked_at, message_id] = boundArgs;
            const entry = tables.whatsapp_inbox.get(message_id);
            if (entry) {
              entry.status = status;
              entry.last_error = last_error;
              entry.locked_at = locked_at;
              return { success: true, meta: { changes: 1 } };
            }
          }

          // Upsert conversation
          if (cleanSql.includes('INSERT INTO whatsapp_conversations')) {
            const [phone_number, state, session_data] = boundArgs;
            tables.whatsapp_conversations.set(phone_number, {
              phone_number,
              state,
              session_data,
            });
            return { success: true, meta: { changes: 1 } };
          }

          // Insert order
          if (cleanSql.includes('INSERT INTO orders')) {
            const [id, order_ref, customer_name, customer_phone, market, currency, destination_country, delivery_city, customer_notes, subtotal, status, source] = boundArgs;
            tables.orders.set(id, {
              id,
              order_ref,
              customer_name,
              customer_phone,
              market,
              currency,
              destination_country,
              delivery_city,
              customer_notes,
              subtotal,
              status: status || 'draft',
              source,
              created_at: new Date().toISOString(),
            });
            return { success: true, meta: { changes: 1 } };
          }

          // Confirm draft order
          if (cleanSql.includes("UPDATE orders SET status = 'confirmed'")) {
            const [customer_phone, order_ref] = boundArgs;
            for (const o of tables.orders.values()) {
              if (o.order_ref === order_ref) {
                o.status = 'confirmed';
                if (customer_phone) o.customer_phone = customer_phone;
                o.updated_at = new Date().toISOString();
                return { success: true, meta: { changes: 1 } };
              }
            }
            return { success: true, meta: { changes: 0 } };
          }

          // Mark abandoned drafts
          if (cleanSql.includes("UPDATE orders SET status = 'abandoned'")) {
            let changes = 0;
            for (const o of tables.orders.values()) {
              if (o.status === 'draft') {
                o.status = 'abandoned';
                o.updated_at = new Date().toISOString();
                changes++;
              }
            }
            return { success: true, meta: { changes } };
          }

          // Insert order_item
          if (cleanSql.includes('INSERT INTO order_items')) {
            const [id, order_id, product_id, product_name, quantity, unit_price, line_total] = boundArgs;
            tables.order_items.set(id, {
              id,
              order_id,
              product_id,
              product_name,
              quantity,
              unit_price,
              line_total,
            });
            return { success: true, meta: { changes: 1 } };
          }

          // Upsert product
          if (cleanSql.includes('INSERT INTO products')) {
            const [id, name, description, category, image_url, stock, sort_order, cost_price] = boundArgs;
            tables.products.set(id, {
              id,
              name,
              description,
              category,
              image_url,
              stock,
              sort_order,
              cost_price,
              is_active: 1,
            });
            return { success: true, meta: { changes: 1 } };
          }

          // Upsert price
          if (cleanSql.includes('INSERT INTO product_prices')) {
            const [id, product_id, market, currency, price_amount, display_price] = boundArgs;
            tables.product_prices.set(id, {
              id,
              product_id,
              market,
              currency,
              price_amount,
              display_price,
              is_active: 1,
            });
            return { success: true, meta: { changes: 1 } };
          }

          // Delete price
          if (cleanSql.includes('DELETE FROM product_prices')) {
            const [product_id] = boundArgs;
            for (const [key, pr] of tables.product_prices.entries()) {
              if (pr.product_id === product_id && pr.market === 'intl') {
                tables.product_prices.delete(key);
              }
            }
            return { success: true, meta: { changes: 1 } };
          }

          // Audit log
          if (cleanSql.includes('INSERT INTO admin_audit_logs')) {
            const [id, actor, action, target_type, target_id, details] = boundArgs;
            tables.admin_audit_logs.set(id, { id, actor, action, target_type, target_id, details });
            return { success: true, meta: { changes: 1 } };
          }

          // Outbox
          if (cleanSql.includes('INSERT INTO whatsapp_outbox')) {
            const [id, inbox_message_id, recipient_phone, message_type, message_body] = boundArgs;
            tables.whatsapp_outbox.set(id, { id, inbox_message_id, recipient_phone, message_type, message_body, status: 'sent' });
            return { success: true, meta: { changes: 1 } };
          }

          return { success: true, meta: { changes: 0 } };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
  };
}

// -----------------------------------------------------------------------------
// TEST SUITES
// -----------------------------------------------------------------------------

describe('Cloudflare Worker: Static Assets & Web Routing', () => {
  test('GET /api/health returns Cloudflare Workers runtime status', async () => {
    const env = { DB: createMockD1(), NODE_ENV: 'development', ASSETS: { fetch: async () => new Response('Asset') } };
    const req = new Request('https://sithumini.workers.dev/api/health');
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.runtime, 'cloudflare_workers');
    assert.equal(body.d1_configured, true);
  });

  test('Non-API route serves static assets via env.ASSETS', async () => {
    const env = {
      ASSETS: {
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === '/assets/index.js') {
            return new Response('console.log("react");', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
          }
          return new Response('Not Found', { status: 404 });
        },
      },
    };

    const req = new Request('https://sithumini.workers.dev/assets/index.js');
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'console.log("react");');
  });

  test('Non-API HTML navigation falls back to /index.html for SPA client routing', async () => {
    const env = {
      ASSETS: {
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === '/index.html') {
            return new Response('<!DOCTYPE html><html><div id="root"></div></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
          }
          return new Response('Not Found', { status: 404 });
        },
      },
    };

    const req = new Request('https://sithumini.workers.dev/products/9', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<div id="root"></div>'));
  });
});

describe('Cloudflare Worker: D1 Catalog & Data Isolation', () => {
  test('getProducts omits private cost_price from public responses', async () => {
    const db = createMockD1();
    const products = await getProducts(db, { includeCost: false });
    assert.equal(products.length, 2);
    assert.equal(products[0].id, '9');
    assert.equal(products[0].costPrice, undefined);
    assert.equal(products[0].price, 'Rs. 1,000');
    assert.equal(products[0].priceValue, 1000);
  });

  test('getProducts includes cost_price only for administrative requests', async () => {
    const db = createMockD1();
    const products = await getProducts(db, { includeCost: true });
    assert.equal(products[0].costPrice, 600);
  });

  test('saveProducts rejects non-positive or missing local prices', async () => {
    const db = createMockD1();
    await assert.rejects(async () => {
      await saveProducts(db, [{ id: '9', name: 'Product', price: '0', priceValue: 0 }]);
    }, /Local LKR price must be a strictly positive amount/);
  });

  test('saveProducts unconfigured export price deletes USD row instead of storing 0.00', async () => {
    const db = createMockD1();
    await saveProducts(db, [
      { id: '9', name: 'Cinnamon Sticks (100g)', price: 'Rs. 1,000', priceValue: 1000, exportPrice: '', exportPriceValue: null },
    ]);
    const pr = await db.prepare('SELECT * FROM product_prices WHERE product_id = ? AND market = ?').bind('9', 'intl').first();
    assert.equal(pr, null);
  });
});

describe('Cloudflare Worker: Admin Authentication & Web Crypto Tokens', () => {
  const secret = 'test_random_session_secret_1234567890';
  const env = {
    ADMIN_USERNAME: 'sithumini_admin',
    ADMIN_PASSWORD_HASH: null,
    ADMIN_PASSWORD: 'test_password_123',
    SESSION_SECRET: secret,
    NODE_ENV: 'test',
  };

  test('createSessionToken generates valid signature verified by verifySessionToken', async () => {
    const token = await createSessionToken('sithumini_admin', secret);
    const user = await verifySessionToken(token, secret);
    assert.equal(user, 'sithumini_admin');
  });

  test('verifySessionToken rejects tampered or forged signature', async () => {
    const token = await createSessionToken('sithumini_admin', secret);
    const tampered = token.slice(0, -4) + 'abcd';
    const user = await verifySessionToken(tampered, secret);
    assert.equal(user, null);
  });

  test('verifyAdminCredentials validates password hash timing-safely', async () => {
    const pwHash = await hashPassword('secure_password_987');
    const hashEnv = {
      ADMIN_USERNAME: 'admin_mgr',
      ADMIN_PASSWORD_HASH: pwHash,
      NODE_ENV: 'production',
    };
    const valid = await verifyAdminCredentials('admin_mgr', 'secure_password_987', hashEnv);
    assert.equal(valid, true);

    const invalid = await verifyAdminCredentials('admin_mgr', 'wrong_pass', hashEnv);
    assert.equal(invalid, false);
  });
});

describe('Cloudflare Worker: Authoritative Order Requests & Subtotals', () => {
  test('createOrderRequest strictly recalculates subtotal from D1 prices', async () => {
    const db = createMockD1();
    const result = await createOrderRequest(db, {
      orderRef: 'SCH-TEST-100',
      market: 'lk',
      currency: 'LKR',
      items: [
        { productId: '9', quantity: 2 }, // 2 x 1000 = 2000
        { productId: '10', quantity: 1 }, // 1 x 800 = 800
      ],
    });

    assert.equal(result.subtotal, 2800);
    assert.equal(result.items.length, 2);
  });

  test('createOrderRequest rejects market and currency mismatch', async () => {
    const db = createMockD1();
    await assert.rejects(async () => {
      await createOrderRequest(db, {
        orderRef: 'SCH-TEST-200',
        market: 'lk',
        currency: 'USD',
        items: [{ productId: '9', quantity: 1 }],
      });
    }, /Market currency mismatch/);
  });

  test('createOrderRequest rejects invalid quantities', async () => {
    const db = createMockD1();
    await assert.rejects(async () => {
      await createOrderRequest(db, {
        orderRef: 'SCH-TEST-300',
        market: 'lk',
        currency: 'LKR',
        items: [{ productId: '9', quantity: 0 }],
      });
    }, /Invalid item quantity/);
  });
});

describe('Cloudflare Worker: Meta WhatsApp Webhook & Verification', () => {
  const appSecret = 'meta_app_secret_12345';
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }), 'utf8');

  test('verifyMetaSignature verifies Web Crypto HMAC-SHA256 signature', async () => {
    // Generate valid signature using SubtleCrypto
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, rawBody);
    const hexSig = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const req = new Request('https://worker.dev/api/whatsapp/webhook', {
      headers: { 'X-Hub-Signature-256': `sha256=${hexSig}` },
    });

    const check = await verifyMetaSignature(req, rawBody, appSecret, true);
    assert.equal(check.valid, true);
  });

  test('verifyMetaSignature rejects tampered signature', async () => {
    const req = new Request('https://worker.dev/api/whatsapp/webhook', {
      headers: { 'X-Hub-Signature-256': 'sha256=tampered00000000000000000000000000000000000000000000000000000000' },
    });
    const check = await verifyMetaSignature(req, rawBody, appSecret, true);
    assert.equal(check.valid, false);
    assert.equal(check.status, 403);
  });

  test('Webhook post returns HTTP 503 if D1 database persistence fails', async () => {
    const env = {
      DB: null, // DB unavailable
      WHATSAPP_APP_SECRET: appSecret,
      NODE_ENV: 'production',
    };

    // Valid signature on message body
    const msgPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{ id: 'wamid.test_fail', from: '94771234567', type: 'text', text: { body: 'hello' } }],
          },
        }],
      }],
    });
    const buf = Buffer.from(msgPayload, 'utf8');

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, buf);
    const hex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const req = new Request('https://worker.dev/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': `sha256=${hex}`, 'Content-Type': 'application/json' },
      body: buf,
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 503);
  });
});

describe('Cloudflare Worker: Durable Inbox Queue & Retry Worker', () => {
  test('claimInboxLock atomically leases message and increments attempts', async () => {
    const db = createMockD1();
    await persistInboxEvent(db, {
      messageId: 'wamid.cf_queue_01',
      senderPhone: '94771122334',
      messageText: 'Test queue message',
      rawPayload: {},
    });

    const lock1 = await claimInboxLock(db, 'wamid.cf_queue_01');
    assert.equal(lock1.claimed, true);
    assert.equal(lock1.attempts, 1);

    // Concurrent claim while active lock is running should be rejected
    const lock2 = await claimInboxLock(db, 'wamid.cf_queue_01');
    assert.equal(lock2.claimed, false);
    assert.equal(lock2.reason, 'concurrent_lock_active');
  });

  test('recordInboxFailure transitions to dead_letter after reaching max attempts', async () => {
    const db = createMockD1();
    await persistInboxEvent(db, {
      messageId: 'wamid.cf_dlq_01',
      senderPhone: '94779988776',
      messageText: 'fail me',
      rawPayload: {},
    });

    // 5 attempts with expired lease
    for (let i = 0; i < 5; i++) {
      await claimInboxLock(db, 'wamid.cf_dlq_01', { bypassBackoff: true, leaseTimeoutMs: -1 });
    }

    const failRes = await recordInboxFailure(db, 'wamid.cf_dlq_01', 'Fatal failure');
    assert.equal(failRes.status, 'dead_letter');
  });

  test('processD1InboxQueue processes received events via Worker scheduled runner', async () => {
    const db = createMockD1();
    await persistInboxEvent(db, {
      messageId: 'wamid.cf_batch_01',
      senderPhone: '94775556667',
      messageText: '1',
      rawPayload: {},
    });

    const env = {
      DB: db,
      NODE_ENV: 'test',
      WHATSAPP_SIMULATION_MODE: 'true',
    };

    const summary = await processD1InboxQueue(env, { batchSize: 5 });
    assert.equal(summary.processed, 1);
    assert.equal(summary.succeeded, 1);

    const msg = db._tables.whatsapp_inbox.get('wamid.cf_batch_01');
    assert.equal(msg.status, 'completed');
  });
});

describe('Cloudflare Worker: Catalogue Fidelity & Preservation', () => {
  test('compareCatalogue confirms 100% fidelity with public/products.json and no export USD prices', () => {
    const report = compareCatalogue();
    assert.equal(report.sourceCount, 10);
    assert.equal(report.seedProductMatches, 10);
    assert.equal(report.seedPriceMatches, 10);
    assert.equal(report.discrepancies.length, 0);
  });
});

describe('Cloudflare Worker: Frontend API Route Contracts & Aliases', () => {
  const secret = 'test_session_secret_1234567890123456';

  test('POST /api/login authenticates admin and issues HTTP-only session cookie', async () => {
    const pwHash = await hashPassword('correct_admin_pass');
    const env = {
      ADMIN_USERNAME: 'sithumini_owner',
      ADMIN_PASSWORD_HASH: pwHash,
      SESSION_SECRET: secret,
      NODE_ENV: 'production',
      DB: createMockD1(),
    };

    const req = new Request('https://sithumini.workers.dev/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sithumini_owner', password: 'correct_admin_pass' }),
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.username, 'sithumini_owner');

    const setCookie = res.headers.get('Set-Cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes('sithumini_admin_session='));
    assert.ok(setCookie.includes('HttpOnly'));
  });

  test('GET /api/me validates session cookie and returns authenticated state', async () => {
    const token = await createSessionToken('sithumini_owner', secret);
    const env = {
      SESSION_SECRET: secret,
      NODE_ENV: 'production',
      DB: createMockD1(),
    };

    const req = new Request('https://sithumini.workers.dev/api/me', {
      headers: { Cookie: `sithumini_admin_session=${token}` },
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.username, 'sithumini_owner');
  });

  test('POST /api/logout clears session cookie', async () => {
    const env = {
      SESSION_SECRET: secret,
      NODE_ENV: 'production',
      DB: createMockD1(),
    };

    const req = new Request('https://sithumini.workers.dev/api/logout', {
      method: 'POST',
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const setCookie = res.headers.get('Set-Cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes('Max-Age=0'));
  });

  test('POST /api/orders persists customer order request and recalculates subtotal authoritatively', async () => {
    const db = createMockD1();
    const env = {
      DB: db,
      NODE_ENV: 'production',
    };

    const req = new Request('https://sithumini.workers.dev/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Kamal Perera',
        customerPhone: '0771234567',
        market: 'lk',
        currency: 'LKR',
        deliveryCity: 'Colombo',
        items: [
          { productId: '9', quantity: 2 },
          { productId: '10', quantity: 1 },
        ],
      }),
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.order.market, 'lk');
    assert.equal(body.order.currency, 'LKR');
    // Product 9 (1000 * 2) + Product 10 (800 * 1) = 2800
    assert.equal(body.order.subtotal, 2800);
    assert.ok(body.order.orderRef.startsWith('SCH-'));
    assert.equal(db._tables.orders.size, 1);
  });
});

describe('Cloudflare Worker: PBKDF2 Password Hashing Security Review', () => {
  test('hashPassword produces versioned pbkdf2_sha256 format with 100,000 iterations', async () => {
    const hash = await hashPassword('AdminPass2026!');
    assert.ok(hash.startsWith('pbkdf2_sha256$100000$'));
    const parts = hash.split('$');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'pbkdf2_sha256');
    assert.equal(parts[1], '100000');
    assert.equal(parts[2].length, 32); // 16 bytes hex salt
    assert.equal(parts[3].length, 64); // 32 bytes hex derived key
  });

  test('verifyPassword returns true for matching password and false for wrong password', async () => {
    const hash = await hashPassword('CorrectPassword123');
    assert.equal(await verifyPassword('CorrectPassword123', hash), true);
    assert.equal(await verifyPassword('WrongPassword', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  test('verifyPassword rejects tampered salt and tampered hash string', async () => {
    const hash = await hashPassword('CorrectPassword123');
    const parts = hash.split('$');

    // Tampered salt
    const tamperedSalt = `${parts[0]}$${parts[1]}$${parts[2].slice(0, -2)}ff$${parts[3]}`;
    assert.equal(await verifyPassword('CorrectPassword123', tamperedSalt), false);

    // Tampered hash
    const tamperedHash = `${parts[0]}$${parts[1]}$${parts[2]}$${parts[3].slice(0, -2)}00`;
    assert.equal(await verifyPassword('CorrectPassword123', tamperedHash), false);
  });

  test('verifyPassword safely rejects legacy plain SHA-256 or malformed strings without throwing', async () => {
    assert.equal(await verifyPassword('pwd', 'plain_sha256_hash_value'), false);
    assert.equal(await verifyPassword('pwd', 'sha256$something'), false);
    assert.equal(await verifyPassword('pwd', null), false);
    assert.equal(await verifyPassword('pwd', ''), false);
    assert.equal(await verifyPassword('pwd', 'pbkdf2_sha256$999$salt$hash'), false); // iterations too low
  });

  test('verifyAdminCredentials fails closed in production when ADMIN_PASSWORD_HASH is missing', async () => {
    const prodEnv = {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'plain_password', // Plaintext fallback not allowed in prod
      NODE_ENV: 'production',
    };
    const allowed = await verifyAdminCredentials('admin', 'plain_password', prodEnv);
    assert.equal(allowed, false);
  });
});

describe('Cloudflare Worker: Inventory Nullability & Unknown Stock Representation', () => {
  test('getProducts returns stock: null when stock is NULL in database (unknown availability)', async () => {
    const db = createMockD1();
    db._tables.products.set('9', {
      id: '9',
      name: 'Cinnamon Sticks (100g)',
      stock: null, // Unknown stock
      is_active: 1,
    });

    const products = await getProducts(db, { includeCost: false });
    const p9 = products.find(p => p.id === '9');
    assert.ok(p9);
    assert.equal(p9.stock, null);
  });

  test('saveProducts preserves stock: null without inventing stock quantity 50', async () => {
    const db = createMockD1();
    const adminUser = 'test_admin';

    const updates = [
      {
        id: '9',
        name: 'Cinnamon Sticks (100g)',
        price: 'Rs. 1,000',
        stock: null, // Unknown stock
      },
    ];

    await saveProducts(db, updates, adminUser);
    const saved = db._tables.products.get('9');
    assert.equal(saved.stock, null);
  });
});

describe('Cloudflare Worker: WhatsApp Meta Graph API v26.0 Configuration', () => {
  test('getMetaGraphVersion defaults to v26.0 when unspecified', () => {
    assert.equal(DEFAULT_META_GRAPH_VERSION, 'v26.0');
    assert.equal(getMetaGraphVersion({}), 'v26.0');
  });

  test('getMetaGraphVersion respects valid custom version from environment', () => {
    assert.equal(getMetaGraphVersion({ META_GRAPH_API_VERSION: 'v27.0' }), 'v27.0');
    assert.equal(getMetaGraphVersion({ META_GRAPH_API_VERSION: 'invalid_format' }), 'v26.0');
  });
});

describe('Cloudflare Worker: Website-to-WhatsApp Order Flow Lifecycle', () => {
  const secret = 'test_secret_for_lifecycle_testing_123';

  test('1. Successful checkout: Draft order created on web, then confirmed by WhatsApp bot with matching orderRef', async () => {
    const db = createMockD1();
    const env = {
      DB: db,
      NODE_ENV: 'test',
      WHATSAPP_SIMULATION_MODE: 'true',
    };

    // Step A: Customer initiates checkout on website (POST /api/orders)
    const orderRef = 'SCH-2026-TEST01';
    const draftRes = await createOrderRequest(db, {
      orderRef,
      customerName: 'Anura Bandara',
      customerPhone: '0712345678',
      market: 'lk',
      currency: 'LKR',
      deliveryCity: 'Kandy',
      items: [{ productId: '9', quantity: 2 }],
      source: 'web',
      status: 'draft',
    });

    assert.equal(draftRes.orderRef, orderRef);
    assert.equal(draftRes.status, 'draft');
    assert.equal(db._tables.orders.size, 1);
    const draftOrder = db._tables.orders.get(draftRes.orderId);
    assert.equal(draftOrder.status, 'draft');

    // Step B: Customer sends the pre-filled checkout message in WhatsApp
    const incomingText = `🌿 SITHUMINI CINNAMON HUB — ORDER REQUEST\nReference: ${orderRef}\nMarket: Sri Lanka (LKR)\n👤 Customer: Anura Bandara\n📦 Requested: Cinnamon Sticks (Qty: 2)`;

    await handleIncomingMessage('94712345678', incomingText, env);

    // Step C: Verify order was confirmed without creating a second order!
    assert.equal(db._tables.orders.size, 1, 'Must NOT create a second order record');
    const confirmedOrder = db._tables.orders.get(draftRes.orderId);
    assert.equal(confirmedOrder.status, 'confirmed');
    assert.equal(confirmedOrder.customer_phone, '94712345678');
  });

  test('2. Abandoned checkout: Unsent checkout remains in draft state, transitioned to abandoned by maintenance', async () => {
    const db = createMockD1();

    // Customer opens checkout but abandons the window without sending WhatsApp message
    const draft = await createOrderRequest(db, {
      orderRef: 'SCH-ABANDONED-01',
      customerName: 'Browsing Customer',
      market: 'lk',
      currency: 'LKR',
      items: [{ productId: '10', quantity: 1 }],
      source: 'web',
      status: 'draft',
    });

    assert.equal(draft.status, 'draft');
    const order = db._tables.orders.get(draft.orderId);
    assert.equal(order.status, 'draft', 'Abandoned checkout must remain clearly marked as draft');

    // Stale draft transition
    const count = await markAbandonedDrafts(db, 30);
    assert.equal(count, 1);
    assert.equal(order.status, 'abandoned', 'Draft transitions to abandoned state');
  });

  test('3. Failed D1 persistence: Throws truthful error and fails safely without false success', async () => {
    // Attempting order creation with missing DB throws truthful error
    await assert.rejects(
      async () => {
        await createOrderRequest(null, {
          orderRef: 'SCH-FAILED-01',
          market: 'lk',
          items: [{ productId: '9', quantity: 1 }],
        });
      },
      /D1 database binding DB is not available/
    );
  });

  test('4. Duplicate WhatsApp delivery: Re-sent checkout message does not duplicate order or items', async () => {
    const db = createMockD1();
    const env = {
      DB: db,
      NODE_ENV: 'test',
      WHATSAPP_SIMULATION_MODE: 'true',
    };

    const orderRef = 'SCH-DUP-01';
    await createOrderRequest(db, {
      orderRef,
      customerName: 'Kasun Silva',
      market: 'lk',
      items: [{ productId: '9', quantity: 1 }],
      source: 'web',
      status: 'draft',
    });

    const msgText = `🌿 SITHUMINI CINNAMON HUB — ORDER REQUEST\nReference: ${orderRef}`;

    // First delivery confirms order
    await handleIncomingMessage('94770001122', msgText, env);
    assert.equal(db._tables.orders.size, 1);
    assert.equal(db._tables.order_items.size, 1);

    // Duplicate delivery (Meta retry or re-sent message)
    await handleIncomingMessage('94770001122', msgText, env);
    assert.equal(db._tables.orders.size, 1, 'Duplicate delivery must NOT create a second order');
    assert.equal(db._tables.order_items.size, 1, 'Duplicate delivery must NOT duplicate order line items');
  });

  test('5. Meta Graph API version consistency: Outgoing requests use configured v26.0 endpoint', async () => {
    let capturedUrl = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      capturedUrl = typeof url === 'string' ? url : url.url;
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
    };

    try {
      const env = {
        WHATSAPP_ACCESS_TOKEN: 'fake_token',
        WHATSAPP_PHONE_NUMBER_ID: '987654321',
        NODE_ENV: 'development',
        META_GRAPH_API_VERSION: 'v26.0',
      };

      await sendWhatsAppMessage('94771234567', 'Test outgoing version message', env);
      assert.ok(capturedUrl, 'Fetch must have been called');
      assert.ok(
        capturedUrl.startsWith('https://graph.facebook.com/v26.0/987654321/messages'),
        `Expected v26.0 in URL, got: ${capturedUrl}`
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
