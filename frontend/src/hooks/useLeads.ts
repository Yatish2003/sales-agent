import { useCallback } from "react";
import { api } from "../api/client";
import { usePolling } from "./usePolling";

export function useLeads() {
  const fetcher = useCallback(() => api.listLeads(), []);
  return usePolling(fetcher, 2500);
}

export function useLead(id: string | undefined) {
  const fetcher = useCallback(() => {
    if (!id) return Promise.resolve(null);
    return api.getLead(id);
  }, [id]);
  return usePolling(fetcher, 2500, Boolean(id));
}
