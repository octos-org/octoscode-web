import { useEffect, useRef, useSyncExternalStore } from "react";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import type {
  ActiveSessionRuntimeEvent,
  ActiveSessionRuntimeOptions,
  ActiveSessionRuntimeSnapshot,
} from "./active-session-runtime.ts";
import { LazyServerRuntime } from "./lazy-server-runtime.ts";

interface UseServerConnectionOptions extends Omit<ActiveSessionRuntimeOptions<OctosUiClient>, "createClient"> {
  loadClientFactory(): Promise<ActiveSessionRuntimeOptions<OctosUiClient>["createClient"]>;
  onEvent(event: ActiveSessionRuntimeEvent<OctosUiClient>): void;
}

export interface ServerConnectionController {
  runtime: LazyServerRuntime<OctosUiClient>;
  snapshot: ActiveSessionRuntimeSnapshot;
}

/** React is only a subscriber; ActiveSessionRuntime remains the authority. */
export function useServerConnection(
  options: UseServerConnectionOptions,
): ServerConnectionController {
  const eventSinkRef = useRef(options.onEvent);
  eventSinkRef.current = options.onEvent;
  const runtimeRef = useRef<LazyServerRuntime<OctosUiClient> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new LazyServerRuntime(async () => ({
      ...options,
      createClient: await options.loadClientFactory(),
    }));
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
