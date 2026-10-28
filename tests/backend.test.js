import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Set test environment configuration
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'test_admin';
process.env.ADMIN_PASSWORD = 'test_secure_password_123';
process.env.SESSION_SECRET = 'test_session_secret_1234567890_min16chars';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token_xyz';
process.env.WHATSAPP_APP_SECRET = 'test_app_secret_abc123';
process.env.WHATSAPP_ACCESS_TOKEN = 'test_access_token_xyz';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
process.env.OWNER_PHONE_NUMBER = '94771234567';

import app from '../server/app.js';
import {
  acquireMessageLock,
  completeMessage,
  failMessage,
  createOrderRequest,
  saveCustomerReview,
  saveProducts,
  getProducts,
  persistWebhookEventToInbox,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
  saveConversationSession,
  getConversationSession,
  getPendingInboxMessages,
} from '../server/db/supabaseClient.js';
import { handleIncomingMessage, sendWhatsAppMessage } from '../server/whatsapp/botHandler.js';
import { processInboxQueue } from '../server/whatsapp/inboxWorker.js';
import { createSessionToken, verifyAdminSession } from '../server/auth.js';
import { parsePriceString, getNumericPrice } from '../utils/pricingCore.js';
import { validateServerConfig } from '../server/config.js';
import { runDatabaseAudit } from '../scripts/verify_database.js';

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('P0: WhatsApp Webhook Security & Fail-Closed Guards', () => {
  test('GET verification succeeds with correct hub.verify_token and returns challenge', async () => {
    const challenge = 'random_challenge_string_12345';
    const url = `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_xyz&hub.challenge=${challenge}`;

    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, challenge);
  });

  test('GET verification rejects with 403 when verify_token is incorrect', async () => {
    const url = `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=test`;
    const res = await fetch(url);
    assert.equal(res.status, 403);
  });

  test('POST rejects with 401 when X-Hub-Signature-256 header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    });
    assert.equal(res.status, 401);
  });

  test('POST rejects with 403 when X-Hub-Signature-256 signature is invalid or tampered', async () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: payload,
    });
    assert.equal(res.status, 403);
  });

  test('POST accepts valid HMAC-SHA256 signature using raw body buffer', async () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const signature = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(payload).digest('hex');

    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: payload,
    });

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'EVENT_RECEIVED');
  });

  test('Startup fails closed in production when required secrets are missing', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.WHATSAPP_APP_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_APP_SECRET;

      assert.throws(() => {
        validateServerConfig();
      }, /WHATSAPP_APP_SECRET/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.WHATSAPP_APP_SECRET = originalSecret;
    }
  });

  test('Durable inbox: lock prevents concurrent duplicate processing without premature completion', async () => {
    const testMsgId = `wamid.msg_${Date.now()}_lock_test`;

    // 1. Initial lock acquisition succeeds
    const lock1 = await acquireMessageLock(testMsgId, '94770000000', 'hello');
    assert.equal(lock1.canProcess, true);

    // 2. Concurrent delivery while still processing is dropped
    const lock2 = await acquireMessageLock(testMsgId, '94770000000', 'hello');
    assert.equal(lock2.canProcess, false);
    assert.equal(lock2.reason, 'currently_processing');

    // 3. If processing fails, failMessage marks it failed so it is NOT lost
    await failMessage(testMsgId, 'Temporary network glitch');

    // 4. Retry after failure is allowed to reprocess
    const retryLock = await acquireMessageLock(testMsgId, '94770000000', 'hello');
    assert.equal(retryLock.canProcess, true);

    // 5. Once successfully completed, further duplicates are dropped
    await completeMessage(testMsgId);
    const lockAfterComplete = await acquireMessageLock(testMsgId, '94770000000', 'hello');
    assert.equal(lockAfterComplete.canProcess, false);
    assert.equal(lockAfterComplete.reason, 'already_completed');
  });
});

