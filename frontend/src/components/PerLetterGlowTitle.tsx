"use client";

import { useState } from "react";

interface PerLetterGlowTitleProps {
  text: string;
  className?: string;
}

export default function PerLetterGlowTitle({ text, className = "" }: PerLetterGlowTitleProps) {
  // Track which letter is currently hovered
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Store random glow color per letter index
  const [glowColorByIndex, setGlowColorByIndex] = useState<Record<number, string>>({});

  const randomGlowColor = (): string => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 95%, 70%)`;
  };

  const handleLetterHover = (index: number) => {
    setActiveIndex(index);
    // Generate random color for this letter on hover
    setGlowColorByIndex(prev => ({
      ...prev,
      [index]: randomGlowColor(),
    }));
  };

  return (
    <span 
      className="relative inline-block overflow-visible"
      style={{ isolation: "isolate" }}
    >
      {/* Base layer: continuous text with animated gradient */}
      <span className={className} style={{ whiteSpace: 'pre', pointerEvents: 'none', position: 'relative', zIndex: 1 }}>
        {text}
      </span>
      
      {/* Overlay layer: per-letter under-glow on hover */}
      <span 
        aria-hidden="true" 
        className="absolute inset-0"
        style={{ whiteSpace: 'pre', pointerEvents: 'auto' }}
      >
        {text.split('').map((char, index) => {
          const isActive = activeIndex === index;
          const glowColor = glowColorByIndex[index] || 'transparent';
          
          return (
            <span
              key={index}
              className="relative inline-block"
              onMouseEnter={() => handleLetterHover(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {/* Invisible spacer to maintain layout */}
              <span style={{ color: 'transparent', position: 'relative', zIndex: 1 }}>
                {char === ' ' ? '\u00A0' : char}
              </span>
              
              {/* Glow layer - light beneath letter */}
              <span
                className="absolute inset-0 transition-opacity duration-300"
                style={{
                  color: glowColor,
                  opacity: isActive ? 0.8 : 0,
                  filter: 'blur(18px)',
                  zIndex: 0,
                  pointerEvents: 'none',
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
