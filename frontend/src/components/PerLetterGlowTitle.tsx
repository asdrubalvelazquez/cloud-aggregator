"use client";

import { useState } from "react";

interface PerLetterGlowTitleProps {
  text: string;
  className?: string;
}

export default function PerLetterGlowTitle({ text, className = "" }: PerLetterGlowTitleProps) {
  // Track container hover for under-glow effect
  const [isContainerHovered, setIsContainerHovered] = useState(false);

  return (
    <span 
      className="relative inline-block overflow-visible"
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
    >
      {/* Under-glow layer - light beneath text */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${className}`}
        style={{
          whiteSpace: 'pre',
          filter: 'blur(12px)',
          opacity: isContainerHovered ? 0.8 : 0,
          zIndex: -1,
        }}
      >
        {text}
      </span>
      
      {/* Base layer: continuous text with animated gradient */}
      <span className={className} style={{ whiteSpace: 'pre', pointerEvents: 'none' }}>
        {text}
      </span>
    </span>
  );
}
