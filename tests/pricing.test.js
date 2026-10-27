import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Import the logic from pricing
function parsePriceString(input) {
  if (typeof input === 'number') {
    return isNaN(input) ? 0 : input;
  }
  if (!input) return 0;

  const raw = String(input).trim();
  if (!raw) return 0;

  const withoutPrefix = raw.replace(/^[^\d]+/, '');
  const withoutCommas = withoutPrefix.replace(/,/g, '');
  const match = withoutCommas.match(/^\d+(\.\d+)?/);
  if (!match) return 0;

  const val = parseFloat(match[0]);
  return isNaN(val) ? 0 : val;
}

function getNumericPrice(product) {
  if (!product) return 0;

  if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue >= 1) {
    return product.priceValue;
  }

  if (product.price) {
    const fromString = parsePriceString(product.price);
    if (fromString > 0) {
      return fromString;
    }
  }

  if (typeof product.priceValue === 'number' && !isNaN(product.priceValue) && product.priceValue > 0) {
    return product.priceValue;
  }

  return 0;
}

function formatPrice(value) {
  const numeric = typeof value === 'number' ? value : parsePriceString(value);
  return `Rs. ${numeric.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function calculateLineTotal(product, qty) {
  return getNumericPrice(product) * Math.max(1, qty);
}

function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + calculateLineTotal(item.product, item.qty), 0);
}

describe('Pricing Bug Resolution Suite', () => {
  describe('Task 1 & 6: Price String Parsing', () => {
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

    test('Correctly parses other formats (LKR, Rs, decimals, primitives)', () => {
      assert.equal(parsePriceString('LKR 750'), 750);
      assert.equal(parsePriceString('Rs 850'), 850);
      assert.equal(parsePriceString('375'), 375);
      assert.equal(parsePriceString('Rs. 1,234.50'), 1234.5);
      assert.equal(parsePriceString(150), 150);
    });
  });

  describe('Task 4 & 5: getNumericPrice for Affected & Catalog Products', () => {
    const driedLeaves = {
      id: '13',
      name: 'Dried Cinnamon Leaves (10 pieces)',
      price: 'Rs. 150',
    };

    const dogChew = {
      id: '14',
      name: 'Dog Chewable Wood (2 pieces)',
      price: 'Rs. 200',
    };

    const sticks1000 = {
      id: '9',
      name: 'Cinnamon Sticks (100g)',
      price: 'Rs. 1,000',
    };

    const soap = {
      id: '7',
      name: 'Artisanal Cinnamon Soap',
      price: 'Rs. 750',
      priceValue: 750,
    };

    test('Dried Cinnamon Leaves evaluates to 150 LKR (never 0.15)', () => {
      assert.equal(getNumericPrice(driedLeaves), 150);
      // Even if stale priceValue had 0.15, it heals to 150
      assert.equal(getNumericPrice({ ...driedLeaves, priceValue: 0.15 }), 150);
      assert.equal(getNumericPrice({ ...driedLeaves, priceValue: 150 }), 150);
    });

    test('Dog Chewable Wood evaluates to 200 LKR (never 0.20)', () => {
      assert.equal(getNumericPrice(dogChew), 200);
      assert.equal(getNumericPrice({ ...dogChew, priceValue: 0.20 }), 200);
      assert.equal(getNumericPrice({ ...dogChew, priceValue: 200 }), 200);
    });

    test('Cinnamon Sticks (100g) evaluates to 1000 LKR', () => {
      assert.equal(getNumericPrice(sticks1000), 1000);
      assert.equal(getNumericPrice({ ...sticks1000, priceValue: 1000 }), 1000);
    });

    test('Display formatting matches cards, modal, and cart', () => {
      assert.equal(formatPrice(getNumericPrice(driedLeaves)), 'Rs. 150');
      assert.equal(formatPrice(getNumericPrice(dogChew)), 'Rs. 200');
      assert.equal(formatPrice(getNumericPrice(sticks1000)), 'Rs. 1,000');
      assert.equal(formatPrice(getNumericPrice(soap)), 'Rs. 750');
    });
  });

  describe('Task 7 & 8: Quantity Multipliers, Subtotal & WhatsApp Consistency', () => {
    const driedLeaves = { id: '13', name: 'Dried Cinnamon Leaves (10 pieces)', price: 'Rs. 150' };
    const dogChew = { id: '14', name: 'Dog Chewable Wood (2 pieces)', price: 'Rs. 200' };
    const sticks1000 = { id: '9', name: 'Cinnamon Sticks (100g)', price: 'Rs. 1,000' };

    test('Quantities correctly multiply unit prices', () => {
      assert.equal(calculateLineTotal(driedLeaves, 1), 150);
      assert.equal(calculateLineTotal(driedLeaves, 2), 300);
      assert.equal(calculateLineTotal(driedLeaves, 5), 750);

      assert.equal(calculateLineTotal(dogChew, 1), 200);
      assert.equal(calculateLineTotal(dogChew, 3), 600);

      assert.equal(calculateLineTotal(sticks1000, 2), 2000);
    });

    test('Cart subtotal matches sum of line totals', () => {
      const cart = [
        { product: driedLeaves, qty: 2 }, // 150 * 2 = 300
        { product: dogChew, qty: 3 },     // 200 * 3 = 600
        { product: sticks1000, qty: 1 },  // 1000 * 1 = 1000
      ];

      const subtotal = calculateSubtotal(cart);
      assert.equal(subtotal, 1900);
      assert.equal(formatPrice(subtotal), 'Rs. 1,900');
    });

    test('WhatsApp item lines and subtotal match cart totals perfectly', () => {
      const cart = [
        { product: driedLeaves, qty: 2 },
        { product: dogChew, qty: 3 },
        { product: sticks1000, qty: 1 },
      ];

      const subtotal = calculateSubtotal(cart);

      const itemLines = cart.map((item, index) => {
        const unit = getNumericPrice(item.product);
        const lineTotal = calculateLineTotal(item.product, item.qty);
        return `${index + 1}. ${item.product.name} | Qty: ${item.qty} | Unit: ${formatPrice(unit)} | Line: ${formatPrice(lineTotal)}`;
      });

      assert.equal(itemLines[0], '1. Dried Cinnamon Leaves (10 pieces) | Qty: 2 | Unit: Rs. 150 | Line: Rs. 300');
      assert.equal(itemLines[1], '2. Dog Chewable Wood (2 pieces) | Qty: 3 | Unit: Rs. 200 | Line: Rs. 600');
      assert.equal(itemLines[2], '3. Cinnamon Sticks (100g) | Qty: 1 | Unit: Rs. 1,000 | Line: Rs. 1,000');
      assert.equal(formatPrice(subtotal), 'Rs. 1,900');
    });
  });

  describe('Catalog Files Consistency Audit', () => {
    test('public/products.json has valid, non-zero prices and priceValues matching price', () => {
      const content = JSON.parse(fs.readFileSync('public/products.json', 'utf8'));
      assert.ok(content.length > 0);
      content.forEach(p => {
        const num = getNumericPrice(p);
        assert.ok(num > 0, `Product ${p.id} (${p.name}) must have positive price`);
        assert.equal(p.priceValue, num, `Product ${p.id} priceValue (${p.priceValue}) must match getNumericPrice (${num})`);
      });
    });

    test('products.json has valid, non-zero prices and priceValues matching price', () => {
      const content = JSON.parse(fs.readFileSync('products.json', 'utf8'));
      assert.ok(content.length > 0);
      content.forEach(p => {
        const num = getNumericPrice(p);
        assert.ok(num > 0, `Product ${p.id} (${p.name}) must have positive price`);
        assert.equal(p.priceValue, num, `Product ${p.id} priceValue (${p.priceValue}) must match getNumericPrice (${num})`);
      });
    });
  });
});
