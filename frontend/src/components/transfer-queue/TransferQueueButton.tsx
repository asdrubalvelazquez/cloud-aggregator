"use client";

import { useTransferQueue } from "@/hooks/useTransferQueue";

export function TransferQueueButton() {
  const { jobs, activeCount, isPanelOpen, togglePanel } = useTransferQueue();

  // Hide button if panel is open or no jobs
  if (isPanelOpen || jobs.size === 0) {
    return null;
  }

  return (
    <button
      onClick={togglePanel}
      className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-all hover:scale-105 z-30"
      aria-label="Open transfer queue"
    >
      <div className="relative">
        <svg
          className="w-6 h-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
        
        {/* Badge with job count */}
        {jobs.size > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {jobs.size}
          </span>
        )}
        
        {/* Pulse indicator for active transfers */}
        {activeCount > 0 && (
          <span className="absolute top-0 right-0 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        )}
      </div>
    </button>
  );
}
