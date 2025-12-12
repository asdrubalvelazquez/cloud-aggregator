'use client';

import React, { useState } from 'react';
import { useCopyContext } from '@/context/CopyContext';

export function CopyProgressBar() {
  const { copying, copyProgress, copyStatus, cancelCopy } = useCopyContext();

  if (!copying && copyProgress === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800 border-t border-slate-700 shadow-xl">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-300 font-medium">{copyStatus}</p>
            <span className="text-sm font-semibold text-emerald-400">{copyProgress.toFixed(0)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-slate-600">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${copyProgress}%` }}
            ></div>
          </div>
        </div>
        {copying && (
          <button
            onClick={() => cancelCopy("❌ Copia cancelada")}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition whitespace-nowrap"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
