"use client";

import { useState } from "react";
import { useTransferQueue } from "@/hooks/useTransferQueue";
import { calculateProgress, isTerminalState, getProviderDisplayName } from "@/types/transfer-queue";

/**
 * Compact transfer widget - Google Drive style
 * Shows at bottom-right corner as a small floating card
 */
export function TransferWidget() {
  const { jobs, clearCompleted } = useTransferQueue();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  // Get jobs as array, sorted by creation date (newest first)
  // Filter out jobs that don't have provider info (old/corrupted data)
  const jobsArray = Array.from(jobs.values())
    .filter(job => job.source_provider && job.target_provider) // Only show jobs with valid provider info
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Count active (non-terminal) jobs
  const activeJobs = jobsArray.filter(job => !isTerminalState(job));
  const completedJobs = jobsArray.filter(job => isTerminalState(job) && (job.status === "done" || job.status === "done_skipped"));
  const failedJobs = jobsArray.filter(job => job.status === "failed");

  // If no jobs, don't show anything
  if (jobsArray.length === 0) return null;

  // Get the most recent job for display
  const currentJob = jobsArray[0];
  const progress = calculateProgress(currentJob);
  const isComplete = isTerminalState(currentJob);

  // Determine header text
  const getHeaderText = () => {
    if (activeJobs.length > 0) {
      return `Transfiriendo ${activeJobs.length} ${activeJobs.length === 1 ? 'elemento' : 'elementos'}`;
    } else if (completedJobs.length > 0 && failedJobs.length === 0) {
      return `${completedJobs.length} ${completedJobs.length === 1 ? 'transferencia completada' : 'transferencias completadas'}`;
    } else if (failedJobs.length > 0) {
      return `${failedJobs.length} ${failedJobs.length === 1 ? 'transferencia falló' : 'transferencias fallaron'}`;
    }
    return 'Transferencias';
  };

  // Get status color
  const getStatusColor = () => {
    if (activeJobs.length > 0) return "bg-blue-500";
    if (failedJobs.length > 0) return "bg-red-500";
    return "bg-green-500";
  };

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="bg-slate-800 border border-slate-700 rounded-full p-3 shadow-lg hover:bg-slate-700 transition-colors"
        title="Ver transferencias"
      >
        <div className="relative">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          {activeJobs.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              {activeJobs.length}
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden w-80">
      {/* Header - Clickable to expand/collapse */}
      <div 
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-700/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full ${getStatusColor()} ${activeJobs.length > 0 ? 'animate-pulse' : ''}`} />
          <span className="text-white font-medium text-sm">{getHeaderText()}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Expand/Collapse */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="text-slate-400 hover:text-white p-1 transition-colors"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          {/* Close/Minimize */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (activeJobs.length > 0) {
                setIsMinimized(true);
              } else {
                clearCompleted();
              }
            }}
            className="text-slate-400 hover:text-white p-1 transition-colors"
            title={activeJobs.length > 0 ? "Minimizar" : "Cerrar"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-slate-700">
          {/* Job list */}
          <div className="max-h-64 overflow-y-auto">
            {jobsArray.slice(0, 5).map((job) => {
              const jobProgress = calculateProgress(job);
              const jobIsComplete = isTerminalState(job);
              const jobFailed = job.status === "failed";
              
              return (
                <div key={job.id} className="px-4 py-3 border-b border-slate-700/50 last:border-b-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* File icon */}
                      <div className="flex-shrink-0">
                        {jobIsComplete && !jobFailed ? (
                          <div className="w-8 h-8 bg-green-500/20 rounded flex items-center justify-center">
                            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : jobFailed ? (
                          <div className="w-8 h-8 bg-red-500/20 rounded flex items-center justify-center">
                            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center">
                            <svg className="w-5 h-5 text-blue-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                          </div>
                        )}
                      </div>
                      
                      {/* Job info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">
                          {getProviderDisplayName(job.source_provider)} → {getProviderDisplayName(job.target_provider)}
                        </p>
                        <p className="text-slate-400 text-xs">
                          {job.completed_items}/{job.total_items} archivos
                        </p>
                      </div>
                    </div>
                    
                    {/* Status indicator */}
                    {jobIsComplete && !jobFailed && (
                      <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  
                  {/* Progress bar - only show for active jobs */}
                  {!jobIsComplete && (
                    <div className="w-full bg-slate-700 rounded-full h-1 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${jobProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Footer - show if there are completed jobs */}
          {completedJobs.length > 0 && activeJobs.length === 0 && (
            <div className="px-4 py-2 border-t border-slate-700 bg-slate-800/50">
              <button
                onClick={clearCompleted}
                className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
              >
                Limpiar completadas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
