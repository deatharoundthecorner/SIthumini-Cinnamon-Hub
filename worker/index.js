/**
 * Sithumini Cinnamon Hub: Cloudflare Worker Core
 * Zero-Monthly-Cost Architecture
 * Static Assets + D1 SQLite + Cron Triggers + WhatsApp Cloud API
 */

import {
  getProducts,
  saveProducts,
  createOrderRequest,
  markAbandonedDrafts,
} from './db.js';
import {
  verifyAdminCredentials,
  createSessionToken,
  getAdminFromRequest,
  buildSessionCookie,
  buildClearSessionCookie,
} from './auth.js';
import { handleWhatsAppWebhook } from './whatsapp.js';
import { processD1InboxQueue } from './inboxWorker.js';

export default {
  /**
   * Main HTTP Request Router
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isProd = env.NODE_ENV === 'production';

    // -------------------------------------------------------------------------
    // API ROUTING (/api/*)
    // -------------------------------------------------------------------------
    if (pathname.startsWith('/api/')) {
      const corsHeaders = {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hub-Signature-256',
        'Access-Control-Allow-Credentials': 'true',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const jsonResponse = (data, status = 200, extraHeaders = {}) => {
        return new Response(JSON.stringify(data), {
          status,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
            ...extraHeaders,
          },
        });
      };

      try {
        // GET /api/health
        if (pathname === '/api/health') {
          return jsonResponse({
            status: 'ok',
            runtime: 'cloudflare_workers',
            timestamp: new Date().toISOString(),
            d1_configured: !!env.DB,
            assets_configured: !!env.ASSETS,
          });
        }

        // GET /api/products
        if (pathname === '/api/products' && request.method === 'GET') {
          const products = await getProducts(env.DB, {
            includeCost: false,
            isProduction: isProd,
          });
          return jsonResponse(products);
        }

        // POST /api/admin/login
        if ((pathname === '/api/admin/login' || pathname === '/api/login') && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const { username, password } = body;

          const isValid = await verifyAdminCredentials(username, password, env);
          if (!isValid) {
            return jsonResponse({ ok: false, error: 'Invalid credentials' }, 401);
          }

          const token = await createSessionToken(username, env.SESSION_SECRET);
          const cookieHeader = buildSessionCookie(token, isProd);

          return jsonResponse({ ok: true, username }, 200, {
            'Set-Cookie': cookieHeader,
          });
        }

        // GET /api/admin/me
        if ((pathname === '/api/admin/me' || pathname === '/api/me') && request.method === 'GET') {
          const adminUser = await getAdminFromRequest(request, env);
          return jsonResponse({
            authenticated: !!adminUser,
            username: adminUser || null,
          });
        }

        // POST /api/admin/logout
        if ((pathname === '/api/admin/logout' || pathname === '/api/logout') && request.method === 'POST') {
          const clearCookie = buildClearSessionCookie(isProd);
          return jsonResponse({ ok: true }, 200, {
            'Set-Cookie': clearCookie,
          });
        }

        // POST /api/products or POST /api/admin/products (Admin update)
        if ((pathname === '/api/products' || pathname === '/api/admin/products') && request.method === 'POST') {
          const adminUser = await getAdminFromRequest(request, env);
          if (!adminUser) {
            return jsonResponse({ error: 'Unauthorized: Admin session required' }, 403);
          }

          const body = await request.json().catch(() => null);
          if (!Array.isArray(body) || body.length === 0) {
            return jsonResponse({ error: 'Invalid payload: Array of products expected' }, 400);
          }

          try {
            const result = await saveProducts(env.DB, body, adminUser);
            return jsonResponse({ ok: true, savedToDb: true, statementCount: result.statementCount });
          } catch (err) {
            return jsonResponse({ error: err.message }, 400);
          }
        }

        // POST /api/orders (Customer Order Request)
        if (pathname === '/api/orders' && request.method === 'POST') {
          const body = await request.json().catch(() => null);
          if (!body || !body.items || !Array.isArray(body.items)) {
            return jsonResponse({ error: 'Invalid order payload' }, 400);
          }

          const orderRef = body.orderRef || `SCH-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
          try {
            const order = await createOrderRequest(env.DB, {
              ...body,
              orderRef,
            });
            return jsonResponse({ ok: true, order });
          } catch (err) {
            return jsonResponse({ error: err.message }, 400);
          }
        }

        // GET & POST /api/whatsapp/webhook
        if (pathname === '/api/whatsapp/webhook') {
          return await handleWhatsAppWebhook(request, env);
        }

        // ALL /api/inbox/process (Durable inbox retry worker invocation)
        if (pathname === '/api/inbox/process') {
          const cronSecret = env.CRON_SECRET;
          const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

          if (isProd) {
            const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;
            const adminUser = await getAdminFromRequest(request, env);
            if (!isCronAuthorized && !adminUser) {
              return jsonResponse({ error: 'Unauthorized: Valid CRON_SECRET Bearer token or Admin session required' }, 401);
            }
          }

          const batchParam = url.searchParams.get('batch');
          const batchSize = batchParam ? parseInt(batchParam, 10) : 10;
          const summary = await processD1InboxQueue(env, { batchSize });
          const timeoutMinutes = env.ABANDONED_DRAFT_TIMEOUT_MINUTES
            ? parseInt(env.ABANDONED_DRAFT_TIMEOUT_MINUTES, 10)
            : 60;
          const abandonedCount = env.DB ? await markAbandonedDrafts(env.DB, timeoutMinutes) : 0;
          return jsonResponse({ ok: true, summary, abandonedDrafts: abandonedCount });
        }

        return jsonResponse({ error: `Not Found: ${pathname}` }, 404);
      } catch (err) {
        console.error(`[Worker API Error] ${pathname}:`, err.message);
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // STATIC ASSETS & SPA ROUTING (Vite React Build in dist/)
    // -------------------------------------------------------------------------
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      // If asset exists (CSS, JS, images, favicon), return it immediately
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // If asset was not found and request accepts HTML, fallback to index.html (SPA client-side routing)
      const acceptHeader = request.headers.get('Accept') || request.headers.get('accept') || '';
      if (request.method === 'GET' && acceptHeader.includes('text/html')) {
        const spaRequest = new Request(new URL('/index.html', request.url), request);
        return await env.ASSETS.fetch(spaRequest);
      }

      return assetResponse;
    }

    return new Response('Not Found: Cloudflare Workers Static Assets binding (ASSETS) not configured.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  },

  /**
   * Scheduled Cron Trigger Handler
   * Configured via triggers.crons in wrangler.jsonc
   * Retries recoverable failures and recovers expired locks from D1
   */
  async scheduled(event, env, ctx) {
    const scheduledTimeStr = event?.scheduledTime ? new Date(event.scheduledTime).toISOString() : new Date().toISOString();
    console.info(`[D1 Cron Worker] Triggered at ${scheduledTimeStr}`);

    const scheduledRunner = async () => {
      // 1. Process durable inbox retry queue
      try {
        const inboxSummary = await processD1InboxQueue(env, { batchSize: 10 });
        if (inboxSummary.processed > 0) {
          console.info(`[D1 Cron Worker] Completed inbox batch: ${inboxSummary.succeeded} succeeded, ${inboxSummary.failed} failed of ${inboxSummary.processed} claimed.`);
        }
      } catch (inboxErr) {
        console.error('[D1 Cron Worker Inbox Error]', inboxErr.message);
      }

      // 2. Mark abandoned checkout drafts (older than timeoutMinutes, default 60 minutes)
      try {
        if (env.DB) {
          const timeoutMinutes = env.ABANDONED_DRAFT_TIMEOUT_MINUTES
            ? parseInt(env.ABANDONED_DRAFT_TIMEOUT_MINUTES, 10)
            : 60;
          const abandonedChanges = await markAbandonedDrafts(env.DB, timeoutMinutes);
          if (abandonedChanges > 0) {
            console.info(`[D1 Cron Worker] Marked ${abandonedChanges} stale checkout draft(s) as abandoned (older than ${timeoutMinutes}m).`);
          }
        }
      } catch (abandonErr) {
        console.error('[D1 Cron Worker Abandoned Drafts Error]', abandonErr.message);
      }
    };

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(scheduledRunner());
    } else {
      await scheduledRunner();
    }
  },
};
