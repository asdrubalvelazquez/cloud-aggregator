"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { getRowActions } from "@/lib/driveRowActions";

type ContextMenuProps = {
  visible: boolean;
  x: number;
  y: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
  onClose: () => void;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onCopy?: (fileId: string, fileName: string) => void;
  onRename?: (fileId: string, fileName: string) => void;
  onDownload?: (fileId: string, fileName: string) => void;
  copyDisabled?: boolean;
};

export default function ContextMenu({
  visible,
  x,
  y,
  fileId,
  fileName,
  mimeType,
  webViewLink,
  isFolder,
  onClose,
  onOpenFolder,
  onCopy,
  onRename,
  onDownload,
  copyDisabled = false,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside as any);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside as any);
    };
  }, [visible, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => {
      onClose();
    };

    if (visible) {
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  // Get actions from shared helper
  const actions = getRowActions({
    fileId,
    fileName,
    mimeType,
    webViewLink,
    isFolder,
    onOpenFolder,
    onCopy,
    onRename,
    onDownload,
    copyDisabled,
  });

  // Adjust position to prevent overflow
  const menuWidth = 192; // w-48 = 12rem = 192px
  const menuHeight = actions.length * 40 + 20; // Approximate
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10);

  return (
    <div
      ref={menuRef}
      className="fixed bg-slate-700 border border-slate-600 rounded-lg shadow-xl py-1 w-48 z-50"
      style={{
        left: `${adjustedX}px`,
        top: `${adjustedY}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((action, index) => (
        <div key={index}>
          {action.disabled && action.tooltip ? (
            <div className="relative group">
              <button
                type="button"
                disabled
                onClick={(e) => e.stopPropagation()}
                className="w-full text-left px-4 py-2 text-sm text-slate-400 cursor-not-allowed flex items-center gap-2 opacity-50"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
              <div className="absolute left-full top-0 ml-2 px-3 py-2 bg-slate-900 text-slate-100 text-xs rounded-lg shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 border border-slate-600">
                {action.tooltip}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
                onClose();
              }}
              disabled={action.disabled}
              className="w-full text-left px-4 py-2 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          )}
          {action.dividerAfter && (
            <div className="border-t border-slate-600 my-1"></div>
          )}
        </div>
      ))}
    </div>
  );
}
