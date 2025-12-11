"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
}

interface Account {
  id: number;
  account_email: string;
}

export default function DriveFilesPage() {
  const params = useParams();
  const accountId = params?.id as string;

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedTargetAccount, setSelectedTargetAccount] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;

    const fetchData = async () => {
      try {
        // Fetch files
        const filesRes = await fetch(`${API_BASE}/drive/${accountId}/files`);
        const filesData = await filesRes.json();
        setFiles(filesData.files || []);

        // Fetch all accounts for copy dropdown
        const accountsRes = await fetch(`${API_BASE}/accounts`);
        const accountsData = await accountsRes.json();
        setAccounts(accountsData.accounts || []);
      } catch (err) {
        setError("Error loading files");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [accountId]);

  const handleCopyFile = async (fileId: string, fileName: string) => {
    if (!selectedTargetAccount) {
      alert("Please select a target account first");
      return;
    }

    setCopying(fileId);
    try {
      const res = await fetch(`${API_BASE}/drive/copy-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_account_id: parseInt(accountId),
          target_account_id: parseInt(selectedTargetAccount),
          file_id: fileId,
        }),
      });

      const data = await res.json();
      
      if (data.success) {
        alert(`File "${fileName}" copied successfully!`);
      } else {
        alert(`Failed to copy file: ${data.detail || "Unknown error"}`);
      }
    } catch (err) {
      alert("Error copying file");
      console.error(err);
    } finally {
      setCopying(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-gray-600">Loading files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  // Filter out current account from target options
  const targetAccounts = accounts.filter(
    (acc) => acc.id.toString() !== accountId
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <a href="/" className="text-blue-600 hover:underline">
            ← Back to Dashboard
          </a>
        </div>

        <h1 className="text-3xl font-bold mb-6">Google Drive Files</h1>

        {targetAccounts.length > 0 && (
          <div className="mb-6 bg-white p-4 rounded-lg shadow">
            <label className="block text-sm font-medium mb-2">
              Copy files to:
            </label>
            <select
              value={selectedTargetAccount}
              onChange={(e) => setSelectedTargetAccount(e.target.value)}
              className="w-full p-2 border rounded"
            >
              <option value="">Select target account...</option>
              {targetAccounts.map((acc) => (
                <option key={acc.id} value={acc.id.toString()}>
                  {acc.account_email}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Modified
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {files.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    No files found
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {file.name}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {file.mimeType.split("/").pop()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {file.size
                        ? `${(parseInt(file.size) / 1024 / 1024).toFixed(2)} MB`
                        : "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(file.modifiedTime).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {selectedTargetAccount && (
                        <button
                          onClick={() => handleCopyFile(file.id, file.name)}
                          disabled={copying === file.id}
                          className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                          {copying === file.id ? "Copying..." : "Copy"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
