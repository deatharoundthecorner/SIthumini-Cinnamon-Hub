
import React, { useState } from 'react';
import { Mail, MessageSquare, Instagram, Facebook, MapPin, ExternalLink } from 'lucide-react';

const shopLocationUrl = 'https://share.google/9U7JzulOBi3N1TRwA';

const Contact: React.FC = () => {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const handleWhatsAppClick = () => {
    const defaultMessage = 'I have an inquiry from the website';
    let whatsappMessage = '';
    
    if (name || message) {
      whatsappMessage = `Name: ${name || 'Not provided'}\nMessage: ${message || defaultMessage}`;
    } else {
      whatsappMessage = defaultMessage;
    }
    
    const url = `https://wa.me/94785197533?text=${encodeURIComponent(whatsappMessage)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="container mx-auto px-4">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-20 items-start">
          <div>
            <span className="text-[#8B4513] font-bold text-sm tracking-widest uppercase mb-4 block">Contact Us</span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-10 font-serif leading-tight">Let's Talk <br /> Spice.</h2>
            
            <div className="grid sm:grid-cols-2 gap-10">
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#8B4513]">WhatsApp & Phone</h4>
                <p className="text-2xl font-bold text-[#4A3728]">+94 78 519 7533</p>
                <p className="text-gray-500 text-sm">Daily from 8 AM to 8 PM</p>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#8B4513]">Shop Location</h4>
                <p className="text-lg font-bold text-[#4A3728]">Southern Province, Matara</p>
                <p className="text-gray-500 text-sm">Sri Lanka</p>
                <a
                  href={shopLocationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#8B4513] hover:underline mt-2"
                >
                  <MapPin size={16} />
                  Open shop location
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>

            <div className="mt-16 space-y-8 pt-10 border-t border-gray-100">
              <div className="flex items-center gap-6">
                <a href="https://www.facebook.com/share/1BPy4CYusB/" target="_blank" rel="noopener noreferrer" className="w-12 h-12 bg-white border border-gray-100 shadow-sm rounded-xl flex items-center justify-center hover:bg-[#8B4513] hover:text-white transition-all cursor-pointer" title="Visit our Facebook page">
                  <Facebook size={20} />
                </a>
                <a href="https://www.instagram.com/sithumini_cinnamon_hub?igsh=NjZscXRwcWRiNWk2" target="_blank" rel="noopener noreferrer" className="w-12 h-12 bg-white border border-gray-100 shadow-sm rounded-xl flex items-center justify-center hover:bg-[#8B4513] hover:text-white transition-all cursor-pointer" title="Visit our Instagram profile">
                  <Instagram size={20} />
                </a>
                <a
                 href="mailto:chandranirda72@gmail.com"
                 className="w-12 h-12 bg-white border border-gray-100 shadow-sm rounded-xl flex items-center justify-center hover:bg-[#8B4513] hover:text-white transition-all cursor-pointer"
                 title="Email chandranirda72@gmail.com"
                >
                 <Mail size={20} />
                </a>
              </div>
               <p className="text-gray-500 italic">"Serving global spice enthusiasts since 2020."</p>
            </div>
          </div>

          <div className="bg-white p-10 lg:p-14 rounded-[40px] shadow-[0_50px_100px_rgba(0,0,0,0.05)] border border-gray-50">
            <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
               <MessageSquare className="text-[#8B4513]" /> Quick Inquiry
            </h3>
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="nameInput" className="text-xs font-bold uppercase tracking-widest text-gray-400">Your Name</label>
                <input 
                    id="nameInput"
                    type="text" 
                    placeholder="Enter your name" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-gray-50 border-none px-6 py-4 rounded-2xl focus:ring-2 focus:ring-[#8B4513]/20 transition-all outline-none"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="messageInput" className="text-xs font-bold uppercase tracking-widest text-gray-400">How can we help?</label>
                <textarea 
                    id="messageInput"
                    placeholder="Tell us about the products you need..." 
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full bg-gray-50 border-none px-6 py-4 rounded-2xl focus:ring-2 focus:ring-[#8B4513]/20 transition-all outline-none"
                ></textarea>
              </div>
              <button 
                onClick={handleWhatsAppClick}
                className="block w-full text-center bg-[#8B4513] text-white font-bold py-5 rounded-2xl hover:bg-[#6D360F] transition-all shadow-xl shadow-[#8B4513]/10 transform active:scale-95"
              >
                Send via WhatsApp
              </button>
              <p className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-6">
                Direct response guaranteed within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
