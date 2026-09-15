import { describe, expect, it } from "vitest";
import {
  PEER_READONLY_HINT,
  peerReadonlySlug,
  type PeerReadonlyRow,
} from "./peer-readonly.ts";

const rows: readonly PeerReadonlyRow[] = [
  { identity: "dev:local:tui#peer-review", slug: "review" },
  { identity: "dev:local:tui#peer-audit", slug: "audit" },
];

describe("peer read-only composer predicate (audit row 7)", () => {
  it("names the peer whose native session id is in the roster", () => {
    expect(peerReadonlySlug(rows, "dev:local:tui#peer-audit")).toBe("audit");
    expect(peerReadonlySlug(rows, "dev:local:tui#peer-review")).toBe("review");
  });

  it("returns null for an ordinary session id, an empty roster, or no focus", () => {
    expect(peerReadonlySlug(rows, "dev:local:tui#ordinary")).toBeNull();
    expect(peerReadonlySlug([], "dev:local:tui#peer-review")).toBeNull();
    expect(peerReadonlySlug(rows, null)).toBeNull();
    expect(peerReadonlySlug(rows, undefined)).toBeNull();
    expect(peerReadonlySlug(rows, "")).toBeNull();
  });

  it("never matches a merely peer-prefixed identity outside the exact roster", () => {
    // Identity-set membership, not a `topic().startsWith("peer-")` string check.
    expect(
      peerReadonlySlug(rows, "dev:local:tui#peer-review-evil"),
    ).toBeNull();
  });

  it("interpolates the slug into the read-only hint", () => {
    expect(PEER_READONLY_HINT).toContain("{slug}");
  });
});
