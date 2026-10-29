import React, { useMemo, useState } from 'react';
import { Product } from '../types';
import { getNumericPrice, parsePriceString, formatPrice } from '../utils/pricing';

interface Props {
  products: Product[];
  onApply: (products: Product[]) => void;
}

const AdminEditor: React.FC<Props> = ({ products, onApply }) => {
  const [draftProducts, setDraftProducts] = useState<Product[]>(products);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return draftProducts;
    return draftProducts.filter((product) => {
      return [
        product.name,
        product.category,
        product.id,
        product.price,
        product.exportPrice || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [draftProducts, searchQuery]);

  const localPriceSum = useMemo(
    () => draftProducts.reduce((sum, product) => sum + (getNumericPrice(product, 'lk') || 0), 0),
    [draftProducts]
  );

  const exportConfiguredCount = useMemo(
    () => draftProducts.filter((p) => getNumericPrice(p, 'intl') !== null).length,
    [draftProducts]
  );

  // Update local price (LKR) without overwriting export price
  const updateLocalPrice = (id: string, priceText: string) => {
    if (priceText.includes('-')) {
      setValidationError('Prices cannot be negative amounts.');
      return;
    }
    setValidationError(null);

    const numeric = parsePriceString(priceText);
    if (numeric < 0) {
      setValidationError('Local price must be a non-negative amount.');
      return;
    }

    setDraftProducts((prev) =>
      prev.map((product) => {
        if (product.id !== id) return product;
        return {
          ...product,
          price: priceText,
          priceValue: numeric > 0 ? numeric : undefined,
        };
      })
    );
  };

  // Update export price (USD) without overwriting local price
  const updateExportPrice = (id: string, priceText: string) => {
    if (priceText.includes('-')) {
      setValidationError('Prices cannot be negative amounts.');
      return;
    }
    setValidationError(null);

    const trimmed = priceText.trim();
    if (!trimmed) {
      // Empty string means unconfigured (represented as missing, not zero)
      setDraftProducts((prev) =>
        prev.map((product) => {
          if (product.id !== id) return product;
          const updated = { ...product };
          delete updated.exportPrice;
          delete updated.exportPriceValue;
          return updated;
        })
      );
      return;
    }

    const numeric = parsePriceString(trimmed);
    if (numeric < 0) {
      setValidationError('Export price must be a non-negative amount.');
      return;
    }

    setDraftProducts((prev) =>
      prev.map((product) => {
        if (product.id !== id) return product;
        return {
          ...product,
          exportPrice: trimmed.startsWith('$') ? trimmed : `$${trimmed}`,
          exportPriceValue: numeric > 0 ? numeric : undefined,
        };
      })
    );
  };

  const apply = async () => {
    setSaving(true);
    setSaveStatus(null);
    setValidationError(null);

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftProducts),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.savedToDb) {
        throw new Error(data.error || 'Server save failed: Database write could not be confirmed.');
      }

      // Confirmed database save: update storefront and persistent override
      onApply(draftProducts);
      try {
        localStorage.setItem('productsOverride', JSON.stringify(draftProducts));
      } catch (e) {}

      setSaveStatus({
        type: 'success',
        message: 'Saved successfully to central database and storefront.',
      });
    } catch (err) {
      // Preserve user edits in draft state and show truthful error
      setSaveStatus({
        type: 'error',
        message: 'Database save failed: ' + (err && err.message ? err.message : 'Server not reachable') + '. Your unsaved edits have been preserved in this editor.',
      });
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(draftProducts, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 bg-white rounded-3xl shadow-sm border border-[#8B4513]/10 mt-6 overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-100">
        <div>
          <h4 className="font-bold text-xl font-serif text-[#4A3728]">
            Market Pricing Management Editor
          </h4>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            Independently manage local Sri Lankan Rupee (LKR) and export international (USD) pricing.
            Leave export price blank for items requiring custom WhatsApp quotations.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-xs font-semibold">
          <div className="bg-[#FAF9F6] border border-[#8B4513]/15 px-3 py-2 rounded-xl text-[#4A3728]">
            Local Base Total: <span className="font-bold text-[#8B4513]">{formatPrice(localPriceSum, 'lk')}</span>
          </div>
          <div className="bg-[#FAF9F6] border border-[#8B4513]/15 px-3 py-2 rounded-xl text-[#4A3728]">
            Export Configured:{' '}
            <span className="font-bold text-[#8B4513]">
              {exportConfiguredCount} / {draftProducts.length} items
            </span>
          </div>
        </div>
      </div>

      {validationError && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
          {validationError}
        </div>
      )}

      {saveStatus && (
        <div className={'mb-4 p-3.5 rounded-xl text-xs font-semibold border ' + (saveStatus.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800')}>
          {saveStatus.message}
        </div>
      )}

      <div className="mb-4">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-xs text-[#4A3728] focus:outline-none focus:ring-2 focus:ring-[#8B4513]/20"
          placeholder="Search products by title, category, price, or ID..."
        />
      </div>

      <div className="max-h-[520px] overflow-auto border border-gray-100 rounded-2xl">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#FAF9F6] border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-left p-3.5">Product</th>
              <th className="text-left p-3.5 w-48">Local Price (LKR - Rs.)</th>
              <th className="text-left p-3.5 w-48">Export Price (USD - $)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredProducts.map((product) => {
              const exportVal = product.exportPrice || (product.exportPriceValue ? `$${product.exportPriceValue}` : '');
              return (
                <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="p-3.5 min-w-[220px]">
                    <div className="font-bold text-[#4A3728] text-sm">{product.name}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">ID: {product.id}</span>
                      <span>{product.category}</span>
                    </div>
                  </td>

                  <td className="p-3.5">
                    <label className="block text-[10px] text-gray-400 mb-1 font-semibold">
                      Sri Lanka (LKR)
                    </label>
                    <input
                      type="text"
                      value={product.price || ''}
                      onChange={(e) => updateLocalPrice(product.id, e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                      placeholder="e.g. Rs. 150"
                    />
                  </td>

                  <td className="p-3.5">
                    <label className="block text-[10px] text-gray-400 mb-1 font-semibold">
                      International (USD)
                    </label>
                    <input
                      type="text"
                      value={exportVal}
                      onChange={(e) => updateExportPrice(product.id, e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                      placeholder="e.g. $12.00 (or blank)"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-gray-100">
        <div className="text-xs text-gray-400">
          Showing {filteredProducts.length} of {draftProducts.length} catalog items
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={saving}
            className="px-5 py-2.5 bg-[#8B4513] hover:bg-[#6D360F] text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-60"
          >
            {saving ? 'Applying...' : 'Apply to Storefront'}
          </button>
          <button
            type="button"
            onClick={download}
            className="px-4 py-2.5 border border-gray-200 hover:border-gray-300 text-gray-700 rounded-xl text-xs font-semibold transition-all bg-white"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftProducts(products);
              setSearchQuery('');
              setValidationError(null);
            }}
            className="px-4 py-2.5 text-gray-500 hover:text-gray-700 text-xs font-semibold"
          >
            Reset Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminEditor;