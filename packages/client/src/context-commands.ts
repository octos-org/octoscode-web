import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import {
  APPUI_CONTEXT_METHODS,
  parseCompaction,
  type CompactResult,
} from "./context-state.ts";

export function parseCompactResult(
  value: unknown,
  sessionId: string,
): CompactResult | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    typeof value.compacted !== "boolean"
  )
    return null;
  const record = parseCompaction(value);
  if (!record || (value.reason != null && typeof value.reason !== "string"))
    return null;
  return {
    session_id: sessionId,
    compacted: value.compacted,
    ...record,
    ...(typeof value.reason === "string"
      ? { reason: value.reason.slice(0, 512) }
      : {}),
  };
}

export function createContextCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  capabilities: UiProtocolCapabilities,
) {
  function requireMethod(method: string) {
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
  }
  return {
    async compact(): Promise<CompactResult> {
      requireMethod(APPUI_CONTEXT_METHODS.COMPACT);
      const result = parseCompactResult(
        await client.request(APPUI_CONTEXT_METHODS.COMPACT, {
          session_id: sessionId,
        }),
        sessionId,
      );
      if (!result)
        throw new Error("Invalid or wrong-session compaction result");
      return result;
    },
    async setMode(mode: "llm" | "heuristic"): Promise<"llm" | "heuristic"> {
      requireMethod(APPUI_CONTEXT_METHODS.SET_MODE);
      if (mode !== "llm" && mode !== "heuristic")
        throw new Error("Unknown compaction mode");
      const result = await client.request(APPUI_CONTEXT_METHODS.SET_MODE, {
        session_id: sessionId,
        mode,
      });
      if (
        !isRecord(result) ||
        result.session_id !== sessionId ||
        result.mode !== mode
      )
        throw new Error("Invalid or wrong-session compaction mode result");
      return mode;
    },
  };
}
