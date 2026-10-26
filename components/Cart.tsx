import React, { useEffect } from 'react';
import { Product } from '../types';
import { ShoppingBag, X, Plus, Minus, Trash2, ArrowRight, MessageCircle } from 'lucide-react';

export interface CartItem {
  product: Product;
  qty: number;
}

interface CartProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onRemove: (id: string) => void;
  onChangeQty: (id: string, qty: number) => void;
  onCheckout: () => void;
  onClearCart?: () => void;
}

export const getNumericPrice = (product: Product): number => {
  if (typeof product.priceValue === 'number' && !isNaN(product.priceValue)) {
    return product.priceValue;
  }
  const extracted = Number(String(product.price || '').replace(/[^0-9.]/g, ''));
  return isNaN(extracted) ? 0 : extracted;
};

const Cart: React.FC<CartProps> = ({
  isOpen,
  onClose,
  items,
  onRemove,
  onChangeQty,
  onCheckout,
  onClearCart,
}) => {
  // Lock body scroll when mobile cart drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const totalItemCount = items.reduce((sum, item) => sum + item.qty, 0);

  const subtotal = items.reduce((sum, item) => {
    const unitPrice = getNumericPrice(item.product);
    return sum + unitPrice * item.qty;
  }, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="Shopping Cart">
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <aside className="fixed inset-y-0 right-0 max-w-full flex pl-10 w-full sm:w-[440px]">
        <div className="w-full bg-[#FAF9F6] text-[#4A3728] shadow-2xl flex flex-col h-full border-l border-[#8B4513]/10">
          
          {/* Cart Header */}
          <header className="px-6 py-5 bg-white border-b border-[#8B4513]/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#8B4513]/10 flex items-center justify-center text-[#8B4513]">
                <ShoppingBag size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold font-serif text-[#4A3728]">Your Cart</h2>
                <p className="text-xs text-gray-500">
                  {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'} selected
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {items.length > 1 && onClearCart && (
                <button
                  onClick={onClearCart}
                  className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 transition-colors"
                  title="Clear all items"
                >
                  Clear all
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close cart"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-[#4A3728] hover:bg-gray-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </header>

          {/* Cart Body */}
          <div className="flex-1 overflow-y-auto cart-scroll p-4 sm:p-6 space-y-4">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
                <div className="w-20 h-20 rounded-full bg-[#8B4513]/5 flex items-center justify-center text-[#8B4513] mb-4">
                  <ShoppingBag size={36} />
                </div>
                <h3 className="text-lg font-bold text-[#4A3728] mb-1 font-serif">Your cart is empty</h3>
                <p className="text-sm text-gray-500 max-w-xs mb-6">
                  Experience pure Ceylon cinnamon direct from our local orchards in Sri Lanka.
                </p>
                <button
                  onClick={onClose}
                  className="inline-flex items-center gap-2 bg-[#8B4513] hover:bg-[#6D360F] text-white px-6 py-3 rounded-full text-sm font-semibold transition-all shadow-md hover:shadow-lg"
                >
                  <span>Start Shopping</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              items.map((item) => {
                const itemPrice = getNumericPrice(item.product);
                const lineTotal = itemPrice * item.qty;

                return (
                  <article
                    key={item.product.id}
                    className="flex gap-4 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0">
                      <img
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          // Fallback to a placeholder if image fails to load
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-[#4A3728] truncate leading-tight">
                            {item.product.name}
                          </h4>
                          <span className="inline-block mt-0.5 text-[10px] uppercase tracking-wider font-semibold text-[#8B4513] bg-[#8B4513]/10 px-2 py-0.5 rounded-full">
                            {item.product.category}
                          </span>
                        </div>
                        <button
                          onClick={() => onRemove(item.product.id)}
                          aria-label={`Remove ${item.product.name}`}
                          className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                        {/* Touch-Friendly Stepper */}
                        <div className="inline-flex items-center bg-gray-50 rounded-lg border border-gray-200">
                          <button
                            type="button"
                            onClick={() => {
                              if (item.qty > 1) {
                                onChangeQty(item.product.id, item.qty - 1);
                              } else {
                                onRemove(item.product.id);
                              }
                            }}
                            aria-label="Decrease quantity"
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-[#8B4513] hover:bg-gray-100 rounded-l-lg transition-colors focus:outline-none"
                          >
                            <Minus size={14} />
                          </button>
                          
                          <span className="w-8 text-center text-xs font-bold text-[#4A3728] select-none">
                            {item.qty}
                          </span>

                          <button
                            type="button"
                            onClick={() => onChangeQty(item.product.id, item.qty + 1)}
                            aria-label="Increase quantity"
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-[#8B4513] hover:bg-gray-100 rounded-r-lg transition-colors focus:outline-none"
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        {/* Price summary */}
                        <div className="text-right">
                          <div className="text-sm font-bold text-[#8B4513]">
                            Rs. {lineTotal.toLocaleString()}
                          </div>
                          {item.qty > 1 && (
                            <div className="text-[11px] text-gray-400">
                              Rs. {itemPrice.toLocaleString()} each
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Cart Footer */}
          {items.length > 0 && (
            <footer className="p-6 bg-white border-t border-[#8B4513]/10 space-y-4">
              {/* Delivery badge */}
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF9F6] border border-[#8B4513]/10 text-xs text-gray-600">
                <span className="text-base">🚚</span>
                <span>Fast island-wide delivery across Sri Lanka & global air export.</span>
              </div>

              {/* Total breakdown */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Subtotal ({totalItemCount} items)</span>
                  <span>Rs. {subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-[#4A3728]">
                  <span>Estimated Total</span>
                  <span className="text-[#8B4513] text-lg">Rs. {subtotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={onCheckout}
                  className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-white py-3.5 px-4 rounded-xl font-bold shadow-lg shadow-emerald-700/20 hover:shadow-xl transition-all focus:outline-none focus:ring-4 focus:ring-emerald-300"
                >
                  <MessageCircle size={18} />
                  <span>Checkout on WhatsApp</span>
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-2.5 text-center text-xs font-semibold text-gray-500 hover:text-[#4A3728] transition-colors"
                >
                  Continue Browsing
                </button>
              </div>
            </footer>
          )}
        </div>
      </aside>
    </div>
  );
};

export default Cart;
