import React, { useEffect, useState } from 'react';
import { Product } from '../types';
import {
  ShoppingBag,
  X,
  Plus,
  Minus,
  Trash2,
  ArrowRight,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  MapPin,
  AlertCircle,
  FileText,
} from 'lucide-react';

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
  onCheckout?: () => void;
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
  onClearCart,
}) => {
  // Optional customer checkout details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [showDetailsForm, setShowDetailsForm] = useState(false);

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

  // Check if any cart item is out of stock (stock === 0)
  const hasOutOfStockItem = items.some((item) => item.product.stock === 0);

  // Structured WhatsApp Checkout Handler
  const handleStructuredCheckout = () => {
    if (typeof window === 'undefined' || items.length === 0 || hasOutOfStockItem) return;

    // Generate unique order reference
    const orderRef = `SCH-${Date.now().toString().slice(-6)}`;
    const today = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const itemLines = items
      .map((item, index) => {
        const unit = getNumericPrice(item.product);
        const lineTotal = unit * item.qty;
        return `${index + 1}. ${item.product.name}\n   Qty: ${item.qty} | Unit: Rs. ${unit.toLocaleString()} | Line: Rs. ${lineTotal.toLocaleString()}`;
      })
      .join('\n');

    let customerSection = '';
    const nameStr = customerName.trim();
    const phoneStr = customerPhone.trim();
    const cityStr = deliveryCity.trim();
    const notesStr = deliveryNotes.trim();

    if (nameStr || phoneStr || cityStr || notesStr) {
      customerSection = `\n👤 Customer Details:\n` +
        (nameStr ? `• Name: ${nameStr}\n` : '') +
        (phoneStr ? `• Contact: ${phoneStr}\n` : '') +
        (cityStr ? `• Delivery City/Area: ${cityStr}\n` : '') +
        (notesStr ? `• Notes: ${notesStr}\n` : '');
    }

    const messageText =
      `🌿 SITHUMINI CINNAMON HUB — ORDER REQUEST\n` +
      `Reference: ${orderRef}\n` +
      `Date: ${today}\n` +
      customerSection +
      `\n📦 Requested Products:\n` +
      `${itemLines}\n\n` +
      `📊 Estimated Subtotal: Rs. ${subtotal.toLocaleString()}\n` +
      `🚚 Delivery Fees: To be confirmed based on delivery destination.\n\n` +
      `⚠️ Note: This is an order request. Please confirm product availability and total delivery costs before final confirmation.`;

    const encoded = encodeURIComponent(messageText);
    window.open(`https://wa.me/94785197533?text=${encoded}`, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Shopping Cart"
    >
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <aside className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10 w-full sm:w-[460px]">
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
                <h3 className="text-lg font-bold text-[#4A3728] mb-1 font-serif">
                  Your cart is empty
                </h3>
                <p className="text-sm text-gray-500 max-w-xs mb-6 leading-relaxed">
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
              <>
                {/* Out of stock warning banner if applicable */}
                {hasOutOfStockItem && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    <span>
                      One or more items in your cart are currently out of stock. Please remove them before requesting checkout.
                    </span>
                  </div>
                )}

                {/* List of items */}
                {items.map((item) => {
                  const itemPrice = getNumericPrice(item.product);
                  const lineTotal = itemPrice * item.qty;
                  const isItemOutOfStock = item.product.stock === 0;

                  return (
                    <article
                      key={item.product.id}
                      className={`flex gap-3 sm:gap-4 p-3 sm:p-4 bg-white rounded-2xl border transition-shadow ${
                        isItemOutOfStock ? 'border-red-200 bg-red-50/30' : 'border-gray-100 shadow-sm'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0">
                        <img
                          src={item.product.imageUrl}
                          alt={item.product.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
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
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-[#8B4513] bg-[#8B4513]/10 px-2 py-0.5 rounded-full">
                                {item.product.category}
                              </span>
                              {isItemOutOfStock && (
                                <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                                  Out of Stock
                                </span>
                              )}
                            </div>
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
                          {/* Stepper */}
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
                              className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-gray-600 hover:text-[#8B4513] hover:bg-gray-100 rounded-l-lg transition-colors focus:outline-none"
                            >
                              <Minus size={13} />
                            </button>

                            <span className="w-7 sm:w-8 text-center text-xs font-bold text-[#4A3728] select-none">
                              {item.qty}
                            </span>

                            <button
                              type="button"
                              disabled={isItemOutOfStock}
                              onClick={() => onChangeQty(item.product.id, item.qty + 1)}
                              aria-label="Increase quantity"
                              className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-r-lg transition-colors focus:outline-none ${
                                isItemOutOfStock
                                  ? 'text-gray-300 cursor-not-allowed'
                                  : 'text-gray-600 hover:text-[#8B4513] hover:bg-gray-100'
                              }`}
                            >
                              <Plus size={13} />
                            </button>
                          </div>

                          {/* Line Total */}
                          <div className="text-right">
                            <div className="text-sm font-bold text-[#8B4513]">
                              Rs. {lineTotal.toLocaleString()}
                            </div>
                            {item.qty > 1 && (
                              <div className="text-[10px] text-gray-400">
                                Rs. {itemPrice.toLocaleString()} each
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {/* Optional Customer Delivery Details Form */}
                <div className="mt-4 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDetailsForm(!showDetailsForm)}
                    className="w-full flex items-center justify-between p-3.5 bg-white rounded-xl border border-[#8B4513]/15 text-xs font-bold text-[#4A3728] hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <MapPin size={15} className="text-[#8B4513]" />
                      <span>Add Delivery Details (Optional)</span>
                    </div>
                    {showDetailsForm ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>

                  {showDetailsForm && (
                    <div className="p-4 bg-white rounded-b-xl border-x border-b border-[#8B4513]/15 -mt-1 space-y-3 animate-in fade-in duration-200">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                          Your Name (Optional)
                        </label>
                        <input
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="e.g. Kasun Perera"
                          className="w-full text-xs p-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                          Contact Phone / WhatsApp (Optional)
                        </label>
                        <input
                          type="tel"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="e.g. 077 123 4567"
                          className="w-full text-xs p-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                          Delivery City / District (Optional)
                        </label>
                        <input
                          type="text"
                          value={deliveryCity}
                          onChange={(e) => setDeliveryCity(e.target.value)}
                          placeholder="e.g. Colombo, Kandy, Galle..."
                          className="w-full text-xs p-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                          Delivery Notes / Special Requests (Optional)
                        </label>
                        <textarea
                          rows={2}
                          value={deliveryNotes}
                          onChange={(e) => setDeliveryNotes(e.target.value)}
                          placeholder="e.g. Gift packaging / deliver during business hours"
                          className="w-full text-xs p-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#8B4513]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Cart Footer */}
          {items.length > 0 && (
            <footer className="p-5 sm:p-6 bg-white border-t border-[#8B4513]/10 space-y-3.5">
              {/* Order Confirmation Notice / Disclaimer */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-[#FAF9F6] border border-[#8B4513]/10 text-[11px] text-gray-600 leading-relaxed">
                <FileText size={15} className="text-[#8B4513] flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Order Request Notice:</strong> Submitting prepares a structured order message on WhatsApp. Our business team will verify fresh harvest availability and confirm exact courier fees for your delivery city before final processing.
                </span>
              </div>

              {/* Total breakdown */}
              <div className="space-y-1 pt-1">
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
                  type="button"
                  disabled={hasOutOfStockItem}
                  onClick={handleStructuredCheckout}
                  className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-bold shadow-lg transition-all focus:outline-none ${
                    hasOutOfStockItem
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                      : 'bg-[#25D366] hover:bg-[#20ba59] text-white shadow-emerald-700/20 hover:shadow-xl focus:ring-4 focus:ring-emerald-300'
                  }`}
                >
                  <MessageCircle size={18} />
                  <span>Send Order Request on WhatsApp</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2 text-center text-xs font-semibold text-gray-500 hover:text-[#4A3728] transition-colors"
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
