import { Product } from '../types';

/**
 * Robustly parses a price string into a numeric Sri Lankan Rupee (LKR) amount.
 * 
 * Correctly handles:
 * - "Rs. 150" -> 150 (prevents prefix dot '.' in 'Rs.' from corrupting into .150 / 0.15)
 * - "Rs. 200" -> 200
 * - "Rs. 1,000" -> 1000 (correctly strips commas while preserving whole number)
 * - "Rs. 1,234.50" -> 1234.5
 * - "LKR 750", "Rs 850", "300"
 * - Primitive numbers (returns as-is)
 */
export const parsePriceString = (input: unknown): number => {
  if (typeof input === 'number') {
    return isNaN(input) ? 0 : input;
  }
  if (!input) return 0;

  const raw = String(input).trim();
  if (!raw) return 0;

  // Strip currency prefixes and any non-digit characters before the first digit.
  // This explicitly prevents "Rs." from leaving a leading dot before the price.
  const withoutPrefix = raw.replace(/^[^\d]+/, '');

  // Strip commas (thousands separators)
  const withoutCommas = withoutPrefix.replace(/,/g, '');

  // Extract decimal number
  const match = withoutCommas.match(/^\d+(\.\d+)?/);
  if (!match) return 0;

  const val = parseFloat(match[0]);
  return isNaN(val) ? 0 : val;
};

/**
 * Extracts the single source-of-truth numeric price in LKR for a product.
 * Safeguards against stale 1000x corrupted values (e.g. 0.15 instead of 150).
 */
export const getNumericPrice = (product: Product | null | undefined): number => {
  if (!product) return 0;

  // 1. If explicit numeric priceValue is present and >= 1:
  // (In Sri Lanka, genuine retail product prices are >= 1 LKR)
  if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue >= 1) {
    return product.priceValue;
  }

  // 2. Parse from display price string (e.g. "Rs. 150")
  if (product.price) {
    const fromString = parsePriceString(product.price);
    if (fromString > 0) {
      return fromString;
    }
  }

  // 3. Fallback to positive priceValue if any
  if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue > 0) {
    return product.priceValue;
  }

  return 0;
};

/**
 * Standard Sri Lankan Rupee display formatter: "Rs. 150", "Rs. 1,000", etc.
 */
export const formatPrice = (value: number | string | null | undefined): string => {
  const numeric = typeof value === 'number' ? value : parsePriceString(value);
  return `Rs. ${numeric.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/**
 * Helper to compute line total
 */
export const calculateLineTotal = (product: Product, qty: number): number => {
  return getNumericPrice(product) * Math.max(1, qty);
};

/**
 * Helper to compute order subtotal
 */
export const calculateSubtotal = (items: { product: Product; qty: number }[]): number => {
  return items.reduce((sum, item) => sum + calculateLineTotal(item.product, item.qty), 0);
};
