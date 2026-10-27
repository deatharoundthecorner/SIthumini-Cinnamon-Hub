import React, { useRef, useState } from 'react';
import { Product } from '../types';
import { ChevronLeft, ChevronRight, Plus, Eye, Sparkles, Leaf } from 'lucide-react';
import { getNumericPrice, formatPrice } from './Cart';

interface ProductTrayProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  onOpenModal: (product: Product) => void;
}

type CollectionKey = 'essentials' | 'natural-living';

interface CollectionConfig {
  id: CollectionKey;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  categories: string[];
}

const COLLECTIONS: CollectionConfig[] = [
  {
    id: 'essentials',
    title: 'Cinnamon Essentials',
    subtitle: 'Pure Ceylon quills, triple-milled powders, teas, and aromatic leaves',
    icon: <Leaf size={16} className="text-[#8B4513]" />,
    categories: ['Spices', 'Leaves & Raw', 'Tea & Infusions', 'Herbs & Leaves'],
  },
  {
    id: 'natural-living',
    title: 'Natural Living & Wellness',
    subtitle: 'Handcrafted soaps, slow-burn candles, toothpicks, and essential oils',
    icon: <Sparkles size={16} className="text-[#8B4513]" />,
    categories: ['Home & Wellness', 'Essential Oils', 'Pet Care', 'Personal Care', 'Oral Care', 'Home Fragrance'],
  },
];

const ProductTray: React.FC<ProductTrayProps> = ({
  products,
  onAddToCart,
  onOpenModal,
}) => {
  const [activeTab, setActiveTab] = useState<CollectionKey>('essentials');
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentCollection = COLLECTIONS.find((c) => c.id === activeTab) || COLLECTIONS[0];

  const trayProducts = products.filter((p) =>
    currentCollection.categories.includes(p.category)
  );

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -340 : 340;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (trayProducts.length === 0) return null;

  return (
    <div className="mb-14 bg-gradient-to-b from-[#FAF9F6] to-white p-6 sm:p-8 rounded-[32px] border border-[#8B4513]/10 shadow-sm">
      {/* Header with collection tabs and navigation */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#8B4513]/10 text-[#8B4513] text-xs font-bold uppercase tracking-wider">
              {currentCollection.icon}
              Curated Collections
            </span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold font-serif text-[#4A3728]">
            {currentCollection.title}
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            {currentCollection.subtitle}
          </p>
        </div>

        {/* Tab switchers + scroll controls */}
        <div className="flex items-center gap-3">
          {/* Collection Pills */}
          <div className="inline-flex p-1 bg-gray-100 rounded-full border border-gray-200">
            {COLLECTIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveTab(c.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  activeTab === c.id
                    ? 'bg-[#8B4513] text-white shadow-sm'
                    : 'text-[#4A3728] hover:text-[#8B4513]'
                }`}
              >
                {c.title}
              </button>
            ))}
          </div>

          {/* Prev / Next controls */}
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => handleScroll('left')}
              aria-label="Scroll tray left"
              className="w-9 h-9 rounded-full bg-white border border-gray-200 hover:border-[#8B4513] text-[#4A3728] hover:text-[#8B4513] flex items-center justify-center transition-all shadow-sm hover:shadow"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => handleScroll('right')}
              aria-label="Scroll tray right"
              className="w-9 h-9 rounded-full bg-white border border-gray-200 hover:border-[#8B4513] text-[#4A3728] hover:text-[#8B4513] flex items-center justify-center transition-all shadow-sm hover:shadow"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontally scrollable product track */}
      <div
        ref={scrollRef}
        className="flex gap-5 overflow-x-auto pb-4 pt-1 snap-x snap-mandatory scroll-smooth cart-scroll -mx-2 px-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {trayProducts.map((product) => {
          const isOutOfStock = product.stock === 0;
          const hasExplicitStock = typeof product.stock === 'number';
          const numericPrice = getNumericPrice(product);

          return (
            <article
              key={product.id}
              className="group snap-start flex-shrink-0 w-[260px] sm:w-[280px] bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col"
            >
              {/* Product Image Container (Consistent 4:5 aspect ratio) */}
              <div
                className="relative aspect-[4/5] bg-gray-50 overflow-hidden cursor-pointer"
                onClick={() => onOpenModal(product)}
              >
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />

                {/* Category tag */}
                <div className="absolute top-3 left-3 flex flex-col gap-1 items-start">
                  <span className="bg-white/95 backdrop-blur-sm border border-gray-100 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-[#8B4513] uppercase tracking-wider shadow-sm">
                    {product.category}
                  </span>

                  {/* Stock status badge (only when genuine stock info is provided) */}
                  {hasExplicitStock && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${
                        isOutOfStock
                          ? 'bg-red-500 text-white'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {isOutOfStock ? 'Out of Stock' : `${product.stock} in stock`}
                    </span>
                  )}
                </div>

                {/* Quick Details Trigger */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenModal(product);
                  }}
                  aria-label={`View details of ${product.name}`}
                  className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm text-[#4A3728] hover:bg-[#8B4513] hover:text-white flex items-center justify-center shadow-md opacity-90 group-hover:opacity-100 transition-all"
                  title="View details"
                >
                  <Eye size={16} />
                </button>
              </div>

              {/* Product Content */}
              <div className="p-4 flex flex-col flex-grow justify-between">
                <div>
                  <h4
                    className="font-bold text-[#4A3728] text-base group-hover:text-[#8B4513] transition-colors leading-snug line-clamp-1 cursor-pointer"
                    onClick={() => onOpenModal(product)}
                  >
                    {product.name}
                  </h4>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1 leading-relaxed h-8">
                    {product.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-base font-bold text-[#4A3728]">
                      {formatPrice(numericPrice)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenModal(product)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:text-[#8B4513] rounded-lg transition-colors"
                    >
                      Details
                    </button>

                    <button
                      type="button"
                      disabled={isOutOfStock}
                      onClick={() => onAddToCart(product)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
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
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default ProductTray;
