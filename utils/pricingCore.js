/**
 * Shared Core Pricing Utility (ESM JavaScript)
 * Authoritative pricing logic for both Frontend and Backend
 */

export const parsePriceString = (input) => {
  if (typeof input === 'number') {
    return isNaN(input) || input < 0 ? 0 : input;
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
  return isNaN(val) || val < 0 ? 0 : val;
};

export const getNumericPrice = (product, market = 'lk') => {
  if (!product) return market === 'intl' ? null : 0;

  if (market === 'lk') {
    if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue >= 1) {
      return product.priceValue;
    }
    if (product.price) {
      const fromString = parsePriceString(product.price);
      if (fromString > 0) return fromString;
    }
    if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue > 0) {
      return product.priceValue;
    }
    return 0;
  }

  // International Export Market (USD)
  if (
    typeof product.exportPriceValue === 'number' &&
    !isNaN(product.exportPriceValue) &&
    product.exportPriceValue > 0
  ) {
    return product.exportPriceValue;
  }

  if (product.exportPrice && String(product.exportPrice).trim()) {
    const raw = String(product.exportPrice).trim().toLowerCase();
    if (raw !== 'request export pricing' && raw !== 'n/a') {
      const parsed = parsePriceString(product.exportPrice);
      if (parsed > 0) return parsed;
    }
  }

  return null;
};

export const hasPriceForMarket = (product, market = 'lk') => {
  if (!product) return false;
  const price = getNumericPrice(product, market);
  return price !== null && price > 0;
};

export const formatPrice = (value, market = 'lk') => {
  if (market === 'lk') {
    const numeric = typeof value === 'number' ? value : parsePriceString(value);
    return `Rs. ${numeric.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }

  if (value === null || value === undefined) {
    return 'Request export pricing';
  }

  const numeric = typeof value === 'number' ? value : parsePriceString(value);
  if (numeric <= 0) {
    return 'Request export pricing';
  }

  return `$${numeric.toFixed(2)}`;
};

export const getMarketCurrency = (market) => {
  if (market === 'intl') {
    return {
      code: 'USD',
      symbol: '$',
      label: 'International (USD)',
      regionName: 'International',
    };
  }
  return {
    code: 'LKR',
    symbol: 'Rs.',
    label: 'Sri Lanka (LKR)',
    regionName: 'Sri Lanka',
  };
};

export const calculateLineTotal = (product, qty, market = 'lk') => {
  const unit = getNumericPrice(product, market);
  if (unit === null) return null;
  return unit * Math.max(1, qty);
};

export const calculateSubtotal = (items, market = 'lk') => {
  return items.reduce((sum, item) => {
    const lineTotal = calculateLineTotal(item.product, item.qty, market);
    return lineTotal !== null ? sum + lineTotal : sum;
  }, 0);
};
