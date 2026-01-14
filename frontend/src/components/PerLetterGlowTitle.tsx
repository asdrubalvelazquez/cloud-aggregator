"use client";

import { useState, useCallback } from "react";

interface PerLetterGlowTitleProps {
  text: string;
  className?: string;
}

export default function PerLetterGlowTitle({ text, className = "" }: PerLetterGlowTitleProps) {
  // Track which letter is currently hovered
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Store neon color palette (3 colors) per letter index
  const [paletteByIndex, setPaletteByIndex] = useState<Record<number, [string, string, string]>>({});

  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  const randomNeonPalette = (): [string, string, string] => {
    const h1 = rand(0, 360);
    const h2 = (h1 + rand(50, 150)) % 360;
    const h3 = (h2 + rand(50, 150)) % 360;
    return [
      `hsl(${h1}, 95%, 70%)`,
      `hsl(${h2}, 95%, 70%)`,
      `hsl(${h3}, 95%, 70%)`,
    ];
  };

  const handleLetterHover = useCallback((index: number) => {
    // Set this letter as active
    setActiveIndex(index);
    
    // Generate random neon palette for this letter on every hover
    setPaletteByIndex(prev => ({
      ...prev,
      [index]: randomNeonPalette(),
    }));
  }, []);

  return (
    <span className="relative inline-block overflow-visible">
      {/* Base layer: continuous text with animated gradient */}
      <span className={className} style={{ whiteSpace: 'pre', pointerEvents: 'none' }}>
        {text}
      </span>
      
      {/* Overlay layer: per-letter brutal edge glow on hover */}
      <span 
        aria-hidden="true" 
        className="absolute inset-0"
        style={{ whiteSpace: 'pre', pointerEvents: 'auto' }}
      >
        {text.split('').map((char, index) => {
          const isActive = activeIndex === index;
          const palette = paletteByIndex[index];
          const [c1, c2, c3] = palette || ['transparent', 'transparent', 'transparent'];
          
          return (
            <span
              key={index}
              className="relative inline-block pointer-events-auto"
              onMouseEnter={() => handleLetterHover(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {/* Invisible spacer to maintain layout */}
              <span style={{ color: 'transparent' }}>
                {char === ' ' ? '\u00A0' : char}
              </span>
              
              {/* Stroke layer - crisp outline */}
              <span
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                  opacity: isActive ? 1 : 0,
                  WebkitTextStroke: `2.5px ${c1}`,
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>

              {/* Glow inner - more defined halo */}
              <span
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                  opacity: isActive ? 0.75 : 0,
                  WebkitTextStroke: `2.5px ${c1}`,
                  filter: `drop-shadow(0 0 8px ${c2}) drop-shadow(0 0 14px ${c3}) saturate(1.8)`,
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>

              {/* Glow outer - large aura */}
              <span
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                  opacity: isActive ? 0.55 : 0,
                  WebkitTextStroke: '0px transparent',
                  filter: `drop-shadow(0 0 18px ${c2}) drop-shadow(0 0 30px ${c3}) saturate(1.8)`,
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
