"use client";

import { useState, useEffect, type KeyboardEvent } from "react";

type OneDriveRenameModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  onConfirm: (newName: string) => void;
  isRenaming: boolean;
};

export default function OneDriveRenameModal({
  isOpen,
  fileName,
  onClose,
  onConfirm,
  isRenaming,
}: OneDriveRenameModalProps) {
  const [newName, setNewName] = useState(fileName);

  useEffect(() => {
    if (isOpen) {
      setNewName(fileName);
    }
  }, [isOpen, fileName]);

  const handleSubmit = () => {
    if (newName.trim() && newName !== fileName) {
      onConfirm(newName.trim());
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-4">Renombrar</h2>
        <p className="text-sm text-slate-400 mb-4">Nombre actual: <span className="text-white">{fileName}</span></p>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRenaming}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition disabled:opacity-50"
          placeholder="Nuevo nombre"
          autoFocus
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={isRenaming}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isRenaming || !newName.trim() || newName === fileName}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRenaming && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            Renombrar
          </button>
        </div>
      </div>
    </div>
  );
}
