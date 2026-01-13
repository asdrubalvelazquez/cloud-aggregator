export function CloudLoadingIndicator() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-16 text-slate-400">
      <div className="relative w-16 h-16">
        <svg
          viewBox="0 0 64 64"
          className="w-full h-full animate-pulse text-emerald-400"
          fill="currentColor"
        >
          <path d="M20 48h26a10 10 0 0 0 0-20h-1.3A14 14 0 0 0 12 30a8 8 0 0 0 8 18z" />
        </svg>
      </div>
      <div className="mt-4 text-sm tracking-wide">
        Loading your clouds…
      </div>
    </div>
  );
}
