"use client";

import { useContext } from "react";
import { TransferQueueContext } from "@/context/TransferQueueContext";

/**
 * Hook to access TransferQueueContext
 * Must be used within TransferQueueProvider
 */
export function useTransferQueue() {
  const context = useContext(TransferQueueContext);
  
  if (!context) {
    throw new Error("useTransferQueue must be used within TransferQueueProvider");
  }
  
  return context;
}
