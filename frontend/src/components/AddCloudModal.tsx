"use client";

import { useState } from "react";
import { fetchGoogleLoginUrl, fetchOneDriveLoginUrl, fetchDropboxLoginUrl } from "@/lib/api";

type AddCloudModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function AddCloudModal({ open, onClose }: AddCloudModalProps) {
  const [connecting, setConnecting] = useState<"google" | "onedrive" | "dropbox" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnectGoogle = async () => {
    setConnecting("google");
    setError(null);
    
    try {
      const { url } = await fetchGoogleLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err: any) {
      const message = err?.message || "Error al conectar Google Drive";
      setError(message);
      setConnecting(null);
      console.error("[AddCloudModal] Google connect error:", err);
    }
  };

  const handleConnectOneDrive = async () => {
    setConnecting("onedrive");
    setError(null);
    
    try {
      const { url } = await fetchOneDriveLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err: any) {
      const message = err?.message || "Error al conectar OneDrive";
      setError(message);
      setConnecting(null);
      console.error("[AddCloudModal] OneDrive connect error:", err);
    }
  };

  const handleConnectDropbox = async () => {
    setConnecting("dropbox");
    setError(null);
    
    try {
      const { url } = await fetchDropboxLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err: any) {
      const message = err?.message || "Error al conectar Dropbox";
      setError(message);
      setConnecting(null);
      console.error("[AddCloudModal] Dropbox connect error:", err);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-md w-full border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">Conectar Nueva Nube</h2>
            <p className="text-xs text-slate-400 mt-1">Elige un proveedor para conectar</p>
          </div>
          <button
            onClick={onClose}
            disabled={connecting !== null}
            className="text-slate-400 hover:text-white transition text-2xl leading-none disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-100 mb-4">
              <p className="text-sm font-semibold">Error</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {/* Google Drive Button */}
            <button
              onClick={handleConnectGoogle}
              disabled={connecting !== null}
              className="w-full flex items-center gap-4 p-4 bg-slate-900 hover:bg-slate-700 border border-slate-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <div className="flex-shrink-0 w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center text-2xl group-hover:scale-110 transition">
                📁
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-semibold text-white">Google Drive</h3>
                <p className="text-xs text-slate-400">Conectar cuenta de Google</p>
              </div>
              {connecting === "google" && (
                <div className="flex-shrink-0">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                </div>
              )}
              {connecting !== "google" && (
                <div className="flex-shrink-0 text-slate-500 group-hover:text-white transition">
                  →
                </div>
              )}
            </button>

            {/* OneDrive Button */}
            <button
              onClick={handleConnectOneDrive}
              disabled={connecting !== null}
              className="w-full flex items-center gap-4 p-4 bg-slate-900 hover:bg-slate-700 border border-slate-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <div className="flex-shrink-0 w-12 h-12 bg-sky-500 rounded-lg flex items-center justify-center text-2xl group-hover:scale-110 transition">
                ☁️
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-semibold text-white">OneDrive</h3>
                <p className="text-xs text-slate-400">Conectar cuenta de Microsoft</p>
              </div>
              {connecting === "onedrive" && (
                <div className="flex-shrink-0">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                </div>
              )}
              {connecting !== "onedrive" && (
                <div className="flex-shrink-0 text-slate-500 group-hover:text-white transition">
                  →
                </div>
              )}
            </button>

            {/* Dropbox Button */}
            <button
              onClick={handleConnectDropbox}
              disabled={connecting !== null}
              className="w-full flex items-center gap-4 p-4 bg-slate-900 hover:bg-slate-700 border border-slate-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center group-hover:scale-110 transition p-2">
                <svg width="100%" height="100%" viewBox="0 0 43 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="m12.5 0l-12.5 8.1 8.7 7 12.5-7.8-8.7-7.3zm-12.5 21.9l12.5 8.2 8.7-7.3-12.5-7.7-8.7 6.8zm21.2 0.9l8.8 7.3 12.4-8.1-8.6-6.9-12.6 7.7zm21.2-14.7l-12.4-8.1-8.8 7.3 12.6 7.8 8.6-7zm-21.1 16.3l-8.8 7.3-3.7-2.5v2.8l12.5 7.5 12.5-7.5v-2.8l-3.8 2.5-8.7-7.3z" fill="white"/>
                </svg>
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-semibold text-white">Dropbox</h3>
                <p className="text-xs text-slate-400">Conectar cuenta de Dropbox</p>
              </div>
              {connecting === "dropbox" && (
                <div className="flex-shrink-0">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                </div>
              )}
              {connecting !== "dropbox" && (
                <div className="flex-shrink-0 text-slate-500 group-hover:text-white transition">
                  →
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={connecting === null ? onClose : undefined}
            disabled={connecting !== null}
            className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting !== null ? "Conectando..." : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
