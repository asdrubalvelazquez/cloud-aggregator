export default function AdminDenied({
  searchParams,
}: {
  searchParams: { email?: string; admins?: string };
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-red-600 mb-4">
          Admin access denied
        </h1>
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            <strong>Detected email:</strong> {searchParams.email || "N/A"}
          </p>
          <p>
            <strong>Admin list count:</strong> {searchParams.admins || "0"}
          </p>
          <p className="mt-4 text-gray-600">
            <strong>Fix:</strong> set ADMIN_EMAILS to include the detected
            email (exact match) and redeploy.
          </p>
        </div>
      </div>
    </div>
  );
}
