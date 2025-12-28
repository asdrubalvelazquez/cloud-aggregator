"use client";

import { useState, useEffect } from "react";
import { authenticatedFetch } from "@/lib/api";

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

type PickedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
};

type GooglePickerButtonProps = {
  accountId: number;
  onFilesPicked: (files: PickedFile[]) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Google Picker Button Component
 * 
 * Opens Google Picker to allow user to select files from their Drive.
 * With drive.file scope, selected files become accessible to the app.
 * 
 * Requirements:
 * - NEXT_PUBLIC_GOOGLE_API_KEY: Google API Key (for loading Picker API)
 * - NEXT_PUBLIC_GOOGLE_CLIENT_ID: Google OAuth Client ID
 * - Backend endpoint: GET /drive/picker-token?account_id={id}
 * - Google Cloud Console: Enable "Google Picker API"
 */
export default function GooglePickerButton({
  accountId,
  onFilesPicked,
  disabled = false,
  className = "",
}: GooglePickerButtonProps) {
  const [pickerApiLoaded, setPickerApiLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Google Picker API
  useEffect(() => {
    if (!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID) {
      setError("Google API Key o Client ID no configurado");
      return;
    }

    // Load gapi and picker library
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => {
      window.gapi.load("picker", () => {
        setPickerApiLoaded(true);
      });
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const openPicker = async () => {
    if (!pickerApiLoaded) {
      setError("Google Picker API no está cargada");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get OAuth token from backend
      const res = await authenticatedFetch(
        `/drive/picker-token?account_id=${accountId}`
      );

      if (!res.ok) {
        throw new Error(`Error obteniendo token: ${res.status}`);
      }

      const { access_token } = await res.json();

      if (!access_token) {
        throw new Error("Token de acceso no disponible");
      }

      // Create and show Picker
      const picker = new window.google.picker.PickerBuilder()
        .addView(
          new window.google.picker.DocsView()
            .setIncludeFolders(false)
            .setSelectFolderEnabled(false)
        )
        .setOAuthToken(access_token)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setCallback((data: any) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const files: PickedFile[] = data.docs.map((doc: any) => ({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: doc.sizeBytes,
            }));
            onFilesPicked(files);
          }
        })
        .setTitle("Seleccionar archivos de Google Drive")
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .build();

      picker.setVisible(true);
    } catch (e: any) {
      setError(e.message || "Error al abrir Google Picker");
      console.warn("[GOOGLE_PICKER] Failed to open picker");
    } finally {
      setLoading(false);
    }
  };

  if (!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID) {
    return null; // Don't render if not configured
  }

  return (
    <div>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || loading || !pickerApiLoaded}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all
          ${
            disabled || loading || !pickerApiLoaded
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-700 text-white"
          }
          ${className}
        `}
      >
        {loading
          ? "Cargando..."
          : !pickerApiLoaded
          ? "Inicializando..."
          : "📁 Seleccionar archivos (Google Picker)"}
      </button>
      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}
    </div>
  );
}

// Type declarations for Google Picker API
declare global {
  interface Window {
    gapi: any;
    google: {
      picker: {
        PickerBuilder: any;
        DocsView: any;
        Feature: any;
        Action: any;
      };
    };
  }
}
