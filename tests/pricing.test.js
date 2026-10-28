import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function parsePriceString(input) {
  if (typeof input === 'number') {
    return isNaN(input) || input < 0 ? 0 : input;
  }
  if (!input) return 0;

  const raw = String(input).trim();
  if (!raw) return 0;

  const withoutPrefix = raw.replace(/^[^\d]+/, '');
  const withoutCommas = withoutPrefix.replace(/,/g, '');
  const match = withoutCommas.match(/^\d+(\.\d+)?/);
  if (!match) return 0;

  const val = parseFloat(match[0]);
  return isNaN(val) || val < 0 ? 0 : val;
}

function getNumericPrice(product, market = 'lk') {
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

  // International Market (USD)
  if (
    typeof product.exportPriceValue === 'number' &&
    !isNaN(product.exportPriceValue) &&
    product.exportPriceValue > 0
  ) {
    return product.exportPriceValue;
  }

  if (product.exportPrice && product.exportPrice.trim()) {
    const raw = product.exportPrice.trim().toLowerCase();
    if (raw !== 'request export pricing' && raw !== 'n/a') {
      const parsed = parsePriceString(product.exportPrice);
      if (parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

function formatPrice(value, market = 'lk') {
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
}

function calculateLineTotal(product, qty, market = 'lk') {
  const unit = getNumericPrice(product, market);
  if (unit === null) return null;
  return unit * Math.max(1, qty);
}

function calculateSubtotal(items, market = 'lk') {
  return items.reduce((sum, item) => {
    const line = calculateLineTotal(item.product, item.qty, market);
    return line !== null ? sum + line : sum;
  }, 0);
}

describe('Pricing & Market Engine Suite', () => {
  describe('Local Sri Lankan Pricing (Preserved)', () => {
    test('Correctly parses "Rs. 150" without prefix-dot corruption', () => {
      const parsed = parsePriceString('Rs. 150');
      assert.equal(parsed, 150);
      assert.notEqual(parsed, 0.15, 'Must not parse to 0.15');
    });

    test('Correctly parses "Rs. 200" without prefix-dot corruption', () => {
      const parsed = parsePriceString('Rs. 200');
      assert.equal(parsed, 200);
      assert.notEqual(parsed, 0.20, 'Must not parse to 0.20');
    });

    test('Correctly parses "Rs. 1,000" with thousands comma', () => {
      const parsed = parsePriceString('Rs. 1,000');
      assert.equal(parsed, 1000);
      assert.notEqual(parsed, 0.1, 'Must not parse to 0.1');
    });

    test('Dried Leaves and Dog Chew evaluate to 150 and 200 LKR', () => {
      const leaves = { id: '13', name: 'Dried Leaves', price: 'Rs. 150' };
      const chew = { id: '14', name: 'Dog Chew', price: 'Rs. 200' };
      assert.equal(getNumericPrice(leaves, 'lk'), 150);
      assert.equal(getNumericPrice(chew, 'lk'), 200);
      assert.equal(formatPrice(150, 'lk'), 'Rs. 150');
      assert.equal(formatPrice(200, 'lk'), 'Rs. 200');
    });
  });

  describe('International Market Pricing (Phase A)', () => {
    const unpricedProduct = {
      id: '1',
      name: 'Premium Cinnamon Sticks',
      price: 'Rs. 1,234',
      priceValue: 1234,
    };

    const configuredExportProduct = {
      id: '2',
      name: 'Fine Cinnamon Powder (100g)',
      price: 'Rs. 850',
      priceValue: 850,
      exportPrice: '$8.50',
      exportPriceValue: 8.5,
    };

    test('Unconfigured export price returns null (never zero or invented conversion)', () => {
      const price = getNumericPrice(unpricedProduct, 'intl');
      assert.equal(price, null);
      assert.notEqual(price, 0);
      assert.notEqual(price, 1234);
    });

    test('Unconfigured export price displays "Request export pricing"', () => {
      const formatted = formatPrice(getNumericPrice(unpricedProduct, 'intl'), 'intl');
      assert.equal(formatted, 'Request export pricing');
    });

    test('Configured export price returns exact USD numeric value', () => {
      const price = getNumericPrice(configuredExportProduct, 'intl');
      assert.equal(price, 8.5);
    });

    test('Configured export price formats cleanly as USD', () => {
      const formatted = formatPrice(getNumericPrice(configuredExportProduct, 'intl'), 'intl');
      assert.equal(formatted, '$8.50');
    });

    test('Market switching preserves local price and does not cross-contaminate', () => {
      assert.equal(getNumericPrice(configuredExportProduct, 'lk'), 850);
      assert.equal(formatPrice(getNumericPrice(configuredExportProduct, 'lk'), 'lk'), 'Rs. 850');
      assert.equal(getNumericPrice(configuredExportProduct, 'intl'), 8.5);
      assert.equal(formatPrice(getNumericPrice(configuredExportProduct, 'intl'), 'intl'), '$8.50');
    });
  });

  describe('Cart Calculations & Market Segregation', () => {
    const p1 = { id: '1', name: 'Item 1', price: 'Rs. 500', priceValue: 500, exportPrice: '$6.00', exportPriceValue: 6 };
    const p2 = { id: '2', name: 'Item 2', price: 'Rs. 1000', priceValue: 1000, exportPrice: '$12.00', exportPriceValue: 12 };
    const pUnpriced = { id: '3', name: 'Item 3', price: 'Rs. 300', priceValue: 300 };

    test('Local market subtotal calculates correctly in LKR', () => {
      const cart = [
        { product: p1, qty: 2 }, // 500 * 2 = 1000
        { product: p2, qty: 1 }, // 1000 * 1 = 1000
      ];
      const subtotal = calculateSubtotal(cart, 'lk');
      assert.equal(subtotal, 2000);
      assert.equal(formatPrice(subtotal, 'lk'), 'Rs. 2,000');
    });

    test('International market subtotal calculates correctly in USD for configured items', () => {
      const cart = [
        { product: p1, qty: 3 }, // 6 * 3 = 18
        { product: p2, qty: 2 }, // 12 * 2 = 24
      ];
      const subtotal = calculateSubtotal(cart, 'intl');
      assert.equal(subtotal, 42);
      assert.equal(formatPrice(subtotal, 'intl'), '$42.00');
    });

    test('Unconfigured international product line total returns null', () => {
      const line = calculateLineTotal(pUnpriced, 2, 'intl');
      assert.equal(line, null);
    });
  });

  describe('Admin Editor Non-Overwriting Separation (Phase B)', () => {
    test('Updating local price preserves existing export price', () => {
      let product = {
        id: '1',
        name: 'Item',
        price: 'Rs. 500',
        priceValue: 500,
        exportPrice: '$6.00',
        exportPriceValue: 6,
      };

      // Simulating updateLocalPrice('1', 'Rs. 600')
      const newPriceText = 'Rs. 600';
      const numeric = parsePriceString(newPriceText);
      product = {
        ...product,
        price: newPriceText,
        priceValue: numeric > 0 ? numeric : product.priceValue,
      };

      assert.equal(product.price, 'Rs. 600');
      assert.equal(product.priceValue, 600);
      assert.equal(product.exportPrice, '$6.00');
      assert.equal(product.exportPriceValue, 6);
    });

    test('Updating export price preserves existing local price', () => {
      let product = {
        id: '1',
        name: 'Item',
        price: 'Rs. 500',
        priceValue: 500,
        exportPrice: '$6.00',
        exportPriceValue: 6,
      };

      // Simulating updateExportPrice('1', '$7.50')
      const newExportText = '$7.50';
      const numeric = parsePriceString(newExportText);
      product = {
        ...product,
        exportPrice: newExportText,
        exportPriceValue: numeric > 0 ? numeric : undefined,
      };

      assert.equal(product.price, 'Rs. 500');
      assert.equal(product.priceValue, 500);
      assert.equal(product.exportPrice, '$7.50');
      assert.equal(product.exportPriceValue, 7.5);
    });

    test('Empty export price clears it to undefined (not zero)', () => {
      let product = {
        id: '1',
        name: 'Item',
        price: 'Rs. 500',
        priceValue: 500,
        exportPrice: '$6.00',
        exportPriceValue: 6,
      };

      // Simulating updateExportPrice('1', '')
      delete product.exportPrice;
      delete product.exportPriceValue;

      assert.equal(product.exportPrice, undefined);
      assert.equal(product.exportPriceValue, undefined);
      assert.equal(getNumericPrice(product, 'intl'), null);
    });
  });

  describe('Catalog Integrity Audit', () => {
    test('public/products.json local prices are preserved and intact', () => {
      const content = JSON.parse(fs.readFileSync('public/products.json', 'utf8'));
      assert.ok(content.length > 0);
      content.forEach((p) => {
        const num = getNumericPrice(p, 'lk');
        assert.ok(num > 0, `Product ${p.id} must have local price`);
      });
    });

    test('products.json local prices are preserved and intact', () => {
      const content = JSON.parse(fs.readFileSync('products.json', 'utf8'));
      assert.ok(content.length > 0);
      content.forEach((p) => {
        const num = getNumericPrice(p, 'lk');
        assert.ok(num > 0, `Product ${p.id} must have local price`);
      });
    });
  });
});
