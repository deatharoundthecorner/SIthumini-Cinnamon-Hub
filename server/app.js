import { processInboxQueue } from './whatsapp/inboxWorker.js';
/**
 * Express Application Core
 * Sithumini Cinnamon Hub
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import whatsappRouter from './whatsapp/webhook.js';
import { validateServerConfig, isProduction } from './config.js';
import { getProducts, saveProducts } from './db/supabaseClient.js';
import {
  setAdminSessionCookie,
  clearAdminSessionCookie,
  verifyAdminSession,
} from './auth.js';

// Validate server environment variables
validateServerConfig();

const app = express();

app.use(helmet({
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  contentSecurityPolicy: false,
}));

// Capture raw body buffer for HMAC-SHA256 signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Explicit CORS origin allowlist in production
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : (isProduction ? [] : true);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || !isProduction || allowedOrigins === true || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
}));

app.set('trust proxy', 1);

// JSON syntax error catcher
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

// Rate limiters for sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 1 minute.' },
});

const productsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many product update requests.' },
});

// Admin authentication status (stateless verified cookie)
app.get('/api/me', (req, res) => {
  const authenticated = verifyAdminSession(req);
  res.json({ authenticated });
});

// Admin login (issues signed HTTP-only session cookie)
app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('[Auth Error] Admin credentials not configured on server.');
    return res.status(500).json({ ok: false, error: 'Authentication service unavailable' });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    setAdminSessionCookie(res, username);
    return res.json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// Admin logout
app.post('/api/logout', (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

// Public products endpoint: loads from database / catalog
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (e) {
    console.error('[API Products Error]', e.message);
    res.status(500).json({ error: 'Could not retrieve catalog' });
  }
});

// Admin-only products update endpoint
app.post('/api/products', productsLimiter, async (req, res) => {
  const isAuthenticated = verifyAdminSession(req);
  if (!isAuthenticated) {
    return res.status(403).json({ error: 'Unauthorized: Admin session required' });
  }

  const body = req.body;
  if (!Array.isArray(body) || body.length === 0) {
    return res.status(400).json({ error: 'Invalid payload: Array of products expected' });
  }

  try {
    const result = await saveProducts(body);
    if (!result.savedToDb) {
      return res.status(503).json({ ok: false, savedToDb: false, error: 'Database persistence unavailable: Catalog could not be persisted to central database.' });
    }
    return res.json({ ok: true, savedToDb: true });
  } catch (e) {
    console.error('[API Save Products Error]', e.message);
    res.status(500).json({ error: 'Could not save products' });
  }
});

// WhatsApp Webhook routes
app.use('/api/whatsapp', whatsappRouter);

// Durable inbox retry worker endpoint (triggerable by Vercel Cron, external monitoring, or admin)
app.all('/api/inbox/process', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;

  if (process.env.NODE_ENV === 'production') {
    const isCronAuthorized = authHeader === `Bearer ${cronSecret}`;
    const isAdmin = verifyAdminSession(req);
    if (!isCronAuthorized && !isAdmin) {
      return res.status(401).json({ error: 'Unauthorized: Valid CRON_SECRET or Admin session required' });
    }
  }

  const batchSize = parseInt(req.query.batch || req.body?.batch || '20', 10);

  try {
    const summary = await processInboxQueue({ batchSize });
    return res.json({ ok: true, summary });
  } catch (err) {
    console.error('[Inbox Worker API Error]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default app;
