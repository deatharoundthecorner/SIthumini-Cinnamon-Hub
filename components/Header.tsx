import React, { useState, useEffect } from 'react';
import { Menu, X, Phone, Search, ShoppingBag } from 'lucide-react';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  cartCount?: number;
  onOpenCart?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  searchQuery,
  setSearchQuery,
  cartCount = 0,
  onOpenCart,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', href: '#home' },
    { name: 'About', href: '#about' },
    { name: 'Products', href: '#products' },
    { name: 'Why Us', href: '#why-us' },
    { name: 'Contact', href: '#contact' },
  ];

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <nav
      className={`fixed w-full z-40 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-md border-b border-[#8B4513]/10 py-3 shadow-sm'
          : 'bg-[#FAF9F6]/90 backdrop-blur-sm py-4 border-b border-[#8B4513]/5'
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          {/* Logo Section */}
          <a href="#home" className="flex-shrink-0 flex items-center group cursor-pointer focus:outline-none">
            <img
              src="/images/Editlogo.png"
              alt="Sithumini Cinnamon Hub Logo"
              className="w-10 h-10 rounded-full mr-3 shadow-md shadow-[#8B4513]/20 object-cover bg-white border border-[#8B4513]/20"
            />
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight font-serif text-[#4A3728] leading-none">
                SITHUMINI
              </span>
              <span className="text-[10px] tracking-[0.2em] font-bold text-[#8B4513] uppercase">
                Cinnamon Hub
              </span>
            </div>
          </a>

          {/* Search Bar (Desktop) */}
          <div className="hidden md:flex items-center space-x-4 flex-grow justify-center max-w-xl px-6">
            <div className="relative w-full group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search
                  size={16}
                  className={`${
                    searchQuery ? 'text-[#8B4513]' : 'text-gray-400'
                  } transition-colors`}
                />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search cinnamon sticks, powder, oils..."
                className="block w-full bg-white border border-[#8B4513]/20 rounded-full py-2 pl-10 pr-4 text-sm text-[#4A3728] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#8B4513]/30 focus:border-[#8B4513] transition-all shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Navigation Links + Cart + WhatsApp (Desktop) */}
          <div className="hidden md:flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-[#4A3728] hover:text-[#8B4513] px-3 py-2 rounded-full text-sm font-medium transition-all hover:bg-[#8B4513]/5"
                >
                  {link.name}
                </a>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-200 mx-1" />

            {/* Cart Trigger Button (Desktop) */}
            <button
              onClick={onOpenCart}
              aria-label={`Open Cart with ${cartCount} items`}
              className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white border border-[#8B4513]/20 hover:border-[#8B4513] text-[#4A3728] hover:text-[#8B4513] text-sm font-medium transition-all shadow-sm hover:shadow"
            >
              <ShoppingBag size={17} className="text-[#8B4513]" />
              <span>Cart</span>
              {cartCount > 0 ? (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-[#8B4513] rounded-full">
                  {cartCount}
                </span>
              ) : null}
            </button>

            {/* Direct WhatsApp Callout */}
            <a
              href="https://wa.me/94785197533"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full text-sm font-semibold transition-all bg-[#8B4513] hover:bg-[#6D360F] text-white shadow-md hover:shadow-lg h-9 px-4 gap-1.5 focus:outline-none focus:ring-2 focus:ring-[#8B4513]/40"
            >
              <Phone size={14} />
              <span>WhatsApp</span>
            </a>
          </div>

          {/* Mobile Actions: Cart Trigger + Mobile Menu Button */}
          <div className="md:hidden flex items-center gap-1.5">
            {/* Mobile Cart Trigger */}
            <button
              onClick={onOpenCart}
              aria-label={`Open Cart (${cartCount} items)`}
              className="relative p-2 rounded-xl text-[#4A3728] hover:bg-[#8B4513]/10 transition-colors focus:outline-none"
            >
              <ShoppingBag size={22} className="text-[#8B4513]" />
              {cartCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-[#8B4513] rounded-full shadow-sm">
                  {cartCount}
                </span>
              )}
            </button>

            {/* Hamburger Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Toggle navigation menu"
              className="inline-flex items-center justify-center p-2 rounded-xl text-[#4A3728] hover:bg-[#8B4513]/10 transition-colors focus:outline-none"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-b border-[#8B4513]/10 shadow-xl overflow-y-auto max-h-[85vh]">
          <div className="px-4 pt-3 pb-6 space-y-3">
            {/* Search Input on Mobile */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search size={16} className="text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search products..."
                className="block w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-sm text-[#4A3728] focus:outline-none focus:ring-2 focus:ring-[#8B4513]/20"
              />
            </div>

            {/* Navigation links */}
            <div className="space-y-1 pt-1">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="text-[#4A3728] hover:text-[#8B4513] block px-3 py-2.5 rounded-lg text-base font-medium transition-colors hover:bg-gray-50"
                >
                  {link.name}
                </a>
              ))}
            </div>

            {/* Mobile Cart Button inside menu */}
            <button
              onClick={() => {
                setIsOpen(false);
                if (onOpenCart) onOpenCart();
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#8B4513]/20 bg-[#FAF9F6] text-[#4A3728] font-semibold text-sm"
            >
              <div className="flex items-center gap-2">
                <ShoppingBag size={18} className="text-[#8B4513]" />
                <span>View Shopping Cart</span>
              </div>
              <span className="bg-[#8B4513] text-white text-xs px-2 py-0.5 rounded-full font-bold">
                {cartCount} items
              </span>
            </button>

            {/* Mobile WhatsApp Button */}
            <a
              href="https://wa.me/94785197533"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center bg-[#8B4513] hover:bg-[#6D360F] text-white py-3.5 rounded-xl text-sm font-semibold shadow-md gap-2"
            >
              <Phone size={16} />
              <span>Contact on WhatsApp</span>
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Header;
