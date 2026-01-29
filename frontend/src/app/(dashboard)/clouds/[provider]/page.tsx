"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/api";
import { toast } from "react-hot-toast";

interface CloudAccount {
  provider: "google_drive" | "onedrive" | "dropbox";
  email: string;
  provider_email: string;
  cloud_account_id: string | number;
  provider_account_uuid?: string | null;
  connection_status?: "connected" | "needs_reconnect" | "disconnected";
  can_reconnect?: boolean;
}

interface StorageAccount {
  provider: string;
  email: string;
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  percent_used: number | null;
  status: "ok" | "unavailable" | "error";
}

export default function ProviderAccountsPage() {
  const params = useParams();
  const router = useRouter();
  const provider = params?.provider as string;
  
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [storageData, setStorageData] = useState<StorageAccount[]>([]);
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
        // Filter by provider
        const providerAccounts = accountsArray.filter((a: CloudAccount) => a.provider === provider);
        setAccounts(providerAccounts);
      }

      // Load storage data
      const storageRes = await authenticatedFetch("/cloud/storage-summary");
      if (storageRes.ok) {
        const data = await storageRes.json();
        setStorageData(data.accounts || []);
      }
    } catch (error) {
      console.error("Error loading accounts:", error);
      toast.error("Error al cargar las cuentas");
    } finally {
      setLoading(false);
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case "google_drive": return "Google Drive";
      case "onedrive": return "OneDrive";
      case "dropbox": return "Dropbox";
      default: return provider;
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null || bytes === 0) return "0 GB";
    
    const tb = bytes / (1024 ** 4);
    const gb = bytes / (1024 ** 3);
    
    if (tb >= 1) {
      return `${tb.toFixed(2)} TB`;
    } else if (gb >= 1) {
      return `${gb.toFixed(2)} TB`;
    } else {
      return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
    }
  };

  const getStorageForAccount = (account: CloudAccount) => {
    return storageData.find((s) => s.email === account.provider_email);
  };

  const handleManage = (account: CloudAccount) => {
    if (account.provider === "google_drive") {
      router.push(`/drive/${account.cloud_account_id}`);
    } else if (account.provider === "onedrive") {
      router.push(`/onedrive/${account.provider_account_uuid || account.cloud_account_id}`);
    }
  };

  const handleReconnect = async (account: CloudAccount) => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://cloud-aggregator-api.fly.dev';
    
    if (account.provider === 'onedrive') {
      try {
        const response = await authenticatedFetch(`/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${account.cloud_account_id}`);
        
        if (!response.ok) {
          toast.error('Error al iniciar reconexión');
          return;
        }
        
        const data = await response.json();
        
        if (data.login_url) {
          window.location.href = data.login_url;
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
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/app')}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-3xl font-bold">{getProviderName(provider)} Accounts</h1>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📂</div>
            <h2 className="text-2xl font-semibold mb-2">No accounts found</h2>
            <p className="text-slate-400 mb-6">No {getProviderName(provider)} accounts connected</p>
            <button
              onClick={() => router.push('/app')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
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
                  {/* Email/Account Name */}
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold truncate">{account.provider_email}</h3>
                    <p className="text-xs text-slate-400 mt-1">Account ID: {String(account.cloud_account_id).substring(0, 8)}...</p>
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
                    <div className="space-y-3 mb-4">
                      <div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-sm text-slate-400">Total:</span>
                          <span className="text-lg font-semibold">{formatBytes(storage.total_bytes)}</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-sm text-slate-400">
                            {formatBytes(storage.used_bytes)} used ({storage.percent_used?.toFixed(1) || 0}%)
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                            style={{ width: `${Math.min(storage.percent_used || 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 italic mb-4">Storage information unavailable</div>
                  )}

                  {/* Action Buttons */}
                  <div className="space-y-2">
                    {needsReconnect ? (
                      <button
                        onClick={() => handleReconnect(account)}
                        className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
                      >
                        Reconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleManage(account)}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                      >
                        Manage Files
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