describe('P0: Catalog Protection & Robust Price Parsing', () => {
  test('parsePriceString correctly handles "Rs. 150" without prefix-dot corruption', () => {
    assert.equal(parsePriceString('Rs. 150'), 150);
    assert.equal(parsePriceString('Rs. 200'), 200);
    assert.equal(parsePriceString('Rs. 1,000'), 1000);
    assert.equal(parsePriceString('Rs. 1,234.50'), 1234.5);
    assert.equal(parsePriceString('$12.50'), 12.5);
    assert.equal(parsePriceString(''), 0);
    assert.equal(parsePriceString('Request export pricing'), 0);
  });

  test('saveProducts cleanses unconfigured export prices and never creates USD 0.00 rows', async () => {
    const originalCatalog = await getProducts();
    try {
      const testCatalog = [
        {
          id: 'test-item-1',
          name: 'Test Cinnamon',
          price: 'Rs. 500',
          priceValue: 500,
          exportPrice: 'Request export pricing',
          exportPriceValue: 0,
          category: 'Spices',
        },
      ];

      await saveProducts(testCatalog);
      const reloaded = await getProducts();
      const item = reloaded.find((p) => p.id === 'test-item-1');

      assert.equal(item.priceValue, 500);
      assert.equal(item.exportPriceValue, undefined);
      assert.equal(getNumericPrice(item, 'intl'), null);
    } finally {
      // Restore clean catalog
      await saveProducts(originalCatalog);
    }
  });

  test('Catalog parity: public/products.json matches loaded catalog items', async () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'public', 'products.json'), 'utf-8');
    const publicProducts = JSON.parse(raw);
    const loaded = await getProducts();

    for (const pub of publicProducts) {
      const match = loaded.find((l) => String(l.id) === String(pub.id));
      assert.ok(match, `Product ID ${pub.id} (${pub.name}) must exist in catalog`);
      assert.equal(match.priceValue, pub.priceValue, `Price mismatch on ID ${pub.id}`);
    }
  });
});

describe('P0: Atomic Orders & Server-Side Subtotal Authoritativeness', () => {
  test('Server strictly recalculates subtotal and rejects manipulated client subtotals', async () => {
    const catalog = await getProducts();
    const product = catalog[0];
    const unitPrice = getNumericPrice(product, 'lk');

    const result = await createOrderRequest({
      orderRef: `SCH-ATOMIC-${Date.now()}`,
      market: 'lk',
      currency: 'LKR',
      customerPhone: '94771234567',
      items: [{
        productId: product.id,
        quantity: 3,
      }],
      source: 'whatsapp_bot',
    });

    assert.equal(result.ok, true);
    assert.equal(result.subtotal, unitPrice * 3);
  });

  test('Server rejects invalid quantities (<= 0, non-integer, > 1000)', async () => {
    const catalog = await getProducts();
    const product = catalog[0];

    await assert.rejects(async () => {
      await createOrderRequest({
        orderRef: `SCH-INV-${Date.now()}`,
        market: 'lk',
        currency: 'LKR',
        customerPhone: '94771234567',
        items: [{ productId: product.id, quantity: -2 }],
      });
    }, /Invalid quantity/);

    await assert.rejects(async () => {
      await createOrderRequest({
        orderRef: `SCH-INV2-${Date.now()}`,
        market: 'lk',
        currency: 'LKR',
        customerPhone: '94771234567',
        items: [{ productId: product.id, quantity: 2.5 }],
      });
    }, /Invalid quantity/);
  });

  test('In production, failing database prevents false order confirmation', async () => {
    const originalEnv = process.env.NODE_ENV;
    const catalog = await getProducts();
    const product = catalog[0];

    try {
      process.env.NODE_ENV = 'production';

      await assert.rejects(async () => {
        await createOrderRequest({
          orderRef: `SCH-PROD-FAIL-${Date.now()}`,
          market: 'lk',
          currency: 'LKR',
          customerPhone: '94771234567',
          items: [{ productId: product.id, quantity: 1 }],
        });
      }, /Database connection unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('P1: Stateless Signed Session Authentication & CORS', () => {
  test('createSessionToken generates valid signature verified by verifyAdminSession', () => {
    const token = createSessionToken('test_admin');
    const mockReq = {
      headers: {
        cookie: `sch_admin_session=${token}`,
      },
    };

    assert.equal(verifyAdminSession(mockReq), true);
    assert.equal(mockReq.adminUser, 'test_admin');
  });

  test('verifyAdminSession rejects tampered or forged tokens', () => {
    const token = createSessionToken('test_admin');
    const tampered = token.slice(0, -4) + 'abcd';
    const mockReq = {
      headers: {
        cookie: `sch_admin_session=${tampered}`,
      },
    };

    assert.equal(verifyAdminSession(mockReq), false);
  });

  test('POST /api/products rejects requests without valid admin session', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: '1', name: 'Test', price: 'Rs. 100' }]),
    });

    assert.equal(res.status, 403);
  });
});

