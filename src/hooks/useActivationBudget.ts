import { useCallback, useEffect, useSyncExternalStore } from "react";

interface ActivationBudgetOptions {
  enabled: boolean;
  id: string | null;
  limit?: number;
  scope: string;
}

interface ActivationBudgetStore {
  entries: Map<string, number>;
  listeners: Set<() => void>;
}

const activationBudgetStores = new Map<string, ActivationBudgetStore>();

function getStore(scope: string): ActivationBudgetStore {
  let store = activationBudgetStores.get(scope);
  if (!store) {
    store = {
      entries: new Map<string, number>(),
      listeners: new Set<() => void>(),
    };
    activationBudgetStores.set(scope, store);
  }
  return store;
}

function notifyStore(scope: string): void {
  const store = getStore(scope);
  store.listeners.forEach((listener) => listener());
}

function acquireActivation(scope: string, id: string, limit: number): void {
  const store = getStore(scope);
  const nextEntries = new Map(store.entries);
  if (nextEntries.has(id)) {
    nextEntries.delete(id);
  }
  nextEntries.set(id, Date.now());

  while (nextEntries.size > Math.max(1, limit)) {
    const oldestEntry = nextEntries.entries().next().value as [string, number] | undefined;
    if (!oldestEntry) {
      break;
    }
    nextEntries.delete(oldestEntry[0]);
  }

  const didChange =
    nextEntries.size !== store.entries.size ||
    Array.from(nextEntries.keys()).some((entryId, index) => Array.from(store.entries.keys())[index] !== entryId);

  if (!didChange) {
    return;
  }

  store.entries = nextEntries;
  notifyStore(scope);
}

function releaseActivation(scope: string, id: string): void {
  const store = getStore(scope);
  if (!store.entries.has(id)) {
    return;
  }
  store.entries.delete(id);
  notifyStore(scope);
}

export function useActivationBudget({
  enabled,
  id,
  limit = 2,
  scope,
}: ActivationBudgetOptions): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const store = getStore(scope);
    store.listeners.add(listener);
    return () => {
      store.listeners.delete(listener);
    };
  }, [scope]);

  const getSnapshot = useCallback(() => {
    if (!id) {
      return false;
    }
    return getStore(scope).entries.has(id);
  }, [id, scope]);

  const isWithinBudget = useSyncExternalStore(subscribe, getSnapshot, () => false);

  useEffect(() => {
    if (!id) {
      return;
    }

    if (enabled) {
      acquireActivation(scope, id, limit);
      return () => {
        releaseActivation(scope, id);
      };
    }

    releaseActivation(scope, id);
    return undefined;
  }, [enabled, id, limit, scope]);

  return isWithinBudget;
}

export default useActivationBudget;
