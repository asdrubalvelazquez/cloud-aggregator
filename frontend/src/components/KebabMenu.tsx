"use client";

import { useState, useRef, useEffect } from "react";
import { authenticatedFetch } from "@/lib/api";

type KebabMenuProps = {
  provider: string;
  accountId: string;
  currentNickname?: string;
  displayName: string;
  onNicknameUpdate: (newNickname: string) => void;
  onDisconnect: (provider: string, displayName: string) => void;
};

export default function KebabMenu({ 
  provider, 
  accountId, 
  currentNickname, 
  displayName,
  onNicknameUpdate,
  onDisconnect
}: KebabMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nickname, setNickname] = useState(currentNickname || "");
  const [isLoading, setIsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsEditingNickname(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus input when editing
  useEffect(() => {
    if (isEditingNickname && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingNickname]);

  const handleNicknameSubmit = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/me/clouds/${provider}/${accountId}/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() })
      });

      if (response.ok) {
        const result = await response.json();
        onNicknameUpdate(result.nickname || "");
        setIsEditingNickname(false);
        setIsOpen(false);
      } else {
        console.error('Failed to update nickname');
      }
    } catch (error) {
      console.error('Error updating nickname:', error);
    }
    setIsLoading(false);
  };

  const handleDisconnect = async () => {
    if (isLoading) return;
    
    const confirmDisconnect = window.confirm(
      `¿Estás seguro que quieres desconectar la cuenta "${displayName}"?`
    );
    
    if (!confirmDisconnect) return;

    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/me/clouds/${provider}/${accountId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        onDisconnect(provider, result.account_email || displayName);
        setIsOpen(false);
      } else {
        console.error('Failed to disconnect account');
      }
    } catch (error) {
      console.error('Error disconnecting account:', error);
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNicknameSubmit();
    } else if (e.key === 'Escape') {
      setNickname(currentNickname || "");
      setIsEditingNickname(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 hover:bg-slate-700 rounded-lg transition-colors group"
        disabled={isLoading}
      >
        <svg 
          className="w-5 h-5 text-slate-400 group-hover:text-slate-300" 
          fill="currentColor" 
          viewBox="0 0 20 20"
        >
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-slate-800 rounded-lg shadow-lg border border-slate-700 z-50">
          <div className="py-1">
            {/* Nickname Section */}
            <div className="px-3 py-2 border-b border-slate-700">
              <label className="block text-xs text-slate-400 mb-1">Nickname</label>
              {isEditingNickname ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter nickname..."
                    maxLength={50}
                    className="flex-1 px-2 py-1 text-xs bg-slate-700 rounded text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleNicknameSubmit}
                    disabled={isLoading}
                    className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
                    title="Save"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setNickname(currentNickname || "");
                      setIsEditingNickname(false);
                    }}
                    className="p-1 text-red-400 hover:text-red-300"
                    title="Cancel"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingNickname(true)}
                  className="w-full text-left text-xs text-slate-300 hover:text-white transition-colors"
                >
                  {currentNickname || "Click to set nickname..."}
                </button>
              )}
            </div>

            {/* Actions */}
            <button
              onClick={() => setIsEditingNickname(true)}
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit nickname
            </button>

            <button
              onClick={handleDisconnect}
              disabled={isLoading}
              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}