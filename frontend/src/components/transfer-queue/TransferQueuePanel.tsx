"use client";

import { useTransferQueue } from "@/hooks/useTransferQueue";
import { TransferJobCard } from "./TransferJobCard";

export function TransferQueuePanel() {
  const { jobs, isPanelOpen, closePanel, clearCompleted } = useTransferQueue();

  const jobsArray = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <>
      {/* Backdrop */}
      {isPanelOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={closePanel}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-40 transition-transform duration-300 ${
          isPanelOpen ? "translate-x-0" : "translate-x-full"
        } w-full lg:w-[400px]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Transfer Queue
            </h2>
            {jobs.size > 0 && (
              <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium px-2 py-0.5 rounded-full">
                {jobs.size}
              </span>
            )}
          </div>
          <button
            onClick={closePanel}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto h-[calc(100%-120px)]">
          {jobsArray.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <svg
                className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No transfers in queue
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Start a transfer to see progress here
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {jobsArray.map((job) => (
                <TransferJobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {jobs.size > 0 && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <button
              onClick={clearCompleted}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Clear Completed
            </button>
          </div>
        )}
      </div>
    </>
  );
}
