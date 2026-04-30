
import React from 'react';
import { MapPin } from 'lucide-react';

const shopLocationUrl = 'https://share.google/9U7JzulOBi3N1TRwA';

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#4A3728] text-white py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
            <h2 className="text-2xl font-serif font-bold mb-2">SITHUMINI <span className="text-[#D2691E]">CINNAMON HUB</span></h2>
            <p className="text-white/60 text-sm">Finest quality Ceylon cinnamon products since 2021.</p>
            <a
              href={shopLocationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 text-sm text-white/80 hover:text-[#D2691E] transition-colors"
            >
              <MapPin size={16} />
              Shop location on Google Maps
            </a>
          </div>
          
          <div className="flex gap-8">
            <a href="#home" className="hover:text-[#D2691E] transition-colors">Home</a>
            <a href="#about" className="hover:text-[#D2691E] transition-colors">About</a>
            <a href="#products" className="hover:text-[#D2691E] transition-colors">Products</a>
            <a href="#contact" className="hover:text-[#D2691E] transition-colors">Contact</a>
          </div>

          <div className="text-sm text-white/40">
            &copy; {new Date().getFullYear()} Sithumini Cinnamon Hub. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
