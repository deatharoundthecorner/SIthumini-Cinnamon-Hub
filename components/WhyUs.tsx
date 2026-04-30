
import React from 'react';
import { Leaf, Award, ShieldCheck, HeartPulse, Sparkles, Phone } from 'lucide-react';

const WhyUs: React.FC = () => {
  const features = [
    {
      icon: <Leaf className="text-[#8B4513]" size={32} />,
      title: "100% Organic",
      description: "Naturally grown without synthetic pesticides in Sri Lanka's premium spice gardens."
    },
    {
      icon: <Award className="text-[#8B4513]" size={32} />,
      title: "Export Grade",
      description: "Packaged according to strict international quality standards for purity and aroma."
    },
    {
      icon: <ShieldCheck className="text-[#8B4513]" size={32} />,
      title: "Purity Promised",
      description: "Zero fillers or artificial coloring. Pure unadulterated Ceylon cinnamon."
    },
    {
      icon: <HeartPulse className="text-[#8B4513]" size={32} />,
      title: "Health Focused",
      description: "Rich in antioxidants and low in coumarin, ensuring maximum safety and benefits."
    }
  ];

  return (
    <div className="container mx-auto px-4">
      <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
        <div>
          <span className="text-[#8B4513] font-bold text-sm tracking-widest uppercase mb-4 block">The Hub Advantage</span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-8 font-serif ladies-tight">Why Our Cinnamon <br /> Stands Alone</h2>
          <p className="text-lg text-gray-600 mb-8 leading-relaxed max-w-lg">
            Sourced directly from farmers in the Southern Province, our operation maintains the highest level of integrity in every batch we produce.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-100 rounded-full shadow-sm text-sm font-semibold">
               <Sparkles size={16} className="text-[#8B4513]" /> Heritage Harvested
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-100 rounded-full shadow-sm text-sm font-semibold">
               <Sparkles size={16} className="text-[#8B4513]" /> Fair Trade Certified
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {features.map((feature, idx) => (
            <div key={idx} className="group p-8 rounded-3xl bg-white border border-gray-100 transition-all hover:bg-[#8B4513] hover:text-white hover:shadow-2xl hover:shadow-[#8B4513]/20">
              <div className="w-16 h-16 bg-[#8B4513]/5 rounded-2xl flex items-center justify-center mb-6 transition-colors group-hover:bg-white/20">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold mb-3 transition-colors">{feature.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed transition-colors group-hover:text-white/80">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
      
      {/* Call to Action Bar */}
      <div className="relative p-12 lg:p-16 rounded-[40px] bg-[#4A3728] text-white overflow-hidden shadow-2xl">
        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="max-w-2xl text-center lg:text-left">
                <h3 className="text-4xl md:text-5xl font-bold mb-6 font-serif">Experience the <span className="text-[#D2691E]">Golden Essence</span> today.</h3>
                <p className="text-white/60 text-lg">Whether for your kitchen, wellness routine, or pet care, we have the perfect cinnamon solution waiting for you.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <a 
                  href="https://wa.me/94785197533" 
                  className="bg-white text-[#4A3728] px-10 py-5 rounded-2xl font-bold text-lg hover:bg-gray-100 transition-all flex items-center justify-center gap-3 shadow-lg"
                >
                  Inquire via WhatsApp <Phone size={18} />
                </a>
                <a
                  href="mailto:chandranirda72@gmail.com"
                  className="bg-[#D2691E] text-white px-10 py-5 rounded-2xl font-bold text-lg hover:bg-[#8B4513] transition-all flex items-center justify-center gap-3 shadow-lg"
                  aria-label="Email us at chandranirda72@gmail.com"
                >
                  Email Us
                </a>
            </div>
        </div>
        {/* Background Accent */}
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-[#8B4513]/20 rounded-full blur-[120px]"></div>
      </div>
    </div>
  );
};

export default WhyUs;
