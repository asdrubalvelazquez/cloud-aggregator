"use client";

import { useState, useEffect, type MouseEvent, type KeyboardEvent } from "react";

type RenameModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  onConfirm: (newName: string) => void;
  isRenaming: boolean;
};

export default function RenameModal({
  isOpen,
  fileName,
  onClose,
  onConfirm,
  isRenaming,
}: RenameModalProps) {
  const [newName, setNewName] = useState(fileName);

  // Update input when fileName prop changes
  useEffect(() => {
    setNewName(fileName);
  }, [fileName]);

  // Auto-select filename without extension when modal opens
  useEffect(() => {
    if (isOpen) {
      const input = document.getElementById("rename-input") as HTMLInputElement;
      if (input) {
        input.focus();
        const lastDot = fileName.lastIndexOf(".");
        if (lastDot > 0) {
          input.setSelectionRange(0, lastDot);
        } else {
          input.select();
        }
      }
    }
  }, [isOpen, fileName]);

  const handleSubmit = (e?: MouseEvent | KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    const trimmedName = newName.trim();
    if (trimmedName && trimmedName !== fileName) {
      onConfirm(trimmedName);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit(e);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-4">
          Renombrar archivo
        </h2>

        <div className="mb-6">
          <label htmlFor="rename-input" className="block text-sm text-slate-300 mb-2">
            Nuevo nombre:
          </label>
          <input
            id="rename-input"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRenaming}
            className="w-full bg-slate-700 text-slate-100 border border-slate-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Ingresa el nuevo nombre"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isRenaming}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
          >
            Cancelar
          </button>
          <button
            onClick={(e) => handleSubmit(e)}
            disabled={isRenaming || !newName.trim() || newName.trim() === fileName}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
          >
            {isRenaming ? "Renombrando..." : "Renombrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
