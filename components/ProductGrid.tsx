import React, { useState, useMemo } from 'react';
import { Product } from '../types';
import { ArrowUpRight, SearchX } from 'lucide-react';

interface Props {
  products: Product[];
  searchQuery: string;
  onAddToCart: (product: Product) => void;
  onOpenModal: (product: Product) => void;
}

const ProductGrid: React.FC<Props> = ({ products = [], searchQuery = '', onAddToCart, onOpenModal }) => {
  const [filter, setFilter] = useState<string>('All');
  const [sort, setSort] = useState<string>('none');

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((p: Product) => p.category)))], [products]);

  const filtered = products.filter((p: Product) => {
    const matchesCategory = filter === 'All' || p.category === filter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const sorted = useMemo(() => {
    if (sort === 'price-asc') return [...filtered].sort((a, b) => (a.priceValue || 0) - (b.priceValue || 0));
    if (sort === 'price-desc') return [...filtered].sort((a, b) => (b.priceValue || 0) - (a.priceValue || 0));
    return filtered;
  }, [filtered, sort]);

  const openWhatsApp = (productName: string) => {
    if (typeof window === 'undefined') return;
    const message = encodeURIComponent(`Hello! I am interested in buying ${productName}. Could you provide more details?`);
    window.open(`https://wa.me/94785197533?text=${message}`, '_blank');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Category</label>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="p-2 border rounded">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Sort</label>
          <select value={sort} onChange={e => setSort(e.target.value)} className="p-2 border rounded">
            <option value="none">Default</option>
            <option value="price-asc">Price: Low → High</option>
            <option value="price-desc">Price: High → Low</option>
          </select>
        </div>
      </div>

      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          {sorted.map((product: Product) => (
            <div key={product.id} className="group relative flex flex-col h-full bg-white rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-[0_20px_50px_rgba(139,69,19,0.08)] border border-gray-100">
              <div className="relative aspect-[4/5] overflow-hidden bg-gray-100 cursor-pointer" onClick={() => onOpenModal(product)}>
                <img 
                  src={product.imageUrl} 
                  alt={product.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 backdrop-blur-sm border border-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-[#8B4513] uppercase tracking-wider shadow-sm">
                    {product.category}
                  </span>
                </div>
                <button 
                  title="Contact via WhatsApp"
                  onClick={(e) => { e.stopPropagation(); openWhatsApp(product.name); }}
                  className="absolute bottom-6 right-6 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-xl translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:bg-[#8B4513] hover:text-white"
                >
                  <ArrowUpRight size={18} />
                </button>
              </div>
              <div className="p-6 flex flex-col flex-grow">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-[#4A3728] mb-2 group-hover:text-[#8B4513] transition-colors leading-tight">{product.name}</h3>
                  <p className="text-gray-500 text-sm line-clamp-2 leading-relaxed h-10">{product.description}</p>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-gray-50 pt-4">
                  <span className="text-xl font-bold text-[#4A3728]">{product.price}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onAddToCart(product)} className="bg-[#8B4513] text-white px-3 py-1 rounded">Add</button>
                    <button onClick={() => onOpenModal(product)} className="text-[#8B4513] font-bold text-sm flex items-center gap-1">Details</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-24 bg-gray-50 rounded-[40px] border-2 border-dashed border-gray-200">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-6 text-gray-300">
            <SearchX size={40} />
          </div>
          <h3 className="text-2xl font-bold text-[#4A3728] mb-2">No results found</h3>
          <p className="text-gray-400 max-w-xs mx-auto">We couldn't find any products matching "{searchQuery}" in the {filter === 'All' ? '' : filter} category.</p>
          <button onClick={() => { setFilter('All'); }} className="mt-6 text-[#8B4513] font-bold hover:underline">Clear filters</button>
        </div>
      )}
    </div>
  );
};

export default ProductGrid;
