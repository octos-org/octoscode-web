/**
 * The session panel's layout: open, last tab and width. A local display
 * preference (AGENTS.md browser-state boundary): no Session data, no
 * credentials, shared by every Session on this device.
 */
export const SESSION_PANEL_TABS = [
  "overview",
  "files",
  "changes",
  "outputs",
  "automation",
] as const;
export type SessionPanelTab = (typeof SESSION_PANEL_TABS)[number];

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 380;
/** The conversation keeps at least this much room beside the panel. */
export const CONVERSATION_MIN_WIDTH = 380;

export interface SessionPanelLayout {
  open: boolean;
  tab: SessionPanelTab;
  width: number;
}

export const DEFAULT_PANEL_LAYOUT: SessionPanelLayout = {
  open: false,
  tab: "overview",
  width: PANEL_DEFAULT_WIDTH,
};

const KEY = "octoscode-web:session-panel";

export function clampPanelWidth(width: number, available = Infinity): number {
  const max = Math.min(PANEL_MAX_WIDTH, available - CONVERSATION_MIN_WIDTH);
  return Math.round(
    Math.max(PANEL_MIN_WIDTH, Math.min(Math.max(max, PANEL_MIN_WIDTH), width)),
  );
}

export function readPanelLayout(storage: Storage | null): SessionPanelLayout {
  let value: unknown;
  try {
    value = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_PANEL_LAYOUT;
  const record = value as Record<string, unknown>;
  return {
    open: record.open === true,
    tab: SESSION_PANEL_TABS.includes(record.tab as SessionPanelTab)
      ? (record.tab as SessionPanelTab)
      : DEFAULT_PANEL_LAYOUT.tab,
    width:
      typeof record.width === "number" && Number.isFinite(record.width)
        ? clampPanelWidth(record.width)
        : DEFAULT_PANEL_LAYOUT.width,
  };
}

export function writePanelLayout(
  storage: Storage | null,
  layout: SessionPanelLayout,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Denied or full storage must not break the panel.
  }
}
