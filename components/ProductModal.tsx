import React from 'react';
import { Product } from '../types';

interface Props {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
}

const ProductModal: React.FC<Props> = ({ product, onClose, onAddToCart }) => {
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl max-w-3xl w-full mx-4 overflow-hidden">
        <div className="flex gap-6 p-6">
          <div className="w-1/2">
            <img src={product.imageUrl} alt={product.name} className="w-full h-80 object-cover rounded" loading="lazy" />
          </div>
          <div className="w-1/2 flex flex-col">
            <h3 className="text-2xl font-bold mb-2">{product.name}</h3>
            <p className="text-gray-600 mb-4">{product.description}</p>
            <div className="mt-auto flex items-center justify-between">
              <div>
                <div className="text-xl font-bold">{product.price}</div>
                {product.stock !== undefined && <div className="text-sm text-gray-500">Stock: {product.stock}</div>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => onAddToCart(product)} className="bg-[#8B4513] text-white px-4 py-2 rounded">Add to cart</button>
                <button onClick={onClose} className="px-4 py-2 border rounded">Close</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
