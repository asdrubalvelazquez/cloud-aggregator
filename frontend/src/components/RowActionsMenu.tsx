"use client";

import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { getRowActions } from "@/lib/driveRowActions";

type RowActionsMenuProps = {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onCopy?: (fileId: string, fileName: string) => void;
  onRename?: (fileId: string, fileName: string) => void;
  onDownload?: (fileId: string, fileName: string) => void;
  copyDisabled?: boolean;
};

export default function RowActionsMenu({
  fileId,
  fileName,
  mimeType,
  webViewLink,
  isFolder,
  onOpenFolder,
  onCopy,
  onRename,
  onDownload,
  copyDisabled = false,
}: RowActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close menu on scroll
  useEffect(() => {
    const handleScroll = () => {
      setIsOpen(false);
    };

    if (isOpen) {
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const handleToggleMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleMenuClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

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

  return (
    <div className="relative" ref={menuRef} onClick={handleMenuClick}>
      {/* Kebab Menu Button */}
      <button
        type="button"
        onClick={handleToggleMenu}
        aria-label="Acciones"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="p-2 hover:bg-slate-600/50 rounded-lg transition text-slate-300 hover:text-white"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="opacity-70 hover:opacity-100"
        >
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-48 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 py-1"
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
                    handleAction(() => action.onClick());
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
      )}
    </div>
  );
}
