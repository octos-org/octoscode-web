/** Native TUI autonomy.rs parse_thread/parse_turn and store.rs dispatch_turn_command. */
export type InspectionRequest =
  | { kind: "threads" }
  | { kind: "turn"; turnId: string }
  | { kind: "approval-scopes" };
export type InspectionIntent =
  { ok: true; request: InspectionRequest } | { ok: false; reason: string };

export function parseInspectionIntent(
  command: "thread" | "threads" | "turn",
  args: string,
  activeTurnId: string | null = null,
): InspectionIntent {
  const parts = args.trim() ? args.trim().split(/\s+/) : [];
  if (command === "thread" || command === "threads") {
    return parts.length === 0 ||
      (parts.length === 1 && (parts[0] === "graph" || parts[0] === "graph-get"))
      ? { ok: true, request: { kind: "threads" } }
      : {
          ok: false,
          reason:
            "Use /threads or /thread graph. Extra arguments are not supported.",
        };
  }
  if (
    parts.length > 2 ||
    (parts.length > 0 && parts[0] !== "state" && parts[0] !== "state-get")
  )
    return { ok: false, reason: "Use /turn state [turn UUID]." };
  const raw = parts[1] ?? activeTurnId;
  if (!raw)
    return {
      ok: false,
      reason: "No active turn to inspect. Use /turn state <turn UUID>.",
    };
  const turnId = normalizedTurnId(raw);
  return turnId
    ? { ok: true, request: { kind: "turn", turnId } }
    : { ok: false, reason: "Invalid turn UUID. Use /turn state <turn UUID>." };
}

// Rust TurnId is serde UUID: canonicalize the common UUID parser forms before
// comparing Core's canonical serialized receipt. Never infer an ID from text.
function normalizedTurnId(value: string): string | null {
  let uuid = value;
  if (uuid.startsWith("urn:uuid:")) uuid = uuid.slice(9);
  else if (uuid.startsWith("{") && uuid.endsWith("}")) uuid = uuid.slice(1, -1);
  if (/^[0-9a-f]{32}$/i.test(uuid))
    uuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    uuid,
  )
    ? uuid.toLowerCase()
    : null;
}
