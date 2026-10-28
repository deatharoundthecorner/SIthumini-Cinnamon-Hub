-- ============================================================================
-- SITHUMINI CINNAMON HUB: REVIEWED INITIAL CATALOG IMPORT
-- Source of Truth: public/products.json (Storefront Catalog)
-- Total Verified Products: Exactly 10 items (IDs 9 to 18)
-- Safety: Uses ON CONFLICT DO NOTHING so it cannot overwrite live customized data.
-- ============================================================================

-- 1. Insert Verified Products
INSERT INTO public.products (id, name, description, category, image_url, stock, is_active)
VALUES
  (
    '9',
    'Cinnamon Sticks (100g)',
    'Premium whole cinnamon sticks, perfect for cooking, baking, or brewing aromatic teas. Naturally fragrant and rich in flavor.',
    'Spices',
    '/images/42.png',
    NULL,
    true
  ),
  (
    '10',
    'Cinnamon Tea Cut (100g)',
    'Finely cut cinnamon pieces, ideal for making cinnamon tea. Infuses a warm, sweet flavor and aroma.',
    'Tea & Infusions',
    '/images/clear 11.png',
    NULL,
    true
  ),
  (
    '11',
    'Cinnamon Powder (100g)',
    'High-quality ground cinnamon, perfect for cooking, baking, and seasoning. Adds a fragrant, warm touch to recipes.',
    'Spices',
    '/images/clear 14.png',
    NULL,
    true
  ),
  (
    '12',
    'Cinnamon Toothpicks (1 piece)',
    'Single cinnamon-infused toothpick. Freshens breath naturally while giving a subtle spicy aroma.',
    'Oral Care',
    '/images/clear 8.png',
    NULL,
    true
  ),
  (
    '13',
    'Dried Cinnamon Leaves (10 pieces)',
    'Dried cinnamon leaves for culinary use, teas, or herbal remedies. Provides a mild, aromatic flavor.',
    'Herbs & Leaves',
    '/images/cinnamonleaves.png',
    NULL,
    true
  ),
  (
    '14',
    'Dog Chewable Wood (2 pieces)',
    'Safe, natural chewable wood sticks for dogs. Helps maintain dental hygiene while keeping pets entertained.',
    'Pet Care',
    '/images/clear 12.png',
    NULL,
    true
  ),
  (
    '15',
    'Cinnamon Leaf Oil (10ml)',
    'Pure cinnamon leaf essential oil, perfect for aromatherapy, massage, and wellness applications.',
    'Essential Oils',
    '/images/clear 7.png',
    NULL,
    true
  ),
  (
    '16',
    'Large Cinnamon Soap',
    'Handmade large cinnamon soap bar with natural extracts. Leaves skin refreshed, clean, and lightly scented.',
    'Personal Care',
    '/images/soap.webp',
    NULL,
    true
  ),
  (
    '17',
    'Small Cinnamon Soap',
    'Compact cinnamon soap bar, ideal for travel or gifting. Gentle cleansing with a natural cinnamon aroma.',
    'Personal Care',
    '/images/37.png',
    NULL,
    true
  ),
  (
    '18',
    'Cinnamon Candle',
    'Hand-poured cinnamon-scented candle. Creates a warm, cozy, and fragrant ambiance in any space.',
    'Home Fragrance',
    '/images/candle.webp',
    NULL,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Authoritative Local Sri Lankan (LKR) Prices
INSERT INTO public.product_prices (product_id, market, currency, price_amount, display_price, is_active)
VALUES
  ('9', 'lk', 'LKR', 1000.00, 'Rs. 1,000', true),
  ('10', 'lk', 'LKR', 800.00, 'Rs. 800', true),
  ('11', 'lk', 'LKR', 700.00, 'Rs. 700', true),
  ('12', 'lk', 'LKR', 300.00, 'Rs. 300', true),
  ('13', 'lk', 'LKR', 150.00, 'Rs. 150', true),
  ('14', 'lk', 'LKR', 200.00, 'Rs. 200', true),
  ('15', 'lk', 'LKR', 375.00, 'Rs. 375', true),
  ('16', 'lk', 'LKR', 250.00, 'Rs. 250', true),
  ('17', 'lk', 'LKR', 125.00, 'Rs. 125', true),
  ('18', 'lk', 'LKR', 150.00, 'Rs. 150', true)
ON CONFLICT (product_id, market) DO NOTHING;

-- NOTE: Export (USD) prices are intentionally omitted.
-- Unconfigured export prices are represented as absent rows (triggering custom WhatsApp quotations).
