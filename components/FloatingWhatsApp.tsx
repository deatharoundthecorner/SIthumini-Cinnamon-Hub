import React, { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

interface FloatingWhatsAppProps {
  phoneNumber?: string;
  defaultMessage?: string;
}

const FloatingWhatsApp: React.FC<FloatingWhatsAppProps> = ({
  phoneNumber = '94785197533',
  defaultMessage = "Hello Sithumini Cinnamon Hub! I'd like to enquire about your pure Ceylon cinnamon products."
}) => {
  const [showTooltip, setShowTooltip] = useState(true);

  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(defaultMessage)}`;

  return (
    <aside 
      aria-label="Direct WhatsApp contact"
      className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end pointer-events-auto"
    >
      {/* Tooltip prompt (dismissible) */}
      {showTooltip && (
        <div className="relative mb-2 hidden sm:flex items-center gap-2 bg-white text-[#4A3728] px-3.5 py-2 rounded-2xl shadow-xl border border-emerald-100 text-xs font-medium animate-bounce duration-1000">
          <span>Need help? Chat with us on WhatsApp!</span>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowTooltip(false);
            }}
            aria-label="Dismiss WhatsApp hint"
            className="text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
          >
            <X size={13} />
          </button>
          <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-white border-r border-b border-emerald-100 rotate-45" />
        </div>
      )}

      {/* Main floating button */}
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with Sithumini Cinnamon Hub on WhatsApp"
        className="group relative flex items-center justify-center w-14 h-14 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 whatsapp-float-pulse focus:outline-none focus:ring-4 focus:ring-emerald-300"
      >
        <MessageCircle size={28} className="transition-transform group-hover:scale-110" />
        
        {/* Mobile quick label badge */}
        <span className="sr-only">Chat on WhatsApp</span>
      </a>
    </aside>
  );
};

export default FloatingWhatsApp;
