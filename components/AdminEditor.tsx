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

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return draftProducts;
    return draftProducts.filter(product => {
      return [product.name, product.category, product.id, product.price].join(' ').toLowerCase().includes(q);
    });
  }, [draftProducts, searchQuery]);

  const totalPrice = useMemo(() => draftProducts.reduce((sum, product) => sum + getNumericPrice(product), 0), [draftProducts]);

  const updatePrice = (id: string, priceText: string) => {
    const numeric = parsePriceString(priceText);
    setDraftProducts(prev => prev.map(product => {
      if (product.id !== id) return product;
      return {
        ...product,
        price: priceText,
        priceValue: numeric > 0 ? numeric : product.priceValue,
      };
    }));
  };

  const apply = () => {
    setSaving(true);
    onApply(draftProducts);
    try { localStorage.setItem('productsOverride', JSON.stringify(draftProducts)); } catch (e) { }
    // try save to server
    fetch('/api/products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftProducts)
    }).then(res => {
      if (!res.ok) throw new Error('server save failed');
      alert('Saved to site and server');
    }).catch(() => {
      alert('Saved locally, but server save failed (not authenticated?)');
    }).finally(() => {
      setSaving(false);
    });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(draftProducts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 bg-white rounded-2xl shadow mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h4 className="font-bold text-lg">Quick Price Editor</h4>
          <p className="text-sm text-gray-500">Only change the price field here. Other item details stay fixed.</p>
        </div>
        <div className="text-sm text-gray-500">Total base price: {formatPrice(totalPrice)}</div>
      </div>

      <div className="mb-4">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full border rounded-xl px-4 py-3"
          placeholder="Search item name, category, ID, or price..."
        />
      </div>

      <div className="max-h-[520px] overflow-auto border rounded-xl">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 border-b">
            <tr>
              <th className="text-left p-3">Item</th>
              <th className="text-left p-3 w-32">Price</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(product => (
              <tr key={product.id} className="border-b align-top">
                <td className="p-3 min-w-56">
                  <div className="font-medium text-[#4A3728]">{product.name}</div>
                  <div className="text-xs text-gray-400">ID: {product.id}</div>
                </td>
                <td className="p-3">
                  <input value={product.price} onChange={e => updatePrice(product.id, e.target.value)} className="w-full border rounded px-2 py-1" placeholder="Rs. 300" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={apply} disabled={saving} className="px-4 py-2 bg-[#8B4513] text-white rounded disabled:opacity-60">
          {saving ? 'Saving...' : 'Save to site'}
        </button>
        <button onClick={download} className="px-4 py-2 border rounded">Download JSON</button>
        <button onClick={() => { setDraftProducts(products); setSearchQuery(''); }} className="px-4 py-2 border rounded">Reset Draft</button>
      </div>
    </div>
  );
};

export default AdminEditor;
