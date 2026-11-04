"use client";
import { useState, useEffect } from 'react';
import Image from 'next/image'; // Import Next.js optimized Image component

export default function PublicLoading() {
  const [statusIndex, setStatusIndex] = useState(0);
  
  const dynamicLogs = [
    "SCANNING DISCOVERY PLATFORM...",
    "VERIFYING INSTITUTE RATINGS...",
    "INDEXING LOCATION COACHING CORES...", // Fixed typo from 'COCHING'
    "FILTERING TUITION HUBS...",
    "COMPARING ADMISSION CRITERIA..."
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % dynamicLogs.length);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 font-sans select-none">
      
      {/* 1. Subtle Geolocation Mesh Grid Overlay */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(circle_50%_at_50%_50%,#000_60%,transparent_100%)] opacity-60" 
      />

      {/* 2. Premium Radial Brand Ambient Burst */}
      <div className="absolute h-[500px] w-[500px] rounded-full bg-amber-400/10 blur-[100px] animate-pulse duration-1000" />

      <div className="relative flex flex-col items-center space-y-10 z-10">
        
        {/* 3. The "Find" Radar Assembly */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          
          {/* Outer Pulsing Geolocation Search Ring */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/30 animate-[spin_12s_linear_infinite]" />
          
          {/* High-speed Tracking Radar Sweep Bar */}
          <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-amber-500 animate-[spin_1s_linear_infinite]" />
          
          {/* Counter-rotating Inner Compass Ring */}
          <div className="absolute inset-5 rounded-full border border-dashed border-slate-300 animate-[spin_6s_linear_infinite] [animation-direction:reverse]" />
          
          {/* Core Brand Indicator Frame (Holds your Logo) */}
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 shadow-xl shadow-amber-500/20 rotate-45 transform transition-transform animate-pulse">
            
            {/* The Logo Container (Rotates back so your logo stays perfectly upright) */}
            <div className="-rotate-45 relative w-7 h-7 flex items-center justify-center">
              <Image 
                src="/logo.png"          // <-- Path to your public folder logo asset (SVG or PNG)
                alt="AcademyFind Logo"
                width={28}               // Adjust width and height to fit your logo aspect ratio cleanly
                height={28}
                priority unoptimized
                className="object-contain"
              />
            </div>
            
          </div>

          {/* Satellite Orbit Pings */}
          <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          <div className="absolute bottom-2 right-1 w-1.5 h-1.5 rounded-full bg-slate-800 animate-ping [animation-delay:0.4s]" />
        </div>

        {/* 4. AcademyFind Typography Module */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <div className="flex items-center space-x-1">
            <span className="text-xs font-black tracking-[0.4em] uppercase text-slate-400">
              ACADEMY
            </span>
            <span className="text-xs font-black tracking-[0.4em] uppercase text-amber-500">
              FIND
            </span>
          </div>

          {/* Smooth Dynamic Code Log Loader */}
          <div className="h-6 overflow-hidden px-4">
            <p className="text-sm font-semibold tracking-wide text-slate-700 font-mono transition-all duration-300 animate-bounce">
              {dynamicLogs[statusIndex]}
            </p>
          </div>

          {/* Premium Bottom Linear Progress Track */}
          <div className="relative w-48 h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="absolute top-0 left-0 h-full w-24 bg-gradient-to-r from-amber-400 to-amber-500 rounded-full animate-[shimmer_1.5s_infinite_ease-in-out]" 
                 style={{
                   animationName: 'shimmer',
                   animationIterationCount: 'infinite'
                 }}
            />
          </div>
        </div>

      </div>

      {/* Global CSS Injector for Custom Keyframes inside Tailwind */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
