"use client";

import { useEffect } from "react";

type ToastProps = {
  message: string;
  type: "success" | "error" | "warning";
  onClose: () => void;
  duration?: number;
};

export default function Toast({ message, type, onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor = {
    success: "bg-emerald-500/90 border-emerald-400",
    error: "bg-red-500/90 border-red-400",
    warning: "bg-amber-500/90 border-amber-400",
  }[type];

  const icon = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
  }[type];

  return (
    <div className="fixed top-6 right-6 z-50 animate-slide-in">
      <div className={`${bgColor} border rounded-lg shadow-2xl px-6 py-4 flex items-center gap-3 min-w-[300px] max-w-md`}>
        <span className="text-2xl">{icon}</span>
        <p className="text-white font-medium flex-1">{message}</p>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white transition text-xl font-bold"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}
