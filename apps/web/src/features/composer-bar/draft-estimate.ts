import type {
  ContextSnapshot,
  TokenCostUpdate,
} from "@octos-org/octoscode-client/protocol";

/**
 * Core's own rough count (`octos_llm::context::estimate_tokens`): a quarter
 * token per ASCII character, two thirds of a token per other character, at
 * least one. The server's context estimate is built from the same function, so
 * the two numbers on the composer can be added without mixing scales. It is
 * not the provider's tokenizer.
 */
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 0x80) ascii += 1;
    else other += 1;
  }
  return Math.max(1, Math.floor(ascii / 4) + Math.floor(other / 1.5));
}

/** Core adds four tokens of role and structure to every message. */
const MESSAGE_OVERHEAD_TOKENS = 4;

export interface DraftEstimate {
  /** This message's text alone, by Core's count. */
  readonly draftTokens: number;
  /** The server's estimate of what this session's context already holds. */
  readonly contextTokens: number | null;
  /**
   * Where that estimate came from: `prompt` is the last prompt the server
   * sent the model, instructions and tool declarations included; `transcript`
   * is the conversation so far without them.
   */
  readonly contextSource: "prompt" | "transcript" | null;
  /** The server's own compaction threshold, when it reported one. */
  readonly threshold: number | null;
  /** Context plus this message reaches that threshold. */
  readonly reachesThreshold: boolean;
  /** The model's context window, as the server last reported it for this session. */
  readonly window: number | null;
  /** Context plus this message, as a share of the window. */
  readonly afterPercent: number | null;
  /** Files and images waiting to go with the message; nothing here counts them. */
  readonly attachments: number;
}

/**
 * Null for a blank draft: an empty composer shows nothing. Server numbers are
 * used only when they belong to the session the draft is in.
 */
export function draftEstimate(input: {
  sessionId: string | null | undefined;
  text: string;
  snapshot: ContextSnapshot | null | undefined;
  usage: TokenCostUpdate | null | undefined;
  attachments: number;
}): DraftEstimate | null {
  if (!input.sessionId || !input.text.trim()) return null;
  const draftTokens = estimateTextTokens(input.text) + MESSAGE_OVERHEAD_TOKENS;
  const snapshot =
    input.snapshot?.state.session_id === input.sessionId
      ? input.snapshot
      : null;
  const state = snapshot?.state ?? null;
  const contextTokens =
    state &&
    Number.isSafeInteger(state.token_estimate) &&
    state.token_estimate >= 0
      ? state.token_estimate
      : null;
  const reported =
    input.usage?.sessionId === input.sessionId
      ? input.usage.contextWindow
      : undefined;
  const window =
    reported !== undefined && Number.isFinite(reported) && reported > 0
      ? reported
      : null;
  const threshold =
    contextTokens !== null && snapshot?.reported
      ? snapshot.reported.thresholdTokens
      : null;
  return {
    draftTokens,
    contextTokens,
    contextSource:
      contextTokens === null
        ? null
        : snapshot?.reported
          ? "prompt"
          : "transcript",
    threshold,
    reachesThreshold:
      threshold !== null && contextTokens! + draftTokens >= threshold,
    window,
    afterPercent:
      contextTokens !== null && window !== null
        ? Math.min(
            100,
            Math.round(((contextTokens + draftTokens) / window) * 100),
          )
        : null,
    attachments: Math.max(0, input.attachments),
  };
}
