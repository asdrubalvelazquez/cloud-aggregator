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
      <span className={className} style={{ whiteSpace: 'pre', pointerEvents: 'none' }}>
        {text}
      </span>
      
      {/* Overlay layer: per-letter edge glow on hover */}
      <span 
        aria-hidden="true" 
        className="absolute inset-0"
        style={{ whiteSpace: 'pre', pointerEvents: 'auto' }}
      >
        {text.split('').map((char, index) => {
          const isActive = activeIndex === index;
          const color = colorsByIndex[index];
          
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
              
              {/* Edge glow layer - appears on hover */}
              <span
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  color: 'transparent',
                  opacity: isActive ? 1 : 0,
                  WebkitTextStroke: color ? `0.75px ${color}` : '0px transparent',
                  textShadow: color
                    ? `0 0 2px ${color}, 0 0 6px ${color}, 0 0 12px ${color}`
                    : 'none',
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
