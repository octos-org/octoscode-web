/**
 * Read-only composer parity for a focused PEER Session (audit row 7, grant 0700).
 * TUI: a focused peer replaces the editable composer with a dim status row
 * (reference-tui-0a174d95/src/app/render.rs:1699-1708), decided by EXACT
 * membership in the opened-peer session set (model.rs:8023-8026) — never a
 * `topic()`/`peer-` string prefix, which false-positives on ordinary sessions
 * whose topic merely starts with `peer-`.
 */
export interface PeerReadonlyRow {
  /** Native peer identity, which IS the peer's own Session id (grant 0700). */
  readonly identity: string;
  readonly slug: string;
}

/** Hint shown in place of a peer's editable composer; `{slug}` names the peer. */
export const PEER_READONLY_HINT =
  "↳ read-only peer · {slug} · steer from the master";

/**
 * The slug of the peer whose native Session id equals `sessionId`, else null.
 * Membership is by exact identity — the same identity-set rule the TUI uses.
 */
export function peerReadonlySlug(
  rows: readonly PeerReadonlyRow[],
  sessionId: string | null | undefined,
): string | null {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  for (const row of rows) {
    if (row.identity === sessionId) return row.slug;
  }
  return null;
}
