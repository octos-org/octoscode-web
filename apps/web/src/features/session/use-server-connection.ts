import { useEffect, useRef, useSyncExternalStore } from "react";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import {
  ActiveSessionRuntime,
  type ActiveSessionRuntimeEvent,
  type ActiveSessionRuntimeOptions,
  type ActiveSessionRuntimeSnapshot,
} from "./active-session-runtime.ts";

interface UseServerConnectionOptions extends ActiveSessionRuntimeOptions<OctosUiClient> {
  onEvent(event: ActiveSessionRuntimeEvent<OctosUiClient>): void;
}

export interface ServerConnectionController {
  runtime: ActiveSessionRuntime<OctosUiClient>;
  snapshot: ActiveSessionRuntimeSnapshot;
}

/** React is only a subscriber; ActiveSessionRuntime remains the authority. */
export function useServerConnection(
  options: UseServerConnectionOptions,
): ServerConnectionController {
  const eventSinkRef = useRef(options.onEvent);
  eventSinkRef.current = options.onEvent;
  const runtimeRef = useRef<ActiveSessionRuntime<OctosUiClient> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new ActiveSessionRuntime(options);
  }
  const runtime = runtimeRef.current;
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(
    () => runtime.subscribeEvents((event) => eventSinkRef.current(event)),
    [runtime],
  );
  useEffect(() => () => runtime.disconnect(), [runtime]);

  return { runtime, snapshot };
}
