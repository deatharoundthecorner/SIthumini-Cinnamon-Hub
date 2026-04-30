
import React from 'react';

const About: React.FC = () => {
  return (
    <div className="container mx-auto px-4 relative">
      {/* Decorative side image */}
      <img
        src="/images/yep.jpeg"
        alt="Decorative Cinnamon"
        className="absolute top-0 right-0 w-24 h-24 opacity-40 pointer-events-none select-none z-0"
        aria-hidden="true"
      />
      <div className="grid lg:grid-cols-2 gap-20 items-center relative z-10">
        <div className="order-2 lg:order-1 relative group">
          <div className="relative aspect-[3/4] max-w-sm mx-auto">
             <div className="absolute -inset-4 bg-[#8B4513]/10 rounded-[40px] transform translate-x-4 translate-y-4"></div>
             <img 
               src="/images/yep.jpeg"
               alt="Our Heritage" 
               className="relative w-full h-full object-cover rounded-[40px] shadow-2xl transition-transform duration-500 group-hover:-translate-x-2 group-hover:-translate-y-2"
             />
             <div className="absolute -bottom-8 -right-8 bg-white p-8 rounded-[30px] shadow-2xl border border-gray-100 hidden sm:block">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-[#8B4513] font-serif">4</span>
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-xs">YEARS OF<br />EXPERTISE</span>
                </div>
             </div>
          </div>
        </div>

        <div className="order-1 lg:order-2 space-y-10">
          <div>
            <span className="text-[#8B4513] font-bold text-sm tracking-widest uppercase mb-4 block">Our Origin Story</span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-8 font-serif leading-tight">Preserving the <br /> Golden Heritage</h2>
            <p className="text-xl text-gray-600 leading-relaxed">
              Based in the coastal belt of Sri Lanka, Sithumini Cinnamon Hub was born out of a desire to bring genuine, high-potency Ceylon Cinnamon to the global market.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div className="w-10 h-1 bg-[#8B4513]"></div>
                <h4 className="font-bold text-lg">Sustainable Peeling</h4>
                <p className="text-gray-500 text-sm">We use traditional peeling techniques that protect the longevity of our cinnamon trees.</p>
            </div>
            <div className="space-y-4">
                <div className="w-10 h-1 bg-[#8B4513]"></div>
                <h4 className="font-bold text-lg">Direct Sourcing</h4>
                <p className="text-gray-500 text-sm">Eliminating middlemen ensures we pay our farmers more while offering you better prices.</p>
            </div>
          </div>

          <blockquote className="border-l-4 border-[#8B4513] pl-8 py-2 italic text-2xl text-[#4A3728] font-serif leading-relaxed">
            "We believe that the best spice is one that is shared with the same love it was harvested with."
          </blockquote>

          <div>
             <a href="#contact" className="inline-flex items-center gap-3 font-bold text-[#8B4513] group">
                <span className="border-b-2 border-[#8B4513] pb-1">Get in touch with our team</span>
                <span className="transition-transform group-hover:translate-x-2">&rarr;</span>
             </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;
