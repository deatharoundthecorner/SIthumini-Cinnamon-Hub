-- =============================================================================
-- SITHUMINI CINNAMON HUB: CLOUDFLARE D1 (SQLITE) INITIAL SCHEMA MIGRATION
-- Migration: 0001_initial_schema.sql
-- Zero-Budget Architecture with SQLite prepared statements & batches
-- =============================================================================

-- 1. PRODUCTS TABLE
-- Preserves verified storefront catalog; supports administrative hide/show/reorder
-- cost_price is a private internal calculation field, never exposed to public API
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  image_url TEXT NOT NULL DEFAULT '',
  stock INTEGER DEFAULT NULL CHECK (stock IS NULL OR stock >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  cost_price REAL DEFAULT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, sort_order);

-- 2. PRODUCT PRICES TABLE
-- Market segregation: Sri Lanka (lk / LKR) vs International Export (intl / USD)
-- Missing international export prices are simply omitted (never stored as 0.00)
CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK (market IN ('lk', 'intl')),
  currency TEXT NOT NULL CHECK (currency IN ('LKR', 'USD')),
  price_amount REAL NOT NULL CHECK (price_amount > 0),
  display_price TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, market)
);

CREATE INDEX IF NOT EXISTS idx_product_prices_lookup ON product_prices(product_id, market, is_active);

-- 3. ORDERS TABLE
-- Stores customer order requests (not final charged orders; never marked paid automatically)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  market TEXT NOT NULL CHECK (market IN ('lk', 'intl')),
  currency TEXT NOT NULL CHECK (currency IN ('LKR', 'USD')),
  destination_country TEXT,
  delivery_city TEXT,
  customer_notes TEXT,
  subtotal REAL NOT NULL CHECK (subtotal > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'confirmed', 'processing', 'completed', 'cancelled', 'abandoned')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'whatsapp_bot', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);

-- 4. ORDER ITEMS TABLE
-- Authoritative item details and line totals computed at confirmation time
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  line_total REAL NOT NULL CHECK (line_total > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 5. REVIEWS TABLE
-- Public reviews with moderation workflow
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  reviewer_name TEXT NOT NULL,
  reviewer_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status, product_id);

-- 6. WHATSAPP CONVERSATIONS TABLE
-- Durable conversation state machine for Meta Cloud API customer interactions
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  phone_number TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'AWAITING_MARKET',
  session_data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. WHATSAPP INBOX TABLE
-- Durable ingestion queue with message deduplication, leasing, and dead-letter queue
CREATE TABLE IF NOT EXISTS whatsapp_inbox (
  message_id TEXT PRIMARY KEY,
  sender_phone TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  message_text TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at INTEGER DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_queue ON whatsapp_inbox(status, attempts, locked_at);

-- 8. WHATSAPP OUTBOX TABLE
-- Tracks outbound messages to prevent duplicate transmissions on network timeouts
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id TEXT PRIMARY KEY,
  inbox_message_id TEXT REFERENCES whatsapp_inbox(message_id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL,
  sent_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON whatsapp_outbox(status);

-- 9. ADMIN AUDIT LOGS TABLE
-- Records important product and price updates
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);
