/** The live turn's current step, mirroring the TUI's composer status word. */
export interface TurnActivity {
  readonly label: string;
  readonly startedAtMs: number;
  readonly lastAtMs: number;
  /**
   * Judge #8 (round 3): the untranslated template this label came from
   * ("Running {value0}…"), so renderers can localize through t(). Absent for
   * fixed words ("Thinking…") whose label IS the catalog key.
   */
  readonly template?: string | undefined;
  /** The template's interpolation values (tool names stay untranslated). */
  readonly params?: Readonly<Record<string, string | number>> | undefined;
}

export type TurnActivityState = Readonly<TurnActivity | null>;

export function initialActivityState(): TurnActivityState {
  return null;
}

export type TurnActivityEvent =
  | { kind: "reasoning-delta"; atMs: number }
  | { kind: "assistant-delta"; atMs: number }
  | { kind: "tool-start"; atMs: number; toolName: string }
  | { kind: "tool-end"; atMs: number }
  | { kind: "turn-end"; atMs: number };

export function turnActivity(
  state: TurnActivityState,
  event: TurnActivityEvent,
): TurnActivityState {
  switch (event.kind) {
    case "turn-end":
      return null;
    case "reasoning-delta":
    case "assistant-delta":
    case "tool-end": {
      const label = event.kind === "assistant-delta" ? "Writing…" : "Thinking…";
      return {
        label,
        startedAtMs: state?.startedAtMs ?? event.atMs,
        lastAtMs: event.atMs,
      };
    }
    case "tool-start":
      return {
        label: `Running ${event.toolName}…`,
        template: "Running {value0}…",
        params: { value0: event.toolName },
        startedAtMs: state?.startedAtMs ?? event.atMs,
        lastAtMs: event.atMs,
      };
  }
}

export function activityLabel(activity: TurnActivityState): string {
  return activity?.label ?? "";
}

/** The glyph kind the animated CSS component renders ("spinner" | ""). */
export function activityGlyph(activity: TurnActivityState): string {
  return activity ? "spinner" : "";
}
