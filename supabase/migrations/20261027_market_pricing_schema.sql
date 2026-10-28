-- ============================================================================
-- SITHUMINI CINNAMON HUB: COMPREHENSIVE PRODUCTION DATABASE SCHEMA & SECURITY
-- Migration: 20261027_market_pricing_schema.sql
-- Description: DDL, atomic functions, durable inbox, and least-privilege RLS.
-- NOTE: Catalog seed data is strictly isolated in supabase/seed/ to prevent
-- overwriting live production data.
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  stock INTEGER DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. MARKET-SPECIFIC PRICES TABLE
-- Separates local Sri Lankan (LKR) and export international (USD) pricing.
-- Unconfigured export prices are intentionally NOT represented as rows.
CREATE TABLE IF NOT EXISTS public.product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  market VARCHAR(16) NOT NULL CHECK (market IN ('lk', 'intl')),
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('LKR', 'USD')),
  price_amount NUMERIC(10, 2) NOT NULL CHECK (price_amount > 0),
  display_price VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, market)
);

-- 4. ORDERS TABLE (Order Requests)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref VARCHAR(32) NOT NULL UNIQUE,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(64),
  market VARCHAR(16) NOT NULL CHECK (market IN ('lk', 'intl')),
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('LKR', 'USD')),
  destination_country VARCHAR(100),
  delivery_city VARCHAR(100),
  delivery_address TEXT,
  customer_notes TEXT,
  subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  shipping_fee NUMERIC(10, 2) DEFAULT NULL,
  total_amount NUMERIC(10, 2) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'order_request' CHECK (
    status IN ('order_request', 'quoted', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled')
  ),
  source VARCHAR(32) NOT NULL DEFAULT 'web_whatsapp' CHECK (
    source IN ('web_whatsapp', 'whatsapp_bot', 'admin_manual')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ORDER ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
  line_total NUMERIC(10, 2) NOT NULL CHECK (line_total > 0),
  currency VARCHAR(8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(64),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_moderation' CHECK (
    status IN ('pending_moderation', 'approved', 'rejected')
  ),
  source VARCHAR(32) NOT NULL DEFAULT 'whatsapp_bot' CHECK (
    source IN ('web', 'whatsapp_bot')
  ),
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. WHATSAPP CONVERSATIONS TABLE (Durable conversation state)
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  phone_number VARCHAR(64) PRIMARY KEY,
  state VARCHAR(64) NOT NULL DEFAULT 'AWAITING_MARKET',
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. WHATSAPP INBOX TABLE (Durable webhook queue and processing locks)
CREATE TABLE IF NOT EXISTS public.whatsapp_inbox (
  message_id VARCHAR(128) PRIMARY KEY,
  sender_phone VARCHAR(64) NOT NULL,
  raw_payload JSONB NOT NULL,
  message_text TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processing', 'completed', 'failed', 'dead_letter')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 9. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_product_prices_lookup ON public.product_prices(product_id, market);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON public.orders(order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON public.reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbox_status ON public.whatsapp_inbox(status);

-- 10. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbox ENABLE ROW LEVEL SECURITY;

-- Products: Everyone can read active catalog products
CREATE POLICY "Public read access for active products"
  ON public.products FOR SELECT
  USING (is_active = true);

-- Prices: Everyone can read active market prices
CREATE POLICY "Public read access for active prices"
  ON public.product_prices FOR SELECT
  USING (is_active = true);

-- Reviews: Public can view approved reviews only
CREATE POLICY "Public read access for approved reviews"
  ON public.reviews FOR SELECT
  USING (status = 'approved');

-- PRIVILEGE HARDENING:
-- Anonymous clients have ZERO direct write or read access to orders, order items, conversations, or inbox.
-- All privileged writes and moderation are handled server-side via service_role.
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_inbox FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reviews FROM PUBLIC, anon;

-- 11. ATOMIC ORDER CREATION POSTGRESQL FUNCTION
-- Enforces:
-- 1. SECURITY DEFINER with fixed search_path = public, pg_temp.
-- 2. Market/currency consistency (lk -> LKR, intl -> USD).
-- 3. Product existence and authoritative price lookup from product_prices.
-- 4. Server-computed line totals and subtotal verification.
-- 5. Atomic transaction rollback if any step fails.
CREATE OR REPLACE FUNCTION public.create_order_request_atomic(
  p_order_ref VARCHAR,
  p_customer_name VARCHAR,
  p_customer_phone VARCHAR,
  p_market VARCHAR,
  p_currency VARCHAR,
  p_destination_country VARCHAR,
  p_customer_notes TEXT,
  p_subtotal NUMERIC,
  p_source VARCHAR,
  p_items JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_product_id VARCHAR;
  v_quantity INTEGER;
  v_db_price NUMERIC;
  v_product_name VARCHAR;
  v_line_total NUMERIC;
  v_calc_subtotal NUMERIC := 0;
BEGIN
  -- Validate market and currency consistency
  IF p_market = 'lk' AND p_currency <> 'LKR' THEN
    RAISE EXCEPTION 'Currency mismatch: Market "lk" requires "LKR", got "%"', p_currency;
  ELSIF p_market = 'intl' AND p_currency <> 'USD' THEN
    RAISE EXCEPTION 'Currency mismatch: Market "intl" requires "USD", got "%"', p_currency;
  ELSIF p_market NOT IN ('lk', 'intl') THEN
    RAISE EXCEPTION 'Invalid market "%"', p_market;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- Insert order header
  INSERT INTO public.orders (
    order_ref,
    customer_name,
    customer_phone,
    market,
    currency,
    destination_country,
    customer_notes,
    subtotal,
    shipping_fee,
    total_amount,
    status,
    source
  ) VALUES (
    p_order_ref,
    p_customer_name,
    p_customer_phone,
    p_market,
    p_currency,
    p_destination_country,
    p_customer_notes,
    p_subtotal,
    NULL,
    NULL,
    'order_request',
    p_source
  ) RETURNING id INTO v_order_id;

  -- Validate and insert each line item using authoritative database prices
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::INTEGER;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000 THEN
      RAISE EXCEPTION 'Invalid quantity % for product %', v_quantity, v_product_id;
    END IF;

    -- Lookup authoritative product name
    SELECT name INTO v_product_name FROM public.products
    WHERE id = v_product_id AND is_active = true;

    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'Active product % not found in catalog', v_product_id;
    END IF;

    -- Lookup authoritative price for active market
    SELECT price_amount INTO v_db_price FROM public.product_prices
    WHERE product_id = v_product_id AND market = p_market AND is_active = true;

    IF v_db_price IS NULL OR v_db_price <= 0 THEN
      RAISE EXCEPTION 'Product % has no configured price in market %', v_product_name, p_market;
    END IF;

    v_line_total := v_db_price * v_quantity;
    v_calc_subtotal := v_calc_subtotal + v_line_total;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      currency
    ) VALUES (
      v_order_id,
      v_product_id,
      v_product_name,
      v_quantity,
      v_db_price,
      v_line_total,
      p_currency
    );
  END LOOP;

  -- Verify subtotal matches calculated total
  IF p_subtotal <> v_calc_subtotal THEN
    RAISE EXCEPTION 'Subtotal mismatch: client passed %, authoritative total is %', p_subtotal, v_calc_subtotal;
  END IF;

  RETURN v_order_id;
END;
$$;

-- Restrict execution to trusted service_role only
REVOKE ALL ON FUNCTION public.create_order_request_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_request_atomic TO service_role;

-- 12. ATOMIC INBOX LOCK CLAIMING FUNCTION
-- Guarantees atomic message acquisition using FOR UPDATE so concurrent deliveries cannot acquire the same message.
-- Enforces retry policy with exponential backoff, stale-lock recovery, and dead-letter transitions.
CREATE OR REPLACE FUNCTION public.claim_inbox_message_atomic(p_message_id VARCHAR)
RETURNS TABLE (
  claimed BOOLEAN,
  reason VARCHAR,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS
DECLARE
  v_row public.whatsapp_inbox%ROWTYPE;
BEGIN
  -- Lock row exclusively
  SELECT * INTO v_row
  FROM public.whatsapp_inbox
  WHERE message_id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::VARCHAR, 0;
    RETURN;
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_completed'::VARCHAR, v_row.attempts;
    RETURN;
  END IF;

  IF v_row.status = 'dead_letter' OR v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.whatsapp_inbox
    SET status = 'dead_letter'
    WHERE message_id = p_message_id;
    RETURN QUERY SELECT false, 'dead_letter'::VARCHAR, v_row.attempts;
    RETURN;
  END IF;

  -- If currently processing and locked within the last 60 seconds, drop concurrent delivery
  IF v_row.status = 'processing' AND v_row.locked_at > (NOW() - INTERVAL '60 seconds') THEN
    RETURN QUERY SELECT false, 'concurrent_lock_active'::VARCHAR, v_row.attempts;
    RETURN;
  END IF;

  -- Exponential retry backoff for failed messages: 10s * 2^(attempts-1)
  IF v_row.status = 'failed' AND v_row.locked_at > (NOW() - (INTERVAL '10 seconds' * POWER(2, LEAST(v_row.attempts - 1, 6)))) THEN
    RETURN QUERY SELECT false, 'backoff_active'::VARCHAR, v_row.attempts;
    RETURN;
  END IF;

  -- Acquire lock
  UPDATE public.whatsapp_inbox
  SET status = 'processing',
      attempts = v_row.attempts + 1,
      locked_at = NOW()
  WHERE message_id = p_message_id;

  RETURN QUERY SELECT true, 'lock_acquired'::VARCHAR, v_row.attempts + 1;
END;
;

REVOKE ALL ON FUNCTION public.claim_inbox_message_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbox_message_atomic TO service_role;

-- 13. RETRIEVE PENDING AND RETRY-ELIGIBLE INBOX MESSAGES
CREATE OR REPLACE FUNCTION public.get_pending_inbox_messages(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  message_id VARCHAR,
  sender_phone VARCHAR,
  message_text TEXT,
  attempts INTEGER,
  status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS
BEGIN
  RETURN QUERY
  SELECT
    i.message_id,
    i.sender_phone,
    i.message_text,
    i.attempts,
    i.status
  FROM public.whatsapp_inbox i
  WHERE (
    i.status = 'received'
    OR (
      i.status = 'failed'
      AND i.attempts < i.max_attempts
      AND i.locked_at <= (NOW() - (INTERVAL '10 seconds' * POWER(2, LEAST(i.attempts - 1, 6))))
    )
    OR (
      i.status = 'processing'
      AND i.locked_at <= (NOW() - INTERVAL '120 seconds')
    )
  )
  ORDER BY i.created_at ASC
  LIMIT p_limit;
END;
;

REVOKE ALL ON FUNCTION public.get_pending_inbox_messages FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_inbox_messages TO service_role;

-- 14. ATOMIC PRODUCT CATALOG UPDATE FUNCTION
-- Strictly validates ID, Name, and positive local LKR price before making any changes.
-- Rolls back the entire transaction if any product fails validation.
CREATE OR REPLACE FUNCTION public.save_products_atomic(p_products JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS
DECLARE
  v_prod JSONB;
  v_id VARCHAR;
  v_name VARCHAR;
  v_desc TEXT;
  v_cat VARCHAR;
  v_img VARCHAR;
  v_stock INTEGER;
  v_lk_price NUMERIC;
  v_lk_display VARCHAR;
  v_intl_price NUMERIC;
  v_intl_display VARCHAR;
BEGIN
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    v_id := v_prod->>'id';
    v_name := v_prod->>'name';
    v_desc := COALESCE(v_prod->>'description', '');
    v_cat := COALESCE(v_prod->>'category', 'General');
    v_img := COALESCE(v_prod->>'imageUrl', '');
    v_stock := (v_prod->>'stock')::INTEGER;

    v_lk_price := (v_prod->>'priceValue')::NUMERIC;
    v_lk_display := v_prod->>'price';

    v_intl_price := (v_prod->>'exportPriceValue')::NUMERIC;
    v_intl_display := v_prod->>'exportPrice';

    -- Validation: ID, Name, and Local Price are strictly required
    IF v_id IS NULL OR TRIM(v_id) = '' THEN
      RAISE EXCEPTION 'Product update rejected: Missing product ID.';
    END IF;

    IF v_name IS NULL OR TRIM(v_name) = '' THEN
      RAISE EXCEPTION 'Product update rejected for ID %: Missing product name.', v_id;
    END IF;

    IF v_lk_price IS NULL OR v_lk_price <= 0 THEN
      RAISE EXCEPTION 'Product update rejected for ID % (%): Local LKR price must be a strictly positive number.', v_id, v_name;
    END IF;

    IF v_lk_display IS NULL OR TRIM(v_lk_display) = '' THEN
      v_lk_display := 'Rs. ' || v_lk_price::TEXT;
    END IF;

    -- Upsert product
    INSERT INTO public.products (id, name, description, category, image_url, stock, is_active, updated_at)
    VALUES (v_id, v_name, v_desc, v_cat, v_img, v_stock, true, NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      image_url = EXCLUDED.image_url,
      stock = EXCLUDED.stock,
      is_active = true,
      updated_at = NOW();

    -- Upsert local price
    INSERT INTO public.product_prices (product_id, market, currency, price_amount, display_price, is_active, updated_at)
    VALUES (v_id, 'lk', 'LKR', v_lk_price, v_lk_display, true, NOW())
    ON CONFLICT (product_id, market) DO UPDATE SET
      price_amount = EXCLUDED.price_amount,
      display_price = EXCLUDED.display_price,
      is_active = true,
      updated_at = NOW();

    -- Upsert or delete export price (strictly unconfigured if NULL or <= 0)
    IF v_intl_price IS NOT NULL AND v_intl_price > 0 THEN
      INSERT INTO public.product_prices (product_id, market, currency, price_amount, display_price, is_active, updated_at)
      VALUES (v_id, 'intl', 'USD', v_intl_price, v_intl_display, true, NOW())
      ON CONFLICT (product_id, market) DO UPDATE SET
        price_amount = EXCLUDED.price_amount,
        display_price = EXCLUDED.display_price,
        is_active = true,
        updated_at = NOW();
    ELSE
      DELETE FROM public.product_prices WHERE product_id = v_id AND market = 'intl';
    END IF;
  END LOOP;
END;
;

REVOKE ALL ON FUNCTION public.save_products_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_products_atomic TO service_role;