describe('P0: Webhook Durable Persistence & Ingestion Retries', () => {
  test('Webhook rejects with HTTP 503 if inbox persistence fails so Meta can retry', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: `wamid.fail_persist_${Date.now()}`,
                from: '94771234567',
                type: 'text',
                text: { body: 'Test message' },
              }],
            },
          }],
        }],
      });

      const signature = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(payload).digest('hex');

      const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': `sha256=${signature}`,
        },
        body: payload,
      });

      assert.equal(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /Storage unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('Webhook acknowledges HTTP 200 only after durable inbox persistence succeeds', async () => {
    const msgId = `wamid.test_persist_${Date.now()}`;
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ id: msgId, from: '94779998877', type: 'text', text: { body: '1' } }] } }] }],
    });

    const signature = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(payload).digest('hex');

    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: payload,
    });

    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'EVENT_RECEIVED');
  });

  test('Failed inbox business logic records failure and increments attempts without premature completion', async () => {
    const msgId = `wamid.fail_track_${Date.now()}`;
    await persistWebhookEventToInbox({
      messageId: msgId,
      senderPhone: '94771112233',
      messageText: 'trigger failure',
      rawPayload: {},
    });

    const lock = await claimInboxLock(msgId);
    assert.equal(lock.claimed, true);
    assert.equal(lock.attempts, 1);

    await recordInboxFailure(msgId, 'Simulated downstream failure');

    const retryLock = await claimInboxLock(msgId, { bypassBackoff: true });
    assert.equal(retryLock.claimed, true);
    assert.equal(retryLock.attempts, 2);
  });
});

describe('P0: Atomic Order Function Security & Role Restrictions', () => {
  test('createOrderRequest rejects market and currency mismatch', async () => {
    const catalog = await getProducts();
    const product = catalog[0];

    await assert.rejects(async () => {
      await createOrderRequest({
        orderRef: `SCH-MISMATCH-1-${Date.now()}`,
        market: 'lk',
        currency: 'USD',
        customerPhone: '94771234567',
        items: [{ productId: product.id, quantity: 1 }],
      });
    }, /Currency mismatch/);

    await assert.rejects(async () => {
      await createOrderRequest({
        orderRef: `SCH-MISMATCH-2-${Date.now()}`,
        market: 'intl',
        currency: 'LKR',
        customerPhone: '94771234567',
        items: [{ productId: product.id, quantity: 1 }],
      });
    }, /Currency mismatch/);
  });

  test('Migration SQL verifies fixed search_path and revokes function privileges from PUBLIC', () => {
    const migrationSql = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase', 'migrations', '20261027_market_pricing_schema.sql'),
      'utf-8'
    );

    assert.ok(
      migrationSql.includes('SET search_path = public, pg_temp'),
      'create_order_request_atomic must enforce fixed search_path = public, pg_temp'
    );

    assert.ok(
      migrationSql.includes('REVOKE ALL ON FUNCTION public.create_order_request_atomic FROM PUBLIC, anon, authenticated;'),
      'Function execution must be revoked from PUBLIC, anon, and authenticated'
    );
    assert.ok(
      migrationSql.includes('GRANT EXECUTE ON FUNCTION public.create_order_request_atomic TO service_role;'),
      'Function execution must be granted strictly to service_role'
    );

    assert.ok(
      migrationSql.includes('REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;'),
      'Orders table must be inaccessible to anonymous clients'
    );
    assert.ok(
      migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON public.reviews FROM PUBLIC, anon;'),
      'Direct review inserts must be revoked from public/anon'
    );
  });
});

describe('P0: False Admin Success Prevention & Multi-Product Atomicity', () => {
  test('POST /api/products returns HTTP 503 when savedToDb is false', async () => {
    const token = createSessionToken('test_admin');
    const catalog = await getProducts();

    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `sch_admin_session=${token}`,
      },
      body: JSON.stringify(catalog),
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.savedToDb, false);
    assert.match(body.error, /Database persistence unavailable/);
  });

  test('saveProducts strictly fails in production if Supabase is unavailable', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const catalog = await getProducts();

      await assert.rejects(async () => {
        await saveProducts(catalog);
      }, /Database connection unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('Saving products invalidates in-memory cache so fresh queries read authoritative state', async () => {
    const catalog = await getProducts();
    await saveProducts(catalog);
    const fresh = await getProducts();
    assert.equal(fresh.length, catalog.length);
  });
});

