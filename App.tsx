import './cinnamonhub.css';

import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import About from './components/About';
import ProductTray from './components/ProductTray';
import ProductGrid from './components/ProductGrid';
import WhyUs from './components/WhyUs';
import Contact from './components/Contact';
import Footer from './components/Footer';
import { Product, Market } from './types';
import ProductModal from './components/ProductModal';
import Cart, { CartItem } from './components/Cart';
import AdminPage from './components/AdminPage';
import FloatingWhatsApp from './components/FloatingWhatsApp';
import { getNumericPrice, formatPrice } from './utils/pricing';

const sanitizeProduct = (p: Product): Product => {
  const localNum = getNumericPrice(p, 'lk');
  const exportNum = getNumericPrice(p, 'intl');

  const sanitized: Product = {
    ...p,
    priceValue: localNum || undefined,
    price: formatPrice(localNum, 'lk'),
  };

  if (exportNum !== null && exportNum > 0) {
    sanitized.exportPriceValue = exportNum;
    sanitized.exportPrice = formatPrice(exportNum, 'intl');
  } else {
    delete sanitized.exportPrice;
    delete sanitized.exportPriceValue;
  }

  return sanitized;
};

const sanitizeProducts = (list: unknown): Product[] => {
  if (!Array.isArray(list)) return [];
  return list.map((item) => sanitizeProduct(item as Product));
};

const App: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [showAdminPage, setShowAdminPage] = useState(false);
  const [market, setMarket] = useState<Market>('lk');

  // Hydrate market preference from localStorage
  useEffect(() => {
    try {
      const savedMarket = localStorage.getItem('selectedMarket') as Market;
      if (savedMarket === 'lk' || savedMarket === 'intl') {
        setMarket(savedMarket);
      }
    } catch (e) {}
  }, []);

  const handleSelectMarket = (newMarket: Market) => {
    setMarket(newMarket);
    try {
      localStorage.setItem('selectedMarket', newMarket);
    } catch (e) {}
  };

  useEffect(() => {
    const loadProducts = async () => {
      try {
        // 1. Prioritize live server / database API first
        try {
          const apiRes = await fetch('/api/products');
          if (apiRes.ok) {
            const data = await apiRes.json();
            if (Array.isArray(data) && data.length > 0) {
              const sanitized = sanitizeProducts(data);
              setProducts(sanitized);
              try {
                localStorage.setItem('cachedProducts', JSON.stringify(sanitized));
                localStorage.removeItem('productsOverride');
              } catch (e) {}
              setLoading(false);
              return;
            }
          } else {
            console.error(`Backend /api/products responded with status ${apiRes.status}`);
          }
        } catch (e) {
          // API unavailable; fall through to cache or bundled file
        }

        // 2. Check offline cache if API was unreachable
        const cached = localStorage.getItem('cachedProducts') || localStorage.getItem('productsOverride');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setProducts(sanitizeProducts(parsed));
              setLoading(false);
              return;
            }
          } catch (e) {}
        }

        // 3. Fallback to bundled static public catalog
        const response = await fetch('./products.json');
        const data = await response.json();
        setProducts(sanitizeProducts(data));
      } catch (error) {
        console.error('Error loading products:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  useEffect(() => {
    // hydrate cart from localStorage and repair any stale item prices
    try {
      const raw = localStorage.getItem('cart');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const repaired = parsed.map((item: any) => ({
            ...item,
            product: sanitizeProduct(item.product),
          }));
          setCartItems(repaired);
        }
      }
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    const checkHash = () => setShowAdminPage(window.location.hash === '#admin-page');
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('cart', JSON.stringify(cartItems)); } catch (e) { }
  }, [cartItems]);

  const handleAddToCart = (product: Product) => {
    // If product is explicitly out of stock, do not add
    if (product.stock === 0) return;

    const sanitized = sanitizeProduct(product);

    setCartItems(prev => {
      const found = prev.find(p => p.product.id === sanitized.id);
      if (found) {
        return prev.map(p => p.product.id === sanitized.id ? { ...p, qty: p.qty + 1 } : p);
      }
      return [{ product: sanitized, qty: 1 }, ...prev];
    });
    // Open cart drawer immediately to provide feedback
    setIsCartOpen(true);
  };

  const handleRemove = (id: string) => {
    setCartItems(prev => prev.filter(p => p.product.id !== id));
  };

  const handleChangeQty = (id: string, qty: number) => {
    if (qty <= 0) {
      handleRemove(id);
      return;
    }
    setCartItems(prev => prev.map(p => p.product.id === id ? { ...p, qty } : p));
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  const handleApplyProducts = (newProducts: Product[]) => {
    const sanitized = sanitizeProducts(newProducts);
    setProducts(sanitized);
    try {
      localStorage.setItem('cachedProducts', JSON.stringify(sanitized));
      localStorage.removeItem('productsOverride');
    } catch (e) {
      console.warn('Could not cache products', e);
    }
  };

  const totalCartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-[#4A3728] overflow-hidden">
      <div
        className="absolute inset-0 z-0 bg-cinnamon-bg pointer-events-none"
        aria-hidden="true"
      />
      <div className="relative z-10">
        {showAdminPage ? (
          <AdminPage products={products} onApply={handleApplyProducts} />
        ) : (
          <>
            <Header
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              cartCount={totalCartCount}
              onOpenCart={() => setIsCartOpen(true)}
              market={market}
              onSelectMarket={handleSelectMarket}
            />
            <main>
              <section id="home">
                <Hero />
              </section>
              <section id="about" className="py-20">
                <About />
              </section>
              <section id="products" className="py-20 bg-white">
                <div className="container mx-auto px-4">
                  <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold mb-4 font-serif">Our Cinnamon Collection</h2>
                    <div className="w-24 h-1 bg-[#8B4513] mx-auto mb-6"></div>
                    <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                      Discover the richness of authentic Sri Lankan cinnamon through our carefully curated range of spices, home goods, and pet care.
                    </p>
                  </div>

                  {loading ? (
                    <div className="flex justify-center py-20">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513]"></div>
                    </div>
                  ) : (
                    <>
                      {/* Product Trays for Curated Collections */}
                      <ProductTray
                        products={products}
                        market={market}
                        onAddToCart={handleAddToCart}
                        onOpenModal={(p) => setModalProduct(p)}
                      />

                      {/* Full Catalog with Category Pills & Sorting */}
                      <ProductGrid
                        products={products}
                        market={market}
                        searchQuery={searchQuery}
                        onAddToCart={handleAddToCart}
                        onOpenModal={(p) => setModalProduct(p)}
                        onClearSearch={() => setSearchQuery('')}
                      />
                    </>
                  )}

                  <ProductModal
                    product={modalProduct}
                    market={market}
                    onClose={() => setModalProduct(null)}
                    onAddToCart={(p) => {
                      handleAddToCart(p);
                      setModalProduct(null);
                    }}
                  />
                </div>
              </section>
              <section id="why-us" className="py-20 bg-[#FAF9F6]">
                <WhyUs />
              </section>
              <section id="contact" className="py-20 bg-white">
                <Contact />
              </section>
            </main>
            <Footer />

            {/* Slide-out Cart Drawer with Structured WhatsApp Checkout & Market Pricing */}
            <Cart
              isOpen={isCartOpen}
              onClose={() => setIsCartOpen(false)}
              items={cartItems}
              market={market}
              onRemove={handleRemove}
              onChangeQty={handleChangeQty}
              onClearCart={handleClearCart}
            />

            {/* Floating WhatsApp Contact Button */}
            <FloatingWhatsApp />
          </>
        )}
      </div>
    </div>
  );
};

export default App;