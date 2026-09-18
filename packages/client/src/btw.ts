import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import { supportsMethod } from "./interaction.ts";
import { isRecord } from "./rpc.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export const SESSION_BTW_METHOD = CORE_UI_METHODS.SESSION_BTW;

/** Pinned Core ui_protocol.rs:3076. Full Session keys may include #topic. */
export interface SessionBtwParams {
  session_id: string;
  topic?: string;
  question: string;
}

/** Native RPC-only, ephemeral answer; not a turn or transcript message. */
export interface SessionBtwResult {
  session_id: string;
  answer: string;
  model?: string;
}

export interface BtwCommands {
  readonly sessionId: string;
  ask(question: string): Promise<SessionBtwResult>;
}

export class BtwProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BtwProtocolError";
  }
}

export function parseSessionBtwResult(
  value: unknown,
  sessionId: string,
): SessionBtwResult | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    typeof value.answer !== "string" ||
    !value.answer.trim() ||
    (value.model != null &&
      (typeof value.model !== "string" || !value.model.trim()))
  )
    return null;
  return {
    session_id: sessionId,
    answer: value.answer,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
}

/** No caller-provided routing fields survive this captured-scope boundary. */
export function createBtwCommands(
  rpc: { request(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  capabilities: UiProtocolCapabilities | undefined,
): BtwCommands {
  if (
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    sessionId !== sessionId.trim()
  )
    throw new BtwProtocolError("A confirmed Session is required for an aside");
  const available = supportsMethod(capabilities, SESSION_BTW_METHOD);
  return Object.freeze({
    sessionId,
    async ask(question: string): Promise<SessionBtwResult> {
      if (!available)
        throw new BtwProtocolError(
          "session/btw is not advertised by this server",
        );
      if (typeof question !== "string" || !question.trim())
        throw new BtwProtocolError("An aside question is required");
      // TUI uses the full native SessionKey and omits optional topic.
      const params: SessionBtwParams = {
        session_id: sessionId,
        question: question.trim(),
      };
      const result = parseSessionBtwResult(
        await rpc.request(SESSION_BTW_METHOD, params),
        sessionId,
      );
      if (!result)
        throw new BtwProtocolError("Invalid or wrong-Session aside result");
      return result;
    },
  });
}