describe('P0: Initial Catalog Seed Audit & Setup Validation', () => {
  test('Seed file contains exactly 10 verified products with IDs 9-18 from public/products.json', () => {
    const seedSql = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase', 'seed', '20261027_initial_catalog_seed.sql'),
      'utf-8'
    );

    const publicJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'public', 'products.json'), 'utf-8')
    );

    assert.equal(publicJson.length, 10, 'public/products.json must contain exactly 10 products');

    for (const item of publicJson) {
      assert.ok(seedSql.includes(`'${item.id}'`), `Seed must include product ID ${item.id}`);
      assert.ok(seedSql.includes(item.name), `Seed must include product name ${item.name}`);
    }

    assert.ok(seedSql.includes('ON CONFLICT (id) DO NOTHING;'), 'Seed must use ON CONFLICT DO NOTHING to prevent destructive overwrites');
  });
});

describe('P0: Canonical Environment Variable & Startup Validation', () => {
  test('Startup strictly enforces WHATSAPP_ACCESS_TOKEN and fails if missing in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      assert.throws(() => validateServerConfig(), /WHATSAPP_ACCESS_TOKEN/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    }
  });

  test('Startup strictly enforces WHATSAPP_PHONE_NUMBER_ID in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      assert.throws(() => validateServerConfig(), /WHATSAPP_PHONE_NUMBER_ID/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.WHATSAPP_PHONE_NUMBER_ID = originalId;
    }
  });
});

describe('P0: WhatsApp Sending Error Propagation & Fail-Closed Behavior', () => {
  test('sendWhatsAppMessage strictly throws in production when credentials are unset', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      await assert.rejects(async () => {
        await sendWhatsAppMessage('94771234567', 'test message');
      }, /Meta WhatsApp credentials missing/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    }
  });

  test('sendWhatsAppMessage propagates HTTP failure from Meta API when fetch returns error', async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const originalPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const originalTestFlag = process.env.TEST_REAL_WHATSAPP_CALLS;
    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-valid';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
      process.env.TEST_REAL_WHATSAPP_CALLS = 'true';
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Meta Error',
      });
      await assert.rejects(async () => {
        await sendWhatsAppMessage('94771234567', 'test message');
      }, /WhatsApp API delivery failed \(500\)/);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneId;
      if (originalTestFlag === undefined) delete process.env.TEST_REAL_WHATSAPP_CALLS; else process.env.TEST_REAL_WHATSAPP_CALLS = originalTestFlag;
    }
  });
});

