/** TUI autonomy.rs parse_interval + dispatch_loop_command; pinned Core loop policy. */
export type LoopCreationMode = "maintenance" | "self_paced" | "fixed_interval";
export type LoopCreationInput =
  | { mode: "maintenance" | "self_paced"; prompt: string }
  | { mode: "fixed_interval"; prompt: string; interval_seconds: number };
export interface LoopCreationDraft {
  mode: string;
  prompt: string;
  interval: string;
}
export type LoopCreationValidation =
  { ok: true; input: LoopCreationInput } | { ok: false; reason: string };
export type LoopInterval =
  | { ok: true; seconds: number; truncatedMilliseconds: boolean }
  | { ok: false; reason: string };

// Core agent_orchestrator.rs:92/93/124. These are acceptance limits, not a
// browser scheduler; the server still decides admission, timing and expiry.
export const LOOP_CREATION_MIN_SECONDS = 60;
export const LOOP_CREATION_MAX_SECONDS = 86_400;
export const LOOP_CREATION_MAX_PROMPT_BYTES = 8_192;
const U64_MAX = 18_446_744_073_709_551_615n;
const durationUnits: Readonly<Record<string, bigint>> = {
  s: 1n,
  sec: 1n,
  secs: 1n,
  m: 60n,
  min: 60n,
  mins: 60n,
  h: 3_600n,
  hr: 3_600n,
  hrs: 3_600n,
  d: 86_400n,
  day: 86_400n,
  days: 86_400n,
};
export function parseLoopCreationInterval(raw: string): LoopInterval {
  const value = raw.trim();
  const invalid = (): LoopInterval => ({
    ok: false,
    reason:
      "Use a whole-number native interval such as 60s, 5m, or 2h (60 seconds to 24 hours).",
  });
  if (value.length > 64) return invalid();
  const match = /^([0-9]+)(ms|s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/.exec(
    value,
  );
  if (!match) return invalid();
  const amount = BigInt(match[1]!);
  if (amount > U64_MAX) return invalid();
  const unit = match[2]!;
  // Native Duration::as_secs truncates an explicit integer millisecond token.
  // Decimal tokens (1.5m, 60.5s) are never valid native interval grammar.
  const seconds =
    unit === "ms" ? amount / 1_000n : amount * durationUnits[unit]!;
  if (
    seconds > U64_MAX ||
    seconds < BigInt(LOOP_CREATION_MIN_SECONDS) ||
    seconds > BigInt(LOOP_CREATION_MAX_SECONDS)
  )
    return invalid();
  return {
    ok: true,
    seconds: Number(seconds),
    truncatedMilliseconds: unit === "ms" && amount % 1_000n !== 0n,
  };
}
export function buildLoopCreationInput(
  draft: LoopCreationDraft,
): LoopCreationValidation {
  if (
    draft.mode !== "maintenance" &&
    draft.mode !== "self_paced" &&
    draft.mode !== "fixed_interval"
  )
    return {
      ok: false,
      reason: "Choose Maintenance, Self-paced, or Fixed interval.",
    };
  const prompt = draft.prompt.trim();
  if (new TextEncoder().encode(prompt).length > LOOP_CREATION_MAX_PROMPT_BYTES)
    return {
      ok: false,
      reason: "Loop prompt must fit within the server's 8192-byte limit.",
    };
  if (draft.mode !== "maintenance" && !prompt)
    return {
      ok: false,
      reason: "A prompt is required for self-paced and fixed-interval loops.",
    };
  if (draft.mode === "fixed_interval") {
    const interval = parseLoopCreationInterval(draft.interval);
    return interval.ok
      ? {
          ok: true,
          input: {
            mode: draft.mode,
            prompt,
            interval_seconds: interval.seconds,
          },
        }
      : interval;
  }
  // Maintenance's empty string intentionally asks Core for its own fallback.
  // Never substitute the browser's prompt, cadence, or filesystem contents.
  return { ok: true, input: { mode: draft.mode, prompt } };
}

export type LoopCreationReceipt =
  | { kind: "confirmed"; input: LoopCreationInput }
  | { kind: "invalid" | "unconfirmed"; reason: string }
  | { kind: "stale" };
export type CreateLoop = (input: LoopCreationInput) => Promise<boolean>;

/** One explicit creation per form submission; no automatic mutation retries. */
export function createLoopCreationSubmission() {
  let epoch = 0;
  let pending: Promise<LoopCreationReceipt> | undefined;
  return {
    cancel() {
      epoch += 1;
      pending = undefined;
    },
    submit(
      draft: LoopCreationDraft,
      createLoop: CreateLoop,
    ): Promise<LoopCreationReceipt> {
      if (pending) return pending;
      const parsed = buildLoopCreationInput(draft);
      if (!parsed.ok)
        return Promise.resolve({ kind: "invalid", reason: parsed.reason });
      const input = Object.freeze({ ...parsed.input });
      const ticket = ++epoch;
      // Resolve from a microtask so pending is installed before callback reentry.
      const operation = Promise.resolve().then(
        async (): Promise<LoopCreationReceipt> => {
          if (ticket !== epoch) return { kind: "stale" };
          try {
            const confirmed = await createLoop(input);
            if (ticket !== epoch) return { kind: "stale" };
            return confirmed
              ? { kind: "confirmed", input }
              : {
                  kind: "unconfirmed",
                  reason:
                    "Creation was not confirmed. Refresh the loop list before trying again; the server may have accepted it.",
                };
          } catch {
            return ticket !== epoch
              ? { kind: "stale" }
              : {
                  kind: "unconfirmed",
                  reason:
                    "Creation was not confirmed. Refresh the loop list before trying again; the server may have accepted it.",
                };
          } finally {
            if (ticket === epoch) pending = undefined;
          }
        },
      );
      pending = operation;
      return operation;
    },
  };
}
