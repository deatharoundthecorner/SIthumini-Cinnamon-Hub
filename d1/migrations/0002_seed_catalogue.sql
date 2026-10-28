-- =============================================================================
-- SITHUMINI CINNAMON HUB: INITIAL D1 CATALOGUE SEED (FROM public/products.json)
-- Migration: 0002_seed_catalogue.sql
-- Preserves 10 verified storefront products with IDs 9-18 and local LKR prices
-- Conflict-safe: Uses INSERT OR IGNORE to never overwrite existing admin edits
-- =============================================================================

-- Product 9: Cinnamon Sticks (100g)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('9', 'Cinnamon Sticks (100g)', 'Premium whole cinnamon sticks, perfect for cooking, baking, or brewing aromatic teas. Naturally fragrant and rich in flavor.', 'Spices', '/images/42.png', NULL, 1, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_9', '9', 'lk', 'LKR', 1000, 'Rs. 1,000', 1);

-- Product 10: Cinnamon Tea Cut (100g)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('10', 'Cinnamon Tea Cut (100g)', 'Finely cut cinnamon pieces, ideal for making cinnamon tea. Infuses a warm, sweet flavor and aroma.', 'Tea & Infusions', '/images/clear 11.png', NULL, 2, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_10', '10', 'lk', 'LKR', 800, 'Rs. 800', 1);

-- Product 11: Cinnamon Powder (100g)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('11', 'Cinnamon Powder (100g)', 'High-quality ground cinnamon, perfect for cooking, baking, and seasoning. Adds a fragrant, warm touch to recipes.', 'Spices', '/images/clear 14.png', NULL, 3, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_11', '11', 'lk', 'LKR', 700, 'Rs. 700', 1);

-- Product 12: Cinnamon Toothpicks (1 piece)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('12', 'Cinnamon Toothpicks (1 piece)', 'Single cinnamon-infused toothpick. Freshens breath naturally while giving a subtle spicy aroma.', 'Oral Care', '/images/clear 8.png', NULL, 4, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_12', '12', 'lk', 'LKR', 300, 'Rs. 300', 1);

-- Product 13: Dried Cinnamon Leaves (10 pieces)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('13', 'Dried Cinnamon Leaves (10 pieces)', 'Dried cinnamon leaves for culinary use, teas, or herbal remedies. Provides a mild, aromatic flavor.', 'Herbs & Leaves', '/images/cinnamonleaves.png', NULL, 5, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_13', '13', 'lk', 'LKR', 150, 'Rs. 150', 1);

-- Product 14: Dog Chewable Wood (2 pieces)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('14', 'Dog Chewable Wood (2 pieces)', 'Safe, natural chewable wood sticks for dogs. Helps maintain dental hygiene while keeping pets entertained.', 'Pet Care', '/images/clear 12.png', NULL, 6, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_14', '14', 'lk', 'LKR', 200, 'Rs. 200', 1);

-- Product 15: Cinnamon Leaf Oil (10ml)
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('15', 'Cinnamon Leaf Oil (10ml)', 'Pure cinnamon leaf essential oil, perfect for aromatherapy, massage, and wellness applications.', 'Essential Oils', '/images/clear 7.png', NULL, 7, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_15', '15', 'lk', 'LKR', 375, 'Rs. 375', 1);

-- Product 16: Large Cinnamon Soap
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('16', 'Large Cinnamon Soap', 'Handmade large cinnamon soap bar with natural extracts. Leaves skin refreshed, clean, and lightly scented.', 'Personal Care', '/images/soap.webp', NULL, 8, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_16', '16', 'lk', 'LKR', 250, 'Rs. 250', 1);

-- Product 17: Small Cinnamon Soap
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('17', 'Small Cinnamon Soap', 'Compact cinnamon soap bar, ideal for travel or gifting. Gentle cleansing with a natural cinnamon aroma.', 'Personal Care', '/images/37.png', NULL, 9, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_17', '17', 'lk', 'LKR', 125, 'Rs. 125', 1);

-- Product 18: Cinnamon Candle
INSERT OR IGNORE INTO products (id, name, description, category, image_url, stock, sort_order, is_active)
VALUES ('18', 'Cinnamon Candle', 'Hand-poured cinnamon-scented candle. Creates a warm, cozy, and fragrant ambiance in any space.', 'Home Fragrance', '/images/candle.webp', NULL, 10, 1);

INSERT OR IGNORE INTO product_prices (id, product_id, market, currency, price_amount, display_price, is_active)
VALUES ('price_lk_18', '18', 'lk', 'LKR', 150, 'Rs. 150', 1);