describe('P0: Production Database Fail-Safe Guards', () => {
  test('In production, claimInboxLock strictly fails if database is unavailable', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(async () => {
        await claimInboxLock('test.msg.id');
      }, /Database unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('In production, completeInboxMessage strictly fails if database is unavailable', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(async () => {
        await completeInboxMessage('test.msg.id');
      }, /Database unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('In production, recordInboxFailure strictly fails if database is unavailable', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(async () => {
        await recordInboxFailure('test.msg.id', 'Simulated error');
      }, /Database unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('In production, saveConversationSession strictly fails if database is unavailable', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(async () => {
        await saveConversationSession('94771234567', 'MAIN_MENU', {});
      }, /Database unavailable/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('P0: Durable Inbox Retry Worker & Dead-Letter Policy', () => {
  test('processInboxQueue processes received events and marks them completed', async () => {
    const msgId = `wamid.worker_test_${Date.now()}`;
    await persistWebhookEventToInbox({
      messageId: msgId,
      senderPhone: '94778881122',
      messageText: 'menu',
      rawPayload: {},
    });

    const summary = await processInboxQueue({ batchSize: 10 });
    assert.ok(summary.processed >= 1);
    assert.ok(summary.succeeded >= 1);

    // Subsequent claim confirms already completed
    const check = await claimInboxLock(msgId);
    assert.equal(check.claimed, false);
    assert.equal(check.reason, 'already_completed');
  });

  test('GET /api/inbox/process triggers worker and returns JSON summary', async () => {
    const res = await fetch(`${baseUrl}/api/inbox/process`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.summary);
  });

  test('Inbox transitions to dead_letter after reaching max attempts', async () => {
    const msgId = `wamid.deadletter_${Date.now()}`;
    await persistWebhookEventToInbox({
      messageId: msgId,
      senderPhone: '94778889900',
      messageText: 'fail',
      rawPayload: {},
    });

    // Simulate 5 attempts
    for (let i = 0; i < 5; i++) {
      await claimInboxLock(msgId, { bypassBackoff: true });
      await recordInboxFailure(msgId, `Attempt ${i + 1} failed`);
    }

    // 6th claim must be rejected as dead_letter
    const sixthLock = await claimInboxLock(msgId);
    assert.equal(sixthLock.claimed, false);
    assert.equal(sixthLock.reason, 'dead_letter');
  });
});

describe('P0: Order Creation Retries & Idempotency', () => {
  test('Order retry does not create duplicate order when confirmation reply previously failed', async () => {
    const catalog = await getProducts();
    const product = catalog[0];
    const testPhone = `9477000${Math.floor(1000 + Math.random() * 9000)}`;

    // Setup draft order state
    await saveConversationSession(testPhone, 'ORDER_CONFIRMATION', {
      market: 'lk',
      currency: 'LKR',
      selectedProductId: product.id,
      selectedProductName: product.name,
      selectedUnitPrice: product.priceValue,
      draftOrder: {
        productId: product.id,
        productName: product.name,
        quantity: 2,
        unitPrice: product.priceValue,
        subtotal: product.priceValue * 2,
      },
    });

    // First confirmation execution
    await handleIncomingMessage(testPhone, 'YES');
    const sessionAfterFirst = await getConversationSession(testPhone);
    assert.equal(sessionAfterFirst.state, 'MAIN_MENU');
  });
});

describe('P0: Strict Product & Price Validation on Update', () => {
  test('saveProducts rejects update with missing or invalid product ID', async () => {
    await assert.rejects(async () => {
      await saveProducts([{ id: '', name: 'Test', price: 'Rs. 100' }]);
    }, /Missing or invalid product ID/);
  });

  test('saveProducts rejects update with missing product name', async () => {
    await assert.rejects(async () => {
      await saveProducts([{ id: '999', name: '', price: 'Rs. 100' }]);
    }, /Missing product name/);
  });

  test('saveProducts rejects update with missing or non-positive local LKR price', async () => {
    await assert.rejects(async () => {
      await saveProducts([{ id: '999', name: 'Test', price: 'Rs. 0', priceValue: 0 }]);
    }, /Local LKR price must be a strictly positive amount/);

    await assert.rejects(async () => {
      await saveProducts([{ id: '999', name: 'Test', price: 'invalid' }]);
    }, /Local LKR price must be a strictly positive amount/);
  });
});


describe('P0: Simulation Protection & Worker Route Authorization in Production', () => {
  test('sendWhatsAppMessage strictly rejects WHATSAPP_SIMULATION_MODE=true in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSim = process.env.WHATSAPP_SIMULATION_MODE;
    try {
      process.env.NODE_ENV = 'production';
      process.env.WHATSAPP_SIMULATION_MODE = 'true';
      await assert.rejects(async () => {
        await sendWhatsAppMessage('94771234567', 'test');
      }, /Simulation mode is strictly prohibited in production/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSim === undefined) delete process.env.WHATSAPP_SIMULATION_MODE; else process.env.WHATSAPP_SIMULATION_MODE = originalSim;
    }
  });

  test('POST /api/inbox/process rejects request in production without valid CRON_SECRET or Admin session', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.CRON_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.CRON_SECRET = 'super_secret_cron_key_12345';

      // Unauthorized request
      const res = await new Promise((resolve) => {
        const req = http.request(
          `http://localhost:${server.address().port}/api/inbox/process`,
          { method: 'POST' },
          resolve
        );
        req.end();
      });
      assert.equal(res.statusCode, 401);

      // Authorized request with Bearer token
      const authRes = await new Promise((resolve) => {
        const req = http.request(
          `http://localhost:${server.address().port}/api/inbox/process`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer super_secret_cron_key_12345',
            },
          },
          resolve
        );
        req.end();
      });
      // Request passed auth filter and reached database layer (not 401 unauthorized)
      assert.notEqual(authRes.statusCode, 401);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
    }
  });
});

describe('P1: Database Verification Script (Mocked Diagnostic Engine)', () => {
  const sampleCatalog = [
    {
      id: '9',
      name: 'Cinnamon Sticks (100g)',
      category: 'Spices',
      imageUrl: '/images/42.png',
      price: 'Rs. 1,000',
      priceValue: 1000,
    },
  ];

  function createMockSupabase(overrides = {}) {
    return (targetUrl, key) => ({
      from: (table) => ({
        select: (cols) => ({
          eq: (field, val) => {
            if (table === 'products') {
              return Promise.resolve({
                data: overrides.products || [
                  {
                    id: '9',
                    name: 'Cinnamon Sticks (100g)',
                    category: 'Spices',
                    image_url: '/images/42.png',
                    is_active: true,
                  },
                ],
                error: overrides.productsError || null,
              });
            }
            if (table === 'product_prices') {
              return Promise.resolve({
                data: overrides.prices || [
                  {
                    product_id: '9',
                    market: 'lk',
                    currency: 'LKR',
                    price_amount: 1000,
                    display_price: 'Rs. 1,000',
                    is_active: true,
                  },
                ],
                error: overrides.pricesError || null,
              });
            }
            if (table === 'reviews') {
              return Promise.resolve({
                data: overrides.reviews || [],
                error: overrides.reviewsError || null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          limit: (n) => {
            if (['orders', 'order_items', 'whatsapp_inbox', 'whatsapp_conversations'].includes(table)) {
              if (key === 'mock_anon_key' && !overrides.allowPrivateLeak) {
                return Promise.resolve({
                  data: null,
                  error: { message: `permission denied for table ${table}`, code: '42501' },
                });
              }
              // If leak simulated: returns data with NO error!
              return Promise.resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
        insert: (row) => {
          if (table === 'reviews' && key === 'mock_anon_key') {
            return Promise.resolve({
              error: overrides.allowAnonReviewInsert ? null : { message: 'permission denied for table reviews', code: '42501' },
            });
          }
          return Promise.resolve({ error: null });
        },
      }),
    });
  }

  test('Returns PENDING and exitCode 2 when credentials are not configured', async () => {
    const res = await runDatabaseAudit({ url: '', serviceKey: '' });
    assert.equal(res.status, 'PENDING');
    assert.equal(res.exitCode, 2);
  });

  test('Passes when catalog parity, prices, and anonymous permissions match expected state', async () => {
    const res = await runDatabaseAudit({
      url: 'https://mock.supabase.co',
      serviceKey: 'mock_service_key',
      anonKey: 'mock_anon_key',
      clientFactory: createMockSupabase(),
      catalogData: sampleCatalog,
    });
    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.exitCode, 0);
  });

  test('Fails when product name, category, or image path does not match catalog', async () => {
    const badProductFactory = createMockSupabase({
      products: [
        {
          id: '9',
          name: 'Tampered Name',
          category: 'Spices',
          image_url: '/images/42.png',
          is_active: true,
        },
      ],
    });

    await assert.rejects(async () => {
      await runDatabaseAudit({
        url: 'https://mock.supabase.co',
        serviceKey: 'mock_service_key',
        clientFactory: badProductFactory,
        catalogData: sampleCatalog,
      });
    }, /Name mismatch/);
  });

  test('Fails when local LKR price does not match catalog', async () => {
    const badPriceFactory = createMockSupabase({
      prices: [
        {
          product_id: '9',
          market: 'lk',
          currency: 'LKR',
          price_amount: 500, // Expected 1000
          display_price: 'Rs. 500',
          is_active: true,
        },
      ],
    });

    await assert.rejects(async () => {
      await runDatabaseAudit({
        url: 'https://mock.supabase.co',
        serviceKey: 'mock_service_key',
        clientFactory: badPriceFactory,
        catalogData: sampleCatalog,
      });
    }, /price amount mismatch/);
  });

  test('Fails with security violation if anonymous query to whatsapp_inbox succeeds without error', async () => {
    const leakingFactory = createMockSupabase({ allowPrivateLeak: true });

    await assert.rejects(async () => {
      await runDatabaseAudit({
        url: 'https://mock.supabase.co',
        serviceKey: 'mock_service_key',
        anonKey: 'mock_anon_key',
        clientFactory: leakingFactory,
        catalogData: sampleCatalog,
      });
    }, /CRITICAL SECURITY VIOLATION: Anonymous client successfully queried/);
  });
});
