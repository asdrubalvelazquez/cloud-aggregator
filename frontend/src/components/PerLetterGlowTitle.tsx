"use client";

import { useState, useCallback } from "react";

interface PerLetterGlowTitleProps {
  text: string;
  className?: string;
}

export default function PerLetterGlowTitle({ text, className = "" }: PerLetterGlowTitleProps) {
  // Track which letter is currently hovered
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Store generated colors per letter index
  const [colorsByIndex, setColorsByIndex] = useState<Record<number, string>>({});

  const handleLetterHover = useCallback((index: number) => {
    // Set this letter as active
    setActiveIndex(index);
    
    // Generate random HSL color for this letter on every hover
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 90%, 65%)`;
    
    setColorsByIndex(prev => ({
      ...prev,
      [index]: color,
    }));
  }, []);

  const handleLetterLeave = useCallback(() => {
    // Clear active index when mouse leaves
    setActiveIndex(null);
  }, []);

  return (
    <span className="relative inline-block overflow-visible">
      {/* Base layer: continuous text with animated gradient */}
      <span className={className} style={{ whiteSpace: 'pre' }}>
        {text}
      </span>
      
      {/* Overlay layer: per-letter glow on hover */}
      <span 
        aria-hidden="true" 
        className="absolute inset-0 pointer-events-none"
        style={{ whiteSpace: 'pre' }}
      >
        {text.split('').map((char, index) => {
          const isActive = activeIndex === index;
          const color = colorsByIndex[index];
          
          return (
            <span
              key={index}
              className="inline-block pointer-events-auto transition-[text-shadow] duration-300"
              style={{
                color: 'transparent',
                textShadow: isActive && color 
                  ? `0 0 12px ${color}, 0 0 28px ${color}, 0 0 40px ${color}` 
                  : 'none',
              }}
              onMouseEnter={() => handleLetterHover(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {char === ' ' ? '\u00A0' : char}
            </span>
          );
        })}
      </span>
    </span>
  );
}
