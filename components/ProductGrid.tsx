import React, { useState, useMemo } from 'react';
import { Product } from '../types';
import { ArrowUpRight, SearchX, SlidersHorizontal, X, Plus } from 'lucide-react';
import { getNumericPrice, formatPrice } from './Cart';

interface Props {
  products: Product[];
  searchQuery: string;
  onAddToCart: (product: Product) => void;
  onOpenModal: (product: Product) => void;
  onClearSearch?: () => void;
}

const ProductGrid: React.FC<Props> = ({
  products = [],
  searchQuery = '',
  onAddToCart,
  onOpenModal,
  onClearSearch,
}) => {
  const [filter, setFilter] = useState<string>('All');
  const [sort, setSort] = useState<string>('none');

  // Dynamically extract real categories from existing catalog
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['All', ...Array.from(set)];
  }, [products]);

  // Filter products by category and search term
  const filtered = useMemo(() => {
    return products.filter((p: Product) => {
      const matchesCategory = filter === 'All' || p.category === filter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [products, filter, searchQuery]);

  // Sort products
  const sorted = useMemo(() => {
    if (sort === 'price-asc') {
      return [...filtered].sort((a, b) => getNumericPrice(a) - getNumericPrice(b));
    }
    if (sort === 'price-desc') {
      return [...filtered].sort((a, b) => getNumericPrice(b) - getNumericPrice(a));
    }
    return filtered;
  }, [filtered, sort]);

  const hasActiveFilters = filter !== 'All' || searchQuery.trim().length > 0 || sort !== 'none';

  const resetFilters = () => {
    setFilter('All');
    setSort('none');
    if (onClearSearch) onClearSearch();
  };

  const openWhatsAppInquiry = (productName: string) => {
    if (typeof window === 'undefined') return;
    const message = encodeURIComponent(
      `Hello Sithumini Cinnamon Hub! I am interested in inquiring about "${productName}". Could you provide more details on availability?`
    );
    window.open(`https://wa.me/94785197533?text=${message}`, '_blank');
  };

  return (
    <div>
      {/* Category Pills & Sort Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
        
        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto cart-scroll pb-1 -mx-1 px-1">
          {categories.map((cat) => {
            const isActive = filter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-[#8B4513] text-white shadow-sm shadow-[#8B4513]/25'
                    : 'bg-[#FAF9F6] text-[#4A3728] hover:bg-[#8B4513]/10 border border-gray-200/80 hover:border-[#8B4513]/30'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Sort and count controls */}
        <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100">
          <div className="text-xs text-gray-400 whitespace-nowrap">
            {sorted.length} {sorted.length === 1 ? 'item' : 'items'}
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-gray-400" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort products by price"
              className="text-xs font-semibold bg-[#FAF9F6] border border-gray-200 text-[#4A3728] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#8B4513]/20 cursor-pointer"
            >
              <option value="none">Featured Order</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
          </div>
        </div>
      </div>

      {/* Filter Status banner if search or category is active */}
      {hasActiveFilters && (
        <div className="flex items-center justify-between gap-3 mb-6 px-4 py-2.5 rounded-xl bg-[#FAF9F6] border border-[#8B4513]/10 text-xs text-[#4A3728]">
          <div className="flex items-center gap-2">
            <span>
              Showing results {filter !== 'All' ? `in "${filter}"` : ''}
              {searchQuery ? ` matching "${searchQuery}"` : ''}
            </span>
          </div>
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1 font-bold text-[#8B4513] hover:underline"
          >
            <X size={13} />
            <span>Clear filters</span>
          </button>
        </div>
      )}

      {/* Product Grid */}
      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          {sorted.map((product: Product) => {
            const isOutOfStock = product.stock === 0;
            const hasExplicitStock = typeof product.stock === 'number';
            const numericPrice = getNumericPrice(product);

            return (
              <div
                key={product.id}
                className="group relative flex flex-col h-full bg-white rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-[0_20px_50px_rgba(139,69,19,0.08)] border border-gray-100"
              >
                {/* Product Image (Consistent 4:5 ratio) */}
                <div
                  className="relative aspect-[4/5] overflow-hidden bg-gray-50 cursor-pointer"
                  onClick={() => onOpenModal(product)}
                >
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />

                  {/* Badges: Category & Genuine Stock */}
                  <div className="absolute top-4 left-4 flex flex-col gap-1 items-start">
                    <span className="bg-white/95 backdrop-blur-sm border border-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-[#8B4513] uppercase tracking-wider shadow-sm">
                      {product.category}
                    </span>

                    {hasExplicitStock && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${
                          isOutOfStock
                            ? 'bg-red-500 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isOutOfStock ? 'Out of Stock' : `${product.stock} available`}
                      </span>
                    )}
                  </div>

                  {/* Direct WhatsApp Quick Contact button */}
                  <button
                    title="Inquire about this product on WhatsApp"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWhatsAppInquiry(product.name);
                    }}
                    className="absolute bottom-5 right-5 w-11 h-11 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 hover:bg-[#8B4513] hover:text-white"
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>

                {/* Card Details */}
                <div className="p-6 flex flex-col flex-grow">
                  <div className="mb-4">
                    <h3
                      className="text-lg font-bold text-[#4A3728] mb-2 group-hover:text-[#8B4513] transition-colors leading-snug cursor-pointer line-clamp-1"
                      onClick={() => onOpenModal(product)}
                    >
                      {product.name}
                    </h3>
                    <p className="text-gray-500 text-xs line-clamp-2 leading-relaxed h-9">
                      {product.description}
                    </p>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-gray-50 pt-4">
                    <div>
                      <span className="text-lg font-bold text-[#4A3728]">
                        {formatPrice(numericPrice)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenModal(product)}
                        className="text-xs font-semibold text-[#8B4513] hover:underline px-2 py-1"
                      >
                        Details
                      </button>

                      <button
                        type="button"
                        disabled={isOutOfStock}
                        onClick={() => onAddToCart(product)}
                        className={`inline-flex items-center gap-1 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all shadow-sm ${
                          isOutOfStock
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                            : 'bg-[#8B4513] hover:bg-[#6D360F] text-white active:scale-95'
                        }`}
                      >
                        <Plus size={13} />
                        <span>{isOutOfStock ? 'Sold Out' : 'Add'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty Results State */
        <div className="text-center py-20 bg-white rounded-[32px] border-2 border-dashed border-gray-200 p-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-[#FAF9F6] rounded-full mb-5 text-[#8B4513]/40">
            <SearchX size={36} />
          </div>
          <h3 className="text-2xl font-bold font-serif text-[#4A3728] mb-2">No matching products found</h3>
          <p className="text-gray-500 max-w-sm mx-auto text-sm leading-relaxed">
            We couldn't find any items matching{' '}
            {searchQuery ? `"${searchQuery}"` : ''}{' '}
            {filter !== 'All' ? `in the ${filter} category` : ''}.
          </p>
          <button
            onClick={resetFilters}
            className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#8B4513] text-white text-xs font-bold hover:bg-[#6D360F] transition-all shadow-sm"
          >
            <span>Reset Search & Filters</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductGrid;
