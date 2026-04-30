import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';

const PORT = process.env.SERVER_PORT || 4000;
const PRODUCTS_PATH = path.resolve(process.cwd(), 'products.json');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  contentSecurityPolicy: false,
}));
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  credentials: true,
}));
app.set('trust proxy', 1);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
  }
}));

const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin20040520';

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const raw = await fs.readFile(PRODUCTS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Could not read products' });
  }
});

app.post('/api/products', async (req, res) => {
  if (!req.session?.authenticated) return res.status(403).json({ error: 'Not authenticated' });
  const body = req.body;
  try {
    await fs.writeFile(PRODUCTS_PATH, JSON.stringify(body, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not save products' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${PORT}`);
});
