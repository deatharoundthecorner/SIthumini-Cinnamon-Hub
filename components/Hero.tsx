import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

const Hero: React.FC = () => {
  return (
    <div className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#FAF9F6]">
      {/* Abstract Background Shapes */}
      <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-[#8B4513]/5 rounded-full blur-[100px]"></div>
      <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-[#D2691E]/5 rounded-full blur-[100px]"></div>

      <div className="container mx-auto px-4 pt-32 pb-20 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 text-xs font-bold tracking-[0.2em] uppercase bg-white border border-[#8B4513]/20 text-[#8B4513] rounded-full shadow-sm">
              <Sparkles size={14} /> Premium Ceylon Spice Hub
            </div>
            <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold mb-8 leading-[1.1] font-serif text-[#4A3728]">
              Nature's Finest <br />
              <span className="text-[#8B4513] italic font-normal">Cinnamon</span>
            </h1>
            <p className="text-xl text-gray-600 mb-12 leading-relaxed max-w-xl mx-auto lg:mx-0">
              Sourced from the sun-drenched gardens of Sri Lanka, our cinnamon is more than a spice—it's a legacy of health, aroma, and purity.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <a 
                href="#products" 
                className="bg-[#8B4513] text-white px-10 py-4 rounded-xl text-lg font-bold hover:bg-[#6D360F] shadow-xl shadow-[#8B4513]/20 transition-all transform hover:-translate-y-1 flex items-center justify-center gap-2"
              >
                Explore Products <ArrowRight size={20} />
              </a>
              <a 
                href="#about" 
                className="bg-white text-[#4A3728] border border-gray-200 px-10 py-4 rounded-xl text-lg font-bold hover:bg-gray-50 transition-all text-center"
              >
                Our Heritage
              </a>
            </div>
            
            <div className="mt-16 flex items-center justify-center lg:justify-start gap-8 opacity-60 grayscale">
               <span className="font-bold tracking-widest text-xs uppercase">100% Organic</span>
               <span className="font-bold tracking-widest text-xs uppercase">Sustainably Sourced</span>
               <span className="font-bold tracking-widest text-xs uppercase">Certified Quality</span>
            </div>
          </div>

          <div className="relative lg:h-[700px] flex items-center justify-center">
             <div className="relative w-full aspect-square max-w-md lg:max-w-none">
                {/* Main Image Frame */}
                <div className="absolute inset-4 rounded-[40px] overflow-hidden shadow-2xl z-20 border-[8px] border-white transform rotate-3">
                   <img 
                    src="/images/clear3.png" 
                    alt="Premium Cinnamon Sticks" 
                    className="w-full h-full object-cover"
                   />
                </div>
                {/* Secondary Image Frame */}
                <div className="absolute -bottom-10 -left-10 w-2/3 aspect-square rounded-[30px] overflow-hidden shadow-2xl z-30 border-[8px] border-white transform -rotate-6 hidden sm:block">
                   <img 
                    src="/images/cinnamonbg2.jpeg" 
                    alt="Cinnamon Tea" 
                    className="w-full h-full object-cover"
                   />
                </div>
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#8B4513] rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
