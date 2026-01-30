"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

interface CloudAccount {
  provider: "google_drive" | "onedrive" | "dropbox";
  email: string;
  provider_email: string;
  cloud_account_id: string | number;
  provider_account_id?: string | null;  // Microsoft/Google account ID (for reconnect)
  provider_account_uuid?: string | null; // UUID from cloud_provider_accounts (for file routes)
  connection_status?: "connected" | "needs_reconnect" | "disconnected";
  can_reconnect?: boolean;
  storage?: {
    total_bytes: number | null;
    used_bytes: number | null;
    free_bytes: number | null;
    percent_used: number | null;
  };
}

interface CloudStorageData {
  accounts: Array<{
    provider: string;
    email: string;
    total_bytes: number | null;
    used_bytes: number | null;
    free_bytes: number | null;
    percent_used: number | null;
    status: "ok" | "unavailable" | "error";
  }>;
}

export default function CloudsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [storageData, setStorageData] = useState<CloudStorageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load cloud accounts status
      const statusRes = await authenticatedFetch("/me/cloud-status");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const accountsArray = Array.isArray(statusData) ? statusData : statusData.accounts || [];
        setAccounts(accountsArray);
      }

      // Load storage data
      const storageRes = await authenticatedFetch("/cloud/storage-summary");
      if (storageRes.ok) {
        const data = await storageRes.json();
        setStorageData(data);
      }
    } catch (error) {
      console.error("Error loading cloud data:", error);
      toast.error("Error al cargar datos de las nubes");
    } finally {
      setLoading(false);
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "google_drive":
        return (
          <svg className="w-12 h-12" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
            <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
            <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
            <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
            <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
            <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
            <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
          </svg>
        );
      case "onedrive":
        return (
          <svg className="w-12 h-12" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path fill="#0364B8" d="M19.484 7.937l-5.656 5.656 10.906 10.906c.75-.422 1.422-.984 1.969-1.656.109-.141.203-.297.313-.438l.172-.25-7.704-14.218z"/>
            <path fill="#0078D4" d="M30.391 17.562c-.547-1.875-1.891-3.453-3.688-4.328L19 .812c-.063-.125-.172-.234-.266-.359C17.47-.235 15.907-.423 14.5.406c-.594.344-1.047.875-1.344 1.5l-5.437 10.031 10.765 10.766 11.906-4.656v-.484z"/>
            <path fill="#1490DF" d="M21.203 9.641L10.437 20.406H2.125C.953 20.406 0 19.453 0 18.281c0-.734.391-1.406 1.016-1.766l6.703-3.609 5.437-10.031c.297-.625.75-1.156 1.344-1.5.406-.25.859-.375 1.313-.375l5.391 9.641z"/>
            <path fill="#28A8EA" d="M13.313 11.375l-5.594 5.594-6.703 3.609C.391 20.875 0 21.547 0 22.281c0 1.172.953 2.125 2.125 2.125h18.281c.344 0 .672-.078.984-.203l-7.906-12.828h-.171z"/>
          </svg>
        );
      case "dropbox":
        return (
          <svg className="w-12 h-12" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path fill="#0061ff" d="M8 3L0 8.5l8 5.5 8-5.5L8 3zm16 0l-8 5.5 8 5.5 8-5.5L24 3zM0 19.5l8 5.5 8-5.5-8-5.5-8 5.5zm24 0l-8 5.5 8 5.5 8-5.5-8-5.5z"/>
            <path fill="#0061ff" d="M8 27l8-5.5L24 27l-8 5z"/>
          </svg>
        );
      default:
        return <div className="w-12 h-12 bg-slate-600 rounded-full" />;
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case "google_drive":
        return "Google Drive";
      case "onedrive":
        return "OneDrive";
      case "dropbox":
        return "Dropbox";
      default:
        return provider;
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null || bytes === 0) return "0 GB";
    
    const tb = bytes / (1024 ** 4);
    const gb = bytes / (1024 ** 3);
    const mb = bytes / (1024 ** 2);
    
    if (tb >= 1) {
      return `${tb.toFixed(2)} TB`;
    } else if (gb >= 1) {
      return `${gb.toFixed(0)} GB`;
    } else {
      return `${mb.toFixed(0)} MB`;
    }
  };

  const getStorageForAccount = (account: CloudAccount) => {
    if (!storageData) return null;
    
    const storageAccount = storageData.accounts.find(
      (s) => s.email === account.provider_email
    );
    
    return storageAccount;
  };

  const handleReconnect = async (account: CloudAccount) => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://cloud-aggregator-api.fly.dev';
    
    if (account.provider === 'onedrive') {
      try {
        // Use provider_account_id (Microsoft account ID) for OneDrive reconnection
        const accountId = account.provider_account_id;
        console.log('[OneDrive Reconnect] Using provider_account_id:', accountId);
        
        if (!accountId) {
          console.error('[ERROR] No provider_account_id found for account:', account);
          toast.error('No se encontró el ID de la cuenta para reconectar');
          return;
        }
        
        const response = await authenticatedFetch(`/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${accountId}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ERROR] Response not OK:', response.status, errorText);
          toast.error('Error al iniciar reconexión');
          return;
        }
        
        const data = await response.json();
        
        if (data.login_url) {
          window.location.href = data.login_url;
        } else {
          toast.error('No se recibió URL de reconexión');
        }
      } catch (error) {
        console.error('[ERROR] Error al llamar login-url:', error);
        toast.error('Error al iniciar reconexión');
      }
    } else if (account.provider === 'google_drive') {
      window.location.href = `${apiBaseUrl}/auth/google?mode=reconnect&reconnect_account_id=${account.cloud_account_id}`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Your Connected Clouds</h1>
          <button
            onClick={() => router.push('/app')}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Connect New Cloud
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account) => {
            const storage = getStorageForAccount(account);
            const isConnected = account.connection_status === "connected";
            const needsReconnect = account.can_reconnect;

            return (
              <div
                key={`${account.provider}-${account.cloud_account_id}`}
                className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-slate-600 transition-colors"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {getProviderIcon(account.provider)}
                    <div>
                      <h3 className="text-xl font-semibold">{getProviderName(account.provider)}</h3>
                      <p className="text-sm text-slate-400 mt-0.5">{account.provider_email}</p>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="mb-4">
                  {isConnected ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-900/30 text-emerald-400 text-sm rounded-full border border-emerald-500/30">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Connected
                    </span>
                  ) : needsReconnect ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-900/30 text-yellow-400 text-sm rounded-full border border-yellow-500/30">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Needs reconnect
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-400 text-sm rounded-full border border-slate-600">
                      Disconnected
                    </span>
                  )}
                </div>

                {/* Storage Info */}
                {storage && storage.total_bytes ? (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm text-slate-400">Total Storage:</span>
                        <span className="text-lg font-semibold">{formatBytes(storage.total_bytes)}</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm text-slate-400">
                          {formatBytes(storage.used_bytes)} used ({storage.percent_used?.toFixed(1) || 0}%)
                        </span>
                      </div>
                      {/* Progress Bar */}
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                          style={{ width: `${Math.min(storage.percent_used || 0, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 italic">Storage information unavailable</div>
                )}

                {/* Action Button */}
                <div className="mt-6">
                  {needsReconnect ? (
                    <button
                      onClick={() => handleReconnect(account)}
                      className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Reconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (account.provider === "google_drive") {
                          router.push(`/drive/${account.cloud_account_id}`);
                        } else if (account.provider === "onedrive") {
                          router.push(`/onedrive/${account.provider_account_uuid || account.cloud_account_id}`);
                        }
                      }}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Manage
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {accounts.length === 0 && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">☁️</div>
            <h2 className="text-2xl font-semibold mb-2">No clouds connected yet</h2>
            <p className="text-slate-400 mb-6">Connect your first cloud storage account to get started</p>
            <button
              onClick={() => router.push('/app')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Connect Cloud Account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
