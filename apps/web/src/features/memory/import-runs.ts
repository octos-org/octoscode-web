import { useSyncExternalStore } from "react";
import type { ImportRecord } from "./memory-import.ts";
import type { ImportOutcome } from "./MemoryImport.tsx";

/**
 * The last import of each memory scope (Profile and memory Session), kept in
 * this tab's memory only. A dropped connection remounts the memory page;
 * the run, its batches with their fingerprints and where it stopped outlive
 * that, so an uncertain batch is still shown and can be read back or sent
 * again. Another scope never sees it. Nothing here is persisted.
 */
export interface ImportRun {
  readonly scope: string;
  readonly name: string;
  readonly batches: readonly ImportRecord[][];
  /** Mutated by the run as it goes; published as a copy. */
  outcome: ImportOutcome;
  /** A step is in flight, possibly from a page that has since remounted. */
  pending: boolean;
}

export interface ImportRunView {
  name: string;
  outcome: ImportOutcome;
  pending: boolean;
}

const runs = new Map<string, ImportRun>();
const views = new Map<string, ImportRunView | null>();
const listeners = new Set<() => void>();

export function importRun(scope: string): ImportRun | undefined {
  return runs.get(scope);
}

export function startImportRun(run: ImportRun): void {
  runs.set(run.scope, run);
  publishImportRun(run);
}

export function dropImportRun(scope: string): void {
  if (runs.get(scope)?.pending) return;
  runs.delete(scope);
  views.set(scope, null);
  listeners.forEach((listener) => listener());
}

export function publishImportRun(run: ImportRun): void {
  if (runs.get(run.scope) !== run) return;
  const { stop, ...outcome } = run.outcome;
  views.set(run.scope, {
    name: run.name,
    outcome: { ...outcome, ...(stop ? { stop: { ...stop } } : {}) },
    pending: run.pending,
  });
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function importRunView(scope: string): ImportRunView | null {
  return views.get(scope) ?? null;
}

export function useImportRun(scope: string): ImportRunView | null {
  return useSyncExternalStore(
    subscribe,
    () => importRunView(scope),
    () => null,
  );
}
