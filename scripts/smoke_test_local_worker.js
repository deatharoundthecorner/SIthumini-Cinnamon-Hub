/**
 * Sithumini Cinnamon Hub: Local Cloudflare Worker Runtime Smoke Test Suite
 * Spawns real Wrangler local dev server with local D1 binding and exercises:
 * 1. GET /api/health
 * 2. GET /api/products (verifying catalog & stock: null)
 * 3. POST /api/login (invalid password rejection 401)
 * 4. POST /api/login (valid credentials & session cookie issuance)
 * 5. GET /api/me (session verification with cookie)
 * 6. POST /api/products (invalid price rejection 400)
 * 7. POST /api/products (valid price edit to Rs. 1,050)
 * 8. Fresh GET /api/products to verify D1 persistence
 * 9. POST /api/orders (creating draft order via website API)
 * 10. WhatsApp message delivery via webhook & scheduled inbox processing
 * 11. Order state transition from 'draft' -> 'confirmed' and phone association in D1
 * 12. Verification of single order row and no duplicate order items
 * 13. Duplicate WhatsApp delivery handling (0 duplicate orders or items)
 * 14. Stale draft abandonment verification via scheduled execution (old -> abandoned, recent -> draft)
 * 15. Credential sanitization check (no passwords or tokens leaked in logs)
 * 16. Restoring catalog price back to pristine Rs. 1,000
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_ADMIN_USER = 'local_smoke_admin';
const TEST_ADMIN_PASS = 'SmokeTestSecure2026!';

// 1. Generate salted PBKDF2 hash for local test credentials
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
const derivedHash = crypto.pbkdf2Sync(TEST_ADMIN_PASS, salt, 100000, 32, 'sha256').toString('hex');
const passwordHash = `pbkdf2_sha256$100000$${saltHex}$${derivedHash}`;

const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
const devVarsBackup = fs.existsSync(devVarsPath) ? fs.readFileSync(devVarsPath, 'utf8') : null;

const devVarsContent = `# Auto-generated for local Worker smoke testing
NODE_ENV=development
ADMIN_USERNAME=${TEST_ADMIN_USER}
ADMIN_PASSWORD_HASH=${passwordHash}
SESSION_SECRET=local_smoke_test_session_secret_32_chars
META_GRAPH_API_VERSION=v26.0
WHATSAPP_ACCESS_TOKEN=local_test_token
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_VERIFY_TOKEN=local_verify_token
WHATSAPP_APP_SECRET=local_app_secret
OWNER_PHONE_NUMBER=94771234567
CRON_SECRET=local_cron_secret
WHATSAPP_SIMULATION_MODE=true
ABANDONED_DRAFT_TIMEOUT_MINUTES=60
`;

fs.writeFileSync(devVarsPath, devVarsContent, 'utf8');

function executeD1(sql) {
  const singleLine = sql.replace(/\s+/g, ' ').trim();
  const output = execSync(
    `npx wrangler d1 execute sithumini-hub-db --local --json --command "${singleLine.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(output);
  return parsed[0]?.results || [];
}

function makeSingleRequest(method, pathname, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body) {
      reqBody = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: data,
            json,
          });
        });
      }
    );

    req.on('error', reject);
    if (reqBody) {
      req.write(reqBody);
    }
    req.end();
  });
}

async function request(method, pathname, options = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await makeSingleRequest(method, pathname, options);
    } catch (err) {
      if ((err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') && attempt < retries) {
        await sleep(600);
        continue;
      }
      throw err;
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSmokeTests() {
  console.log('=== SITHUMINI CINNAMON HUB: LOCAL WORKER RUNTIME SMOKE TESTS ===');
  console.log(`Starting wrangler dev on http://127.0.0.1:${PORT}...`);

  const serverLogs = [];
  const wranglerProcess = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--test-scheduled',
      '--show-interactive-dev-session',
      'false',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    }
  );

  wranglerProcess.stdout.on('data', (d) => {
    const msg = d.toString();
    serverLogs.push(msg);
  });
  wranglerProcess.stderr.on('data', (d) => {
    const msg = d.toString();
    serverLogs.push(msg);
  });

  // Wait for wrangler dev to be ready
  let isReady = false;
  for (let attempt = 1; attempt <= 30; attempt++) {
    await sleep(500);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200 && res.json?.status === 'ok') {
        isReady = true;
        console.log(`[PASS] Worker runtime ready after attempt ${attempt}`);
        break;
      }
    } catch (e) {}
  }

  if (!isReady) {
    console.error('FAILED: wrangler dev did not become ready within 15 seconds.');
    console.error('Captured logs:\n', serverLogs.join('\n'));
    killWrangler(wranglerProcess);
    cleanup();
    process.exit(1);
  }

  let sessionCookie = null;

  try {
    // 1. GET /api/health
    console.log('\n--- 1. Testing GET /api/health ---');
    const healthRes = await request('GET', '/api/health');
    console.log(`Status: ${healthRes.status}`, healthRes.json);
    if (healthRes.status !== 200 || healthRes.json?.runtime !== 'cloudflare_workers') {
      throw new Error('GET /api/health returned invalid response');
    }
    console.log('[PASS] /api/health verified');

    // 2. GET /api/products
    console.log('\n--- 2. Testing GET /api/products ---');
    const prodsRes = await request('GET', '/api/products');
    console.log(`Status: ${prodsRes.status} | Products count: ${prodsRes.json?.length}`);
    const p9Initial = prodsRes.json?.find((p) => p.id === '9');
    console.log(`Product 9: ${p9Initial?.name} | Price: ${p9Initial?.price} | Stock: ${p9Initial?.stock}`);
    if (prodsRes.status !== 200 || !Array.isArray(prodsRes.json) || prodsRes.json.length < 10) {
      throw new Error('GET /api/products failed or returned incomplete catalog');
    }
    if (p9Initial?.stock !== null) {
      throw new Error(`Expected stock: null for product 9, got: ${p9Initial?.stock}`);
    }
    console.log('[PASS] /api/products verified with stock: null');

    // 3. Admin Authentication: Failed login
    console.log('\n--- 3. Testing POST /api/login (Invalid credentials) ---');
    const badLoginRes = await request('POST', '/api/login', {
      body: { username: TEST_ADMIN_USER, password: 'WrongPassword!' },
    });
    console.log(`Status: ${badLoginRes.status}`);
    if (badLoginRes.status !== 401) {
      throw new Error(`Expected 401 for bad password, got: ${badLoginRes.status}`);
    }
    console.log('[PASS] Invalid login correctly rejected with 401');

    // 4. Admin Authentication: Successful login
    console.log('\n--- 4. Testing POST /api/login (Valid credentials) ---');
    const goodLoginRes = await request('POST', '/api/login', {
      body: { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS },
    });
    console.log(`Status: ${goodLoginRes.status}`);
    const rawSetCookie = goodLoginRes.headers['set-cookie'];
    console.log(`Set-Cookie header present: ${!!rawSetCookie}`);
    if (goodLoginRes.status !== 200 || !goodLoginRes.json?.ok) {
      throw new Error('Valid admin login failed');
    }
    sessionCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie;
    sessionCookie = sessionCookie.split(';')[0];
    console.log('[PASS] Admin login succeeded and issued session cookie');

    // 5. Session validation: GET /api/me
    console.log('\n--- 5. Testing GET /api/me (Session check) ---');
    const meRes = await request('GET', '/api/me', {
      headers: { Cookie: sessionCookie },
    });
    console.log(`Status: ${meRes.status}`, meRes.json);
    if (meRes.status !== 200 || !meRes.json?.authenticated || meRes.json?.username !== TEST_ADMIN_USER) {
      throw new Error('Session verification failed on /api/me');
    }
    console.log('[PASS] GET /api/me confirmed active admin session');

    // 6. Invalid Price Update Rejection
    console.log('\n--- 6. Testing POST /api/products (Invalid price rejection) ---');
    const invalidUpdateRes = await request('POST', '/api/products', {
      headers: { Cookie: sessionCookie },
      body: [
        {
          id: '9',
          name: 'Cinnamon Sticks (100g)',
          price: 'Rs. 0',
        },
      ],
    });
    console.log(`Status: ${invalidUpdateRes.status}`);
    if (invalidUpdateRes.status !== 400) {
      throw new Error(`Expected 400 for non-positive price, got: ${invalidUpdateRes.status}`);
    }
    console.log('[PASS] Invalid price correctly rejected with 400');

    // 7. Valid Product Update: Persist price edit to local D1
    console.log('\n--- 7. Testing POST /api/products (Valid price update to Rs. 1,050) ---');
    const allProducts = prodsRes.json.map((p) => {
      if (p.id === '9') {
        return { ...p, price: 'Rs. 1,050', priceValue: 1050 };
      }
      return p;
    });

    const updateRes = await request('POST', '/api/products', {
      headers: { Cookie: sessionCookie },
      body: allProducts,
    });
    console.log(`Status: ${updateRes.status}`, updateRes.json);
    if (updateRes.status !== 200 || !updateRes.json?.savedToDb) {
      throw new Error('Valid product price update failed');
    }
    console.log('[PASS] Product update accepted and confirmed saved to D1');

    // 8. Fresh API request to verify persistence
    console.log('\n--- 8. Testing fresh GET /api/products to verify D1 persistence ---');
    const freshRes = await request('GET', '/api/products');
    const p9Updated = freshRes.json?.find((p) => p.id === '9');
    console.log(`Product 9 in fresh response: ${p9Updated?.price} (${p9Updated?.priceValue})`);
    if (p9Updated?.priceValue !== 1050 || p9Updated?.price !== 'Rs. 1,050') {
      throw new Error(`Price update did not persist to D1! Got: ${p9Updated?.price}`);
    }
    console.log('[PASS] Price update successfully persisted and verified in fresh API request');

    // 9. Customer Order Request: POST /api/orders (Draft Creation)
    console.log('\n--- 9. Testing POST /api/orders (Website checkout draft) ---');
    const orderRef = `SCH-SMOKE-${Date.now().toString(36).toUpperCase()}`;
    const customerPhone = '94779998877';

    // Clean up any old smoke test order
    executeD1(`DELETE FROM orders WHERE order_ref = '${orderRef}';`);

    const orderRes = await request('POST', '/api/orders', {
      body: {
        orderRef,
        customerName: 'Sahan Jayawardena',
        customerPhone: '0779998877',
        market: 'lk',
        currency: 'LKR',
        deliveryCity: 'Galle',
        items: [{ productId: '9', quantity: 2 }],
        source: 'web',
        status: 'draft',
      },
    });
    console.log(`Status: ${orderRes.status}`, orderRes.json);
    if (orderRes.status !== 200 || !orderRes.json?.ok) {
      throw new Error('POST /api/orders failed');
    }
    const createdOrderId = orderRes.json?.order?.orderId;
    // Subtotal must be calculated from new price: 1050 * 2 = 2100
    if (orderRes.json?.order?.subtotal !== 2100) {
      throw new Error(`Expected authoritative subtotal 2100, got: ${orderRes.json?.order?.subtotal}`);
    }
    if (orderRes.json?.order?.status !== 'draft') {
      throw new Error(`Expected draft status, got: ${orderRes.json?.order?.status}`);
    }

    // Verify D1 initial draft state
    const d1DraftOrders = executeD1(`SELECT id, order_ref, status, customer_phone FROM orders WHERE order_ref = '${orderRef}';`);
    console.log('D1 draft order query:', d1DraftOrders);
    if (d1DraftOrders.length !== 1 || d1DraftOrders[0].status !== 'draft') {
      throw new Error(`Expected 1 draft order in D1, found: ${JSON.stringify(d1DraftOrders)}`);
    }
    const d1InitialItems = executeD1(`SELECT count(*) as count FROM order_items WHERE order_id = '${d1DraftOrders[0].id}';`);
    if (d1InitialItems[0]?.count !== 1) {
      throw new Error(`Expected 1 line item in D1, found: ${d1InitialItems[0]?.count}`);
    }
    console.log('[PASS] Website draft order created in D1 with status: draft');

    // 10. WhatsApp message delivery via webhook
    console.log('\n--- 10. Delivering WhatsApp Webhook with Order Reference ---');
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456789',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '94770000000', phone_number_id: '123456789' },
                messages: [
                  {
                    from: customerPhone,
                    id: `wamid.smoke_${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: {
                      body: `🌿 SITHUMINI CINNAMON HUB — ORDER REQUEST\nReference: ${orderRef}\nMarket: Sri Lanka (LKR)\nCustomer: Sahan Jayawardena`,
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const rawWebhookBody = JSON.stringify(webhookPayload);
    const signature = crypto.createHmac('sha256', 'local_app_secret').update(rawWebhookBody).digest('hex');

    const webhookRes = await request('POST', '/api/whatsapp/webhook', {
      headers: {
        'X-Hub-Signature-256': `sha256=${signature}`,
      },
      body: rawWebhookBody,
    });
    console.log(`Webhook status: ${webhookRes.status}`);
    if (webhookRes.status !== 200) {
      throw new Error(`Webhook failed with status: ${webhookRes.status}`);
    }

    // Process inbox queue via scheduled handler
    console.log('Triggering /__scheduled to process queued inbox event...');
    const scheduledRes1 = await request('GET', '/__scheduled');
    if (scheduledRes1.status !== 200) {
      throw new Error(`Scheduled execution failed with status ${scheduledRes1.status}`);
    }

    // 11. Verify D1 order state transition: 'draft' -> 'confirmed' & phone association
    console.log('\n--- 11. Verifying D1 Order State Transition (draft -> confirmed) ---');
    const d1ConfirmedOrders = executeD1(`SELECT id, order_ref, status, customer_phone FROM orders WHERE order_ref = '${orderRef}';`);
    console.log('D1 confirmed order state:', d1ConfirmedOrders);
    if (d1ConfirmedOrders.length !== 1) {
      throw new Error(`Expected exactly 1 order in D1, found: ${d1ConfirmedOrders.length}`);
    }
    const confirmedOrder = d1ConfirmedOrders[0];
    if (confirmedOrder.status !== 'confirmed') {
      throw new Error(`Expected status: 'confirmed', got: '${confirmedOrder.status}'`);
    }
    if (confirmedOrder.customer_phone !== customerPhone) {
      throw new Error(`Expected customer_phone: '${customerPhone}', got: '${confirmedOrder.customer_phone}'`);
    }

    // 12. Verify no duplicate order items
    const d1ConfirmedItems = executeD1(`SELECT count(*) as count FROM order_items WHERE order_id = '${confirmedOrder.id}';`);
    console.log(`Line items count for order: ${d1ConfirmedItems[0]?.count}`);
    if (d1ConfirmedItems[0]?.count !== 1) {
      throw new Error(`Expected exactly 1 line item, found: ${d1ConfirmedItems[0]?.count}`);
    }
    console.log('[PASS] Order successfully confirmed with phone associated and 0 duplicate items');

    // 13. Duplicate WhatsApp Delivery Test
    console.log('\n--- 12. Testing Duplicate WhatsApp Delivery (Idempotency) ---');
    const duplicatePayload = {
      ...webhookPayload,
      entry: [
        {
          ...webhookPayload.entry[0],
          changes: [
            {
              ...webhookPayload.entry[0].changes[0],
              value: {
                ...webhookPayload.entry[0].changes[0].value,
                messages: [
                  {
                    ...webhookPayload.entry[0].changes[0].value.messages[0],
                    id: `wamid.smoke_dup_${Date.now()}`, // New Meta message delivery attempt
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const rawDupBody = JSON.stringify(duplicatePayload);
    const dupSig = crypto.createHmac('sha256', 'local_app_secret').update(rawDupBody).digest('hex');

    await request('POST', '/api/whatsapp/webhook', {
      headers: { 'X-Hub-Signature-256': `sha256=${dupSig}` },
      body: rawDupBody,
    });
    await request('GET', '/__scheduled');

    const d1DupOrders = executeD1(`SELECT id, order_ref, status FROM orders WHERE order_ref = '${orderRef}';`);
    const d1DupItems = executeD1(`SELECT count(*) as count FROM order_items WHERE order_id = '${confirmedOrder.id}';`);
    console.log(`After duplicate delivery: Orders count = ${d1DupOrders.length}, Items count = ${d1DupItems[0]?.count}`);
    if (d1DupOrders.length !== 1) {
      throw new Error(`CRITICAL: Duplicate order created! Expected 1, found: ${d1DupOrders.length}`);
    }
    if (d1DupItems[0]?.count !== 1) {
      throw new Error(`CRITICAL: Duplicate order items created! Expected 1, found: ${d1DupItems[0]?.count}`);
    }
    console.log('[PASS] Duplicate delivery handled idempotently without creating duplicate orders or items');

    // 14. Stale Draft Abandonment Verification via Scheduled Handler
    console.log('\n--- 13. Testing Stale Draft Abandonment via Scheduled Handler ---');
    const oldOrderRef = 'SCH-STALE-OLD';
    const recentOrderRef = 'SCH-RECENT-NEW';

    executeD1(`DELETE FROM orders WHERE order_ref IN ('${oldOrderRef}', '${recentOrderRef}');`);

    // Insert old draft (120 minutes old)
    executeD1(`INSERT INTO orders (id, order_ref, customer_name, customer_phone, market, currency, subtotal, status, source, created_at, updated_at) VALUES ('smoke_old_01', '${oldOrderRef}', 'Old Customer', '0771112233', 'lk', 'LKR', 1000, 'draft', 'web', datetime('now', '-120 minutes'), datetime('now', '-120 minutes'));`);

    // Insert recent draft (5 minutes old)
    executeD1(`INSERT INTO orders (id, order_ref, customer_name, customer_phone, market, currency, subtotal, status, source, created_at, updated_at) VALUES ('smoke_rec_01', '${recentOrderRef}', 'Recent Customer', '0774445566', 'lk', 'LKR', 1000, 'draft', 'web', datetime('now', '-5 minutes'), datetime('now', '-5 minutes'));`);

    const preCheck = executeD1(`SELECT order_ref, status FROM orders WHERE order_ref IN ('${oldOrderRef}', '${recentOrderRef}');`);
    console.log('Pre-scheduled check:', preCheck);

    // Trigger scheduled handler to run markAbandonedDrafts
    await sleep(1000);
    const scheduledRes2 = await request('GET', '/__scheduled');
    if (scheduledRes2.status !== 200) {
      throw new Error(`Scheduled invocation failed: ${scheduledRes2.status}`);
    }

    const postCheck = executeD1(`SELECT order_ref, status FROM orders WHERE order_ref IN ('${oldOrderRef}', '${recentOrderRef}');`);
    console.log('Post-scheduled check:', postCheck);

    const oldOrder = postCheck.find((o) => o.order_ref === oldOrderRef);
    const recentOrder = postCheck.find((o) => o.order_ref === recentOrderRef);

    if (oldOrder?.status !== 'abandoned') {
      throw new Error(`Expected stale draft ${oldOrderRef} to become 'abandoned', got: '${oldOrder?.status}'`);
    }
    if (recentOrder?.status !== 'draft') {
      throw new Error(`Expected recent draft ${recentOrderRef} to remain 'draft', got: '${recentOrder?.status}'`);
    }
    console.log('[PASS] Stale draft transitioned to abandoned while recent draft remained unchanged');

    // Clean up test orders
    executeD1(`DELETE FROM orders WHERE order_ref IN ('${orderRef}', '${oldOrderRef}', '${recentOrderRef}');`);

    // 15. Check that no sensitive credentials were leaked in logs
    console.log('\n--- 14. Verifying Secret & Credential Log Sanitization ---');
    const combinedLogs = serverLogs.join('\n');
    const leakedStrings = [];
    if (combinedLogs.includes(TEST_ADMIN_PASS)) leakedStrings.push('TEST_ADMIN_PASS');
    if (combinedLogs.includes(passwordHash)) leakedStrings.push('ADMIN_PASSWORD_HASH');
    if (combinedLogs.includes('local_smoke_test_session_secret_32_chars')) leakedStrings.push('SESSION_SECRET');
    if (combinedLogs.includes('local_test_token')) leakedStrings.push('WHATSAPP_ACCESS_TOKEN');

    if (leakedStrings.length > 0) {
      throw new Error(`CRITICAL SECURITY FAILURE: Sensitive secrets logged: ${leakedStrings.join(', ')}`);
    }
    console.log('[PASS] Zero credential leaks detected in Worker logs');

    // 16. Revert price back to Rs. 1,000 for catalogue integrity
    console.log('\n--- 15. Reverting Product 9 price back to Rs. 1,000 ---');
    const pristineProducts = prodsRes.json.map((p) => {
      if (p.id === '9') {
        return { ...p, price: 'Rs. 1,000', priceValue: 1000 };
      }
      return p;
    });
    await request('POST', '/api/products', {
      headers: { Cookie: sessionCookie },
      body: pristineProducts,
    });
    console.log('[PASS] Catalogue reverted to pristine Rs. 1,000');

    console.log('\n=============================================================================');
    console.log('ALL LOCAL WORKER RUNTIME SMOKE TESTS & LIFECYCLE CHECKS PASSED! (15/15)');
    console.log('=============================================================================');
  } finally {
    killWrangler(wranglerProcess);
    cleanup();
    setTimeout(() => process.exit(0), 500);
  }
}

function killWrangler(proc) {
  try {
    if (process.platform === 'win32' && proc && proc.pid) {
      execSync(`taskkill /pid ${proc.pid} /f /t`, { stdio: 'ignore' });
    } else if (proc) {
      proc.kill();
    }
  } catch (e) {}
}

function cleanup() {
  if (devVarsBackup !== null) {
    fs.writeFileSync(devVarsPath, devVarsBackup, 'utf8');
  } else if (fs.existsSync(devVarsPath)) {
    fs.unlinkSync(devVarsPath);
  }
}

runSmokeTests().catch((err) => {
  console.error('\nSMOKE TEST FAILED:', err);
  cleanup();
  process.exit(1);
});
