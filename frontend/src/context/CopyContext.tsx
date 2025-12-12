'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface CopyContextType {
  copying: boolean;
  copyProgress: number;
  copyStatus: string | null;
  fileName: string | null;
  abortController: AbortController | null;
  setCopying: (value: boolean) => void;
  setCopyProgress: (value: number) => void;
  setCopyStatus: (value: string | null) => void;
  setFileName: (value: string | null) => void;
  setAbortController: (value: AbortController | null) => void;
  startCopy: (fileName: string) => void;
  updateProgress: (progress: number) => void;
  completeCopy: (message: string) => void;
  cancelCopy: (message: string) => void;
  resetCopy: () => void;
}

const CopyContext = createContext<CopyContextType | undefined>(undefined);

export function CopyProvider({ children }: { children: React.ReactNode }) {
  const [copying, setCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState(0);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const startCopy = useCallback((name: string) => {
    setCopying(true);
    setCopyProgress(10);
    setFileName(name);
    setCopyStatus(`Copiando "${name}"...`);
  }, []);

  const updateProgress = useCallback((progress: number) => {
    setCopyProgress(Math.min(progress, 90));
  }, []);

  const completeCopy = useCallback((message: string) => {
    setCopyProgress(100);
    setCopyStatus(message);
    setCopying(false);
  }, []);

  const cancelCopy = useCallback((message: string) => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setCopyProgress(0);
    setCopyStatus(message);
    setCopying(false);
  }, [abortController]);

  const resetCopy = useCallback(() => {
    setCopying(false);
    setCopyProgress(0);
    setCopyStatus(null);
    setFileName(null);
    setAbortController(null);
  }, []);

  return (
    <CopyContext.Provider
      value={{
        copying,
        copyProgress,
        copyStatus,
        fileName,
        abortController,
        setCopying,
        setCopyProgress,
        setCopyStatus,
        setFileName,
        setAbortController,
        startCopy,
        updateProgress,
        completeCopy,
        cancelCopy,
        resetCopy,
      }}
    >
      {children}
    </CopyContext.Provider>
  );
}

export function useCopyContext() {
  const context = useContext(CopyContext);
  if (!context) {
    throw new Error('useCopyContext must be used within CopyProvider');
  }
  return context;
}
