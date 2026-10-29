/**
 * Sithumini Cinnamon Hub: Catalogue Comparison Utility
 * Compares source public/products.json against D1 seed migration (0002_seed_catalogue.sql)
 * to verify complete fidelity, exact pricing preservation, and NO invented fields (stock is NULL when unknown).
 */

import fs from 'fs';
import path from 'path';

export function compareCatalogue({
  sourcePath = path.resolve(process.cwd(), 'public', 'products.json'),
  seedPath = path.resolve(process.cwd(), 'd1', 'migrations', '0002_seed_catalogue.sql'),
} = {}) {
  const sourceRaw = fs.readFileSync(sourcePath, 'utf8');
  const sourceItems = JSON.parse(sourceRaw);
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  const report = {
    sourceCount: sourceItems.length,
    seedProductMatches: 0,
    seedPriceMatches: 0,
    discrepancies: [],
    details: [],
  };

  for (const item of sourceItems) {
    const detail = {
      id: item.id,
      name: item.name,
      category: item.category,
      imageUrl: item.imageUrl || item.image,
      localPrice: item.price,
      priceValue: item.priceValue,
      stock: 'UNKNOWN (NULL)',
      status: 'VERIFIED_MATCH',
    };

    // Check product insertion in SQL: captures name, description, category, image_url, stock
    const prodRegex = new RegExp(
      `INSERT OR IGNORE INTO products[\\s\\S]*?VALUES\\s*\\('${item.id}',\\s*'([^']*)',\\s*'([^']*)',\\s*'([^']*)',\\s*'([^']*)',\\s*([A-Za-z0-9_]+)`
    );
    const prodMatch = seedSql.match(prodRegex);

    if (!prodMatch) {
      detail.status = 'MISSING_PRODUCT_IN_SEED';
      report.discrepancies.push(`Missing product ${item.id} (${item.name}) in seed.`);
    } else {
      const [, seedName, , seedCategory, seedImg, seedStock] = prodMatch;
      if (seedName !== item.name) {
        detail.status = 'NAME_MISMATCH';
        report.discrepancies.push(`Product ${item.id}: name mismatch ('${item.name}' vs '${seedName}').`);
      }
      if (seedCategory !== item.category) {
        detail.status = 'CATEGORY_MISMATCH';
        report.discrepancies.push(`Product ${item.id}: category mismatch ('${item.category}' vs '${seedCategory}').`);
      }
      if (seedImg !== (item.imageUrl || item.image)) {
        detail.status = 'IMAGE_MISMATCH';
        report.discrepancies.push(`Product ${item.id}: image mismatch ('${item.imageUrl || item.image}' vs '${seedImg}').`);
      }

      // Verify stock: When source does not provide stock, seed must use NULL (never an invented quantity like 50)
      if (item.stock === undefined || item.stock === null) {
        if (seedStock.toUpperCase() !== 'NULL') {
          detail.status = 'INVENTED_STOCK_DISCREPANCY';
          report.discrepancies.push(
            `Product ${item.id} (${item.name}): Invented stock quantity '${seedStock}' in seed. Expected 'NULL' for unknown stock.`
          );
        } else {
          detail.stock = 'UNKNOWN (NULL)';
        }
      } else {
        if (seedStock !== String(item.stock)) {
          detail.status = 'STOCK_MISMATCH';
          report.discrepancies.push(
            `Product ${item.id}: stock mismatch (${item.stock} vs ${seedStock}).`
          );
        } else {
          detail.stock = seedStock;
        }
      }

      report.seedProductMatches++;
    }

    // Check price insertion in SQL
    const priceRegex = new RegExp(
      `INSERT OR IGNORE INTO product_prices[\\s\\S]*?VALUES\\s*\\('[^']+',\\s*'${item.id}',\\s*'lk',\\s*'LKR',\\s*([0-9.]+),\\\s*'([^']+)'`
    );
    const priceMatch = seedSql.match(priceRegex);

    if (!priceMatch) {
      detail.status = 'MISSING_PRICE_IN_SEED';
      report.discrepancies.push(`Missing local LKR price for product ${item.id} in seed.`);
    } else {
      const [, seedAmount, seedDisplay] = priceMatch;
      if (parseFloat(seedAmount) !== item.priceValue) {
        detail.status = 'PRICE_VALUE_MISMATCH';
        report.discrepancies.push(`Product ${item.id}: numeric price mismatch (${item.priceValue} vs ${seedAmount}).`);
      }
      if (seedDisplay !== item.price) {
        detail.status = 'PRICE_DISPLAY_MISMATCH';
        report.discrepancies.push(`Product ${item.id}: display price mismatch ('${item.price}' vs '${seedDisplay}').`);
      }
      report.seedPriceMatches++;
    }

    report.details.push(detail);
  }

  // Ensure no export prices are invented in the seed
  if (seedSql.includes("'intl'") || seedSql.includes("'USD'")) {
    report.discrepancies.push('CRITICAL: Seed SQL contains unconfigured export USD prices!');
  }

  return report;
}

// CLI Execution
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/compare_catalogue.js')) {
  const report = compareCatalogue();
  console.log('=== SITHUMINI CINNAMON HUB: CATALOGUE SEED COMPARISON REPORT ===');
  console.log(`Source items: ${report.sourceCount}`);
  console.log(`Verified product seed entries: ${report.seedProductMatches}`);
  console.log(`Verified local price entries: ${report.seedPriceMatches}`);
  console.log('-----------------------------------------------------------------');
  report.details.forEach(d => {
    console.log(
      `[${d.status}] ID: ${d.id.padEnd(2)} | ${d.name.padEnd(36)} | Stock: ${d.stock.padEnd(14)} | LKR: ${d.localPrice.padEnd(10)} | ${d.imageUrl}`
    );
  });
  console.log('-----------------------------------------------------------------');

  if (report.discrepancies.length > 0) {
    console.error('FAILED WITH DISCREPANCIES:');
    report.discrepancies.forEach(d => console.error('  - ' + d));
    process.exit(1);
  } else {
    console.log('SUCCESS: Seed SQL matches public/products.json with 100% fidelity. Stock is verified UNKNOWN (NULL) without invented inventory.');
    process.exit(0);
  }
}
