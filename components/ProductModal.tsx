import React, { useEffect } from 'react';
import { Product } from '../types';
import { X, Plus, MessageCircle } from 'lucide-react';
import { getNumericPrice, formatPrice } from './Cart';

interface Props {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
}

const ProductModal: React.FC<Props> = ({ product, onClose, onAddToCart }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && product) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const isOutOfStock = product.stock === 0;
  const hasExplicitStock = typeof product.stock === 'number';
  const numericPrice = getNumericPrice(product);

  const openWhatsAppInquiry = () => {
    if (typeof window === 'undefined') return;
    const message = encodeURIComponent(
      `Hello Sithumini Cinnamon Hub! I am inquiring about "${product.name}" (${formatPrice(numericPrice)}). Could you confirm availability?`
    );
    window.open(`https://wa.me/94785197533?text=${message}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      {/* Backdrop click to close */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative bg-white rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl border border-[#8B4513]/10 z-10 flex flex-col md:flex-row max-h-[90vh]">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close product modal"
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm text-gray-400 hover:text-[#4A3728] hover:bg-gray-100 flex items-center justify-center transition-colors shadow-sm"
        >
          <X size={18} />
        </button>

        {/* Product Image */}
        <div className="md:w-1/2 aspect-square md:aspect-auto bg-gray-50 relative overflow-hidden">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <div className="absolute top-4 left-4 flex flex-col gap-1 items-start">
            <span className="bg-white/95 backdrop-blur-sm border border-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-[#8B4513] uppercase tracking-wider shadow-sm">
              {product.category}
            </span>
            {hasExplicitStock && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${
                  isOutOfStock ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {isOutOfStock ? 'Out of Stock' : `${product.stock} available`}
              </span>
            )}
          </div>
        </div>

        {/* Product Details */}
        <div className="md:w-1/2 p-6 sm:p-8 flex flex-col justify-between overflow-y-auto">
          <div>
            <h3 className="text-2xl font-bold font-serif text-[#4A3728] mb-2 leading-tight">
              {product.name}
            </h3>
            <p className="text-gray-600 text-sm leading-relaxed mb-6">
              {product.description}
            </p>
          </div>

          <div className="pt-6 border-t border-gray-100">
            <div className="mb-4">
              <span className="text-2xl font-bold text-[#8B4513]">
                {formatPrice(numericPrice)}
              </span>
              <p className="text-xs text-gray-400 mt-0.5">
                Authentic Ceylon single-origin harvest
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => onAddToCart(product)}
                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold transition-all shadow-md ${
                  isOutOfStock
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-[#8B4513] hover:bg-[#6D360F] text-white'
                }`}
              >
                <Plus size={16} />
                <span>{isOutOfStock ? 'Out of Stock' : 'Add to Cart'}</span>
              </button>

              <button
                type="button"
                onClick={openWhatsAppInquiry}
                className="inline-flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl text-sm font-bold bg-[#FAF9F6] border border-[#8B4513]/20 text-[#4A3728] hover:bg-[#8B4513]/10 transition-colors"
                title="Ask question on WhatsApp"
              >
                <MessageCircle size={16} className="text-emerald-600" />
                <span>Inquire</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
