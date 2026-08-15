import type { BrokerConnectionStatus } from "../../types/broker";

const statuses = new Map<string, BrokerConnectionStatus>();
const listeners = new Map<string, Set<() => void>>();

function defaultStatus(): BrokerConnectionStatus {
  return {
    state: "disconnected",
    message: "Not connected",
    mode: "oauth",
    updatedAt: 0,
  };
}

export function getSchwabStatus(instanceId: string): BrokerConnectionStatus {
  return statuses.get(instanceId) ?? defaultStatus();
}

export function setSchwabStatus(instanceId: string, status: BrokerConnectionStatus): void {
  statuses.set(instanceId, status);
  for (const listener of listeners.get(instanceId) ?? []) {
    listener();
  }
}

export function subscribeSchwabStatus(instanceId: string, listener: () => void): () => void {
  const bucket = listeners.get(instanceId) ?? new Set<() => void>();
  bucket.add(listener);
  listeners.set(instanceId, bucket);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) listeners.delete(instanceId);
  };
}

export function clearSchwabStatus(instanceId: string): void {
  statuses.delete(instanceId);
  for (const listener of listeners.get(instanceId) ?? []) {
    listener();
  }
}
