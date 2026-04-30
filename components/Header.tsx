import React, { useState, useEffect } from 'react';
import { Menu, X, Phone, Search } from 'lucide-react';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const Header: React.FC<HeaderProps> = ({ searchQuery, setSearchQuery }) => {
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
    { name: 'Admin', href: '#admin-page' },
  ];

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${
      scrolled
        ? 'bg-white/80 backdrop-blur-md border-b border-[#8B4513]/10 py-3 shadow-sm'
        : 'bg-[rgba(139,69,19,0.08)] py-5'
    }`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          {/* Logo Section */}
          <div className="flex-shrink-0 flex items-center group cursor-pointer">
            <img
              src="/images/Editlogo.png"
              alt="Logo"
              className="w-10 h-10 rounded-full mr-3 shadow-lg shadow-[#8B4513]/20 object-cover bg-white"
            />
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight font-serif text-[#4A3728] leading-none">
                SITHUMINI
              </span>
              <span className="text-[10px] tracking-[0.2em] font-bold text-[#8B4513] uppercase">
                Cinnamon Hub
              </span>
            </div>
          </div>

          {/* Search Bar (Desktop) */}
          <div className="hidden md:flex items-center space-x-4 flex-grow justify-center max-w-2xl px-8">
            <div className="relative w-full group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
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
                placeholder="Search products..."
                className="block w-full bg-[#8B4513]/5 border border-[#8B4513]/10 rounded-full py-2 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B4513]/20 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Navigation Links (Desktop) */}
          <div className="hidden md:block">
            <div className="ml-4 flex items-center space-x-1">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-[#4A3728] hover:text-[#8B4513] px-3 py-2 rounded-full text-sm font-medium transition-all hover:bg-[#8B4513]/5"
                >
                  {link.name}
                </a>
              ))}
              <div className="w-px h-6 bg-gray-200 mx-2"></div>
              <a
                href="https://wa.me/94785197533"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B4513] disabled:pointer-events-none disabled:opacity-50 bg-[#8B4513] text-white shadow hover:bg-[#6D360F] h-10 px-5 py-2 gap-2"
              >
                <Phone size={14} /> WhatsApp
              </a>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center p-2 rounded-lg text-[#4A3728] hover:bg-[#8B4513]/5"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-b border-[#8B4513]/10 shadow-xl overflow-y-auto max-h-screen">
          <div className="px-4 pt-4 pb-8 space-y-4">
            <div className="relative group mb-4">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search products..."
                className="block w-full bg-gray-50 border border-gray-100 rounded-xl py-4 pl-12 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-[#8B4513]/20 transition-all"
              />
            </div>

            <div className="space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="text-[#4A3728] hover:text-[#8B4513] block px-3 py-3 rounded-lg text-base font-medium transition-colors"
                >
                  {link.name}
                </a>
              ))}
            </div>

            <a
              href="https://wa.me/94785197533"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center bg-[#8B4513] text-white py-4 rounded-xl text-base font-medium shadow-lg gap-2"
            >
              <Phone size={18} /> Contact on WhatsApp
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Header;
