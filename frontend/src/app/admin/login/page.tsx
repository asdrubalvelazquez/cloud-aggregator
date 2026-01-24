"use client";

export default function AdminLogin() {
  const handleContinue = () => {
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Login</h1>
        <p className="text-gray-600 mb-6">
          Sign in to access the admin panel. After signing in, you will be redirected back here.
        </p>
        <button
          onClick={handleContinue}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Continue to sign in
        </button>
      </div>
    </div>
  );
}
