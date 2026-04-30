import React from 'react';
import { Product } from '../types';

interface CartItem {
  product: Product;
  qty: number;
}

interface Props {
  items: CartItem[];
  onRemove: (id: string) => void;
  onChangeQty: (id: string, qty: number) => void;
  onCheckout: () => void;
}

const Cart: React.FC<Props> = ({ items, onRemove, onChangeQty, onCheckout }) => {
  const total = items.reduce((s, it) => s + ((it.product.priceValue || 0) * it.qty), 0);

  return (
    <div className="fixed right-6 top-20 w-96 bg-white rounded-2xl shadow-lg p-4 z-40">
      <h4 className="font-bold mb-3">Cart</h4>
      {items.length === 0 ? (
        <div className="text-gray-500">Cart is empty</div>
      ) : (
        <div className="flex flex-col gap-3 max-h-80 overflow-auto">
          {items.map(it => (
            <div key={it.product.id} className="flex items-center gap-3">
              <img src={it.product.imageUrl} alt={it.product.name} className="w-12 h-12 object-cover rounded" loading="lazy" />
              <div className="flex-1">
                <div className="font-semibold">{it.product.name}</div>
                <div className="text-sm text-gray-500">{it.product.price}</div>
              </div>
              <input type="number" min={1} value={it.qty} onChange={e => onChangeQty(it.product.id, Math.max(1, Number(e.target.value || 1)))} className="w-16 p-1 border rounded" />
              <button onClick={() => onRemove(it.product.id)} className="text-sm text-red-500">Remove</button>
            </div>
          ))}
          <div className="border-t pt-3 flex items-center justify-between">
            <div className="font-bold">Total</div>
            <div className="font-bold">Rs. {total}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={onCheckout} className="flex-1 bg-[#8B4513] text-white py-2 rounded">Checkout (WhatsApp)</button>
          </div>
        </div>
      )}
    </div>
  );
};

export type { CartItem };
export default Cart;
