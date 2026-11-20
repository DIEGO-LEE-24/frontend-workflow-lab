// A small store outside React.
//
// Screens do not read the whole state from one context. Each component subscribes with a selector
// and re-renders only when the value it selected changes (see tests/render.test.tsx for the count).
// The store also keeps the reason of the last refused request, so the screen can show it.

import { useSyncExternalStore } from 'react';
import type { Result, Refusal } from '../domain/actions';
import { loadSaved, type LoadResult } from '../domain/migrate';
import type { AppState } from '../domain/model';

export interface Failure {
  readonly reason: Refusal;
  readonly at: number;
}

export interface Store {
  getState(): AppState;
  getFailure(): Failure | null;
  /** Runs one pure transition. A refused request leaves the state as it was and records why. */
  dispatch(transition: (s: AppState) => Result): Result;
  clearFailure(): void;
  subscribe(listener: () => void): () => void;
  readonly loaded: LoadResult;
}

export const STORAGE_KEY = 'frontend-workflow-lab.state';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createStore(storage: StorageLike | null): Store {
  const loaded = loadSaved(storage ? storage.getItem(STORAGE_KEY) : null);
  let state = loaded.state;
  let failure: Failure | null = null;
  let failures = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    loaded,
    getState: () => state,
    getFailure: () => failure,
    dispatch(transition) {
      const result = transition(state);
      if (result.ok) {
        state = result.state;
        failure = null;
        try {
          storage?.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
          // Storage can be full or blocked. The app keeps working from memory.
        }
      } else {
        failures += 1;
        failure = { reason: result.reason, at: failures };
      }
      notify();
      return result;
    },
    clearFailure() {
      if (failure === null) return;
      failure = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribes to one derived value. Selectors must return a primitive or a reference that stays
 *  the same while the underlying data is unchanged, which holds here because transitions copy
 *  only what they change. */
export function useSelector<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function useFailure(store: Store): Failure | null {
  return useSyncExternalStore(store.subscribe, store.getFailure);
}
