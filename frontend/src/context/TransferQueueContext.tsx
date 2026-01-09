"use client";

import React, { createContext, useState, useEffect, useCallback, useRef } from "react";
import { authenticatedFetch } from "@/lib/api";
import {
  JobWithItems,
  TransferJobStatus,
  isTerminalState,
  serializeJobsMap,
  deserializeJobsMap,
} from "@/types/transfer-queue";

const STORAGE_KEY = "transfer_queue_v1";
const STORAGE_VERSION = 1;
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const MAX_STORED_JOBS = 50;
const MAX_JOB_AGE_DAYS = 7;
const SAVE_DEBOUNCE_MS = 5000; // 5 seconds

interface TransferQueueContextValue {
  jobs: Map<string, JobWithItems>;
  activeCount: number;
  isPanelOpen: boolean;
  addJob: (job: JobWithItems) => void;
  removeJob: (jobId: string) => void;
  cancelJob: (jobId: string) => Promise<void>;
  clearCompleted: () => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const TransferQueueContext = createContext<TransferQueueContextValue | undefined>(undefined);

interface TransferQueueProviderProps {
  children: React.ReactNode;
}

export function TransferQueueProvider({ children }: TransferQueueProviderProps) {
  const [jobs, setJobs] = useState<Map<string, JobWithItems>>(new Map());
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate active job count (non-terminal jobs)
  const activeCount = Array.from(jobs.values()).filter((job) => !isTerminalState(job)).length;

  /**
   * Load jobs from localStorage on mount
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (parsed.version !== STORAGE_VERSION) {
        console.warn("[TransferQueue] Storage version mismatch, clearing old data");
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      const entries: Array<[string, JobWithItems]> = parsed.jobs || [];
      const restoredJobs = deserializeJobsMap(entries);

      // Filter out old jobs (> MAX_JOB_AGE_DAYS)
      const now = new Date();
      const filteredJobs = new Map<string, JobWithItems>();
      restoredJobs.forEach((job, id) => {
        const createdAt = new Date(job.created_at);
        const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays <= MAX_JOB_AGE_DAYS) {
          filteredJobs.set(id, job);
        }
      });

      setJobs(filteredJobs);
      console.log(`[TransferQueue] Restored ${filteredJobs.size} jobs from localStorage`);
    } catch (error) {
      console.error("[TransferQueue] Failed to restore jobs from localStorage:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  /**
   * Save jobs to localStorage (debounced)
   */
  const saveToLocalStorage = useCallback((jobsToSave: Map<string, JobWithItems>) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save
    saveTimeoutRef.current = setTimeout(() => {
      try {
        // Limit to MAX_STORED_JOBS (keep most recent)
        const sortedJobs = Array.from(jobsToSave.entries()).sort(
          ([, a], [, b]) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const limitedJobs = new Map(sortedJobs.slice(0, MAX_STORED_JOBS));

        const data = {
          version: STORAGE_VERSION,
          jobs: serializeJobsMap(limitedJobs),
          lastUpdated: new Date().toISOString(),
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log(`[TransferQueue] Saved ${limitedJobs.size} jobs to localStorage`);
      } catch (error) {
        console.error("[TransferQueue] Failed to save jobs to localStorage:", error);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /**
   * Fetch job status from backend
   */
  const fetchJobStatus = useCallback(async (jobId: string): Promise<JobWithItems | null> => {
    try {
      const response = await authenticatedFetch(`/transfer/status/${jobId}`);
      if (!response.ok) {
        console.error(`[TransferQueue] Failed to fetch status for job ${jobId}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data as JobWithItems;
    } catch (error) {
      console.error(`[TransferQueue] Error fetching status for job ${jobId}:`, error);
      return null;
    }
  }, []);

  /**
   * Polling logic: Fetch status for all active jobs
   */
  useEffect(() => {
    const activeJobs = Array.from(jobs.values()).filter((job) => !isTerminalState(job));

    if (activeJobs.length === 0) {
      // No active jobs, stop polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("[TransferQueue] Stopped polling (no active jobs)");
      }
      return;
    }

    // Start polling if not already started
    if (!pollingIntervalRef.current) {
      console.log(`[TransferQueue] Starting polling for ${activeJobs.length} active jobs`);
      
      pollingIntervalRef.current = setInterval(async () => {
        const jobIds = Array.from(jobs.values())
          .filter((job) => !isTerminalState(job))
          .map((job) => job.id);

        if (jobIds.length === 0) return;

        console.log(`[TransferQueue] Polling ${jobIds.length} jobs...`);

        // Fetch all jobs in parallel
        const results = await Promise.allSettled(jobIds.map(fetchJobStatus));

        setJobs((prev) => {
          const updated = new Map(prev);
          results.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value) {
              const jobId = jobIds[index];
              updated.set(jobId, result.value);
            }
          });
          return updated;
        });
      }, POLLING_INTERVAL_MS);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [jobs, fetchJobStatus]);

  /**
   * Save to localStorage whenever jobs change
   */
  useEffect(() => {
    if (jobs.size > 0) {
      saveToLocalStorage(jobs);
    }
  }, [jobs, saveToLocalStorage]);

  /**
   * Context actions
   */
  const addJob = useCallback((job: JobWithItems) => {
    setJobs((prev) => {
      const updated = new Map(prev);
      updated.set(job.id, job);
      return updated;
    });
    console.log(`[TransferQueue] Added job ${job.id}`);
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const updated = new Map(prev);
      updated.delete(jobId);
      return updated;
    });
    console.log(`[TransferQueue] Removed job ${jobId}`);
  }, []);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      // Optimistic update: mark as cancelled immediately
      setJobs((prev) => {
        const updated = new Map(prev);
        const job = updated.get(jobId);
        if (job) {
          updated.set(jobId, { ...job, status: "cancelled" });
        }
        return updated;
      });

      // Call backend to cancel
      const response = await authenticatedFetch(`/transfer/cancel/${jobId}`, {
        method: "POST",
      });

      if (!response.ok) {
        console.error(`[TransferQueue] Failed to cancel job ${jobId}: ${response.status}`);
        // Revert optimistic update on failure
        const statusData = await fetchJobStatus(jobId);
        if (statusData) {
          setJobs((prev) => {
            const updated = new Map(prev);
            updated.set(jobId, statusData);
            return updated;
          });
        }
        return;
      }

      // Fetch final status
      const statusData = await fetchJobStatus(jobId);
      if (statusData) {
        setJobs((prev) => {
          const updated = new Map(prev);
          updated.set(jobId, statusData);
          return updated;
        });
      }

      console.log(`[TransferQueue] Cancelled job ${jobId}`);
    } catch (error) {
      console.error(`[TransferQueue] Error cancelling job ${jobId}:`, error);
    }
  }, [fetchJobStatus]);

  const clearCompleted = useCallback(() => {
    setJobs((prev) => {
      const updated = new Map(prev);
      Array.from(updated.entries()).forEach(([id, job]) => {
        if (isTerminalState(job)) {
          updated.delete(id);
        }
      });
      return updated;
    });
    console.log("[TransferQueue] Cleared completed jobs");
  }, []);

  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => setIsPanelOpen(false), []);
  const togglePanel = useCallback(() => setIsPanelOpen((prev) => !prev), []);

  const value: TransferQueueContextValue = {
    jobs,
    activeCount,
    isPanelOpen,
    addJob,
    removeJob,
    cancelJob,
    clearCompleted,
    openPanel,
    closePanel,
    togglePanel,
  };

  return <TransferQueueContext.Provider value={value}>{children}</TransferQueueContext.Provider>;
}
