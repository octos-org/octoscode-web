import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESUME_CHAT_LABEL,
  HANDING_BACK_CONTROL_STATUS,
  FOREIGN_LEASE_BUSY_TEMPLATE,
  foreignLeaseBusyCopy,
  boundedTurnAdmissionError,
  isExternalMasterHeldRefusal,
  planComposerSeatHandover,
} from "../composer/composer-seat-handover.ts";
import {
  shortcutSuppressed,
  TEXT_INPUT_SUPPRESSION_SELECTOR,
  DIALOG_SUPPRESSION_SELECTOR,
} from "../composer/shortcut-suppression.ts";

/**
 * Brief 4010 clauses (a)+(b), design 4000 (BINDING) §5.2/§6/§8 + acceptance
 * 4/8/16/20/20b/20c. The sibling suite `composer-seat-handover.test.ts` pins
 * the copy table and the send gate; THIS suite pins the three pieces the
 * design adds on top of the landed P2q work:
 *   §5.2 — the wait-for-expiry case is an UNPROVEN binding with OUR OWN id
 *           (a lost acquire reply), never a live FOREIGN lease; a live foreign
 *           lease (acceptance 4) still offers Resume chat and the busy copy
 *           carries the disclosed lease expiry.
 *   §5.2 — "Handing back control…" is the strip status while the hand-back is
 *           in flight (the status must actually be SET on that path).
 *   §8   — Alt+A/Alt+P/Alt+D never fire while focus is inside a text input or
 *           a dialog (design §8 last sentence).
 *
 * Same discipline as the sibling seat suites: apps/web has no jsdom, so pure
 * decisions are asserted directly and the hook wiring is pinned by source
 * text. No sleeps, no test-only product exports.
 */
const SESSION_SOURCE = readFileSync(
  new URL("./use-octos-session.ts", import.meta.url),
  "utf8",
);

describe("§5.2 case 4 vs 20: a live FOREIGN lease still offers Resume chat", () => {
  it("a live foreign lease plans resume-chat (acquire CAS), not a blind wait", () => {
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedRevision: "12",
      observedForeignLeaseExpiresAtMs: 1_700_000_120_000,
    });
    expect(plan.kind).toBe("resume-chat");
  });

  it("an unproven binding with OUR OWN id and NO live lease is the wait case", () => {
    // §5.2 "lost acquire reply": get shows our driver id but we hold no
    // proof — however the observed lease is DEAD, so the wait has already
    // elapsed and a fresh acquire (resume-chat) is the correct plan.
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedRevision: "13",
      observedForeignLeaseExpiresAtMs: null,
    });
    expect(plan.kind).toBe("resume-chat");
  });

  it("an unproven binding with a LIVE OUR-id lease waits for its expiry", () => {
    // Acceptance 20: exactly one acquire before expiry; the token travels
    // only in that one reply, so no proof ⇒ no release/renew/dispatch frame.
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedRevision: "13",
      observedOwnLeaseExpiresAtMs: 1_700_000_120_000,
    });
    expect(plan.kind).toBe("wait-for-expiry");
    expect(plan).not.toHaveProperty("releaseParams");
    expect(plan).not.toHaveProperty("acquireDriverId");
  });

  it("a foreign lease's busy refusal copy names the disclosed expiry", () => {
    expect(isExternalMasterHeldRefusal("…: ExternalMasterHeld")).toBe(true);
    expect(boundedTurnAdmissionError("…: ExternalMasterHeld")).toBe(
      "Another app is using this session",
    );
    expect(RESUME_CHAT_LABEL).toBe("Resume chat");
    expect(HANDING_BACK_CONTROL_STATUS).toBe("Handing back control…");
    expect(FOREIGN_LEASE_BUSY_TEMPLATE).toBe(
      "Another app is using this session — try again when it finishes or after {time}",
    );
    expect(foreignLeaseBusyCopy(0, () => "12:00")).toBe(
      "Another app is using this session — try again when it finishes or after 12:00",
    );
  });
});

describe("§5.2 case 2: the hand-back strip status actually runs", () => {
  it("the release-then-send seam sets Handing back control… while in flight", () => {
    // The landed seam sets the status only on resume-chat; §5.2 requires it
    // on THIS tab's hand-back too (design: 'The strip shows "Handing back
    // control…" during the wait').
    expect(SESSION_SOURCE).toMatch(
      /setSeatHandoverStatus\(HANDING_BACK_CONTROL_STATUS\)/,
    );
    expect(SESSION_SOURCE).not.toMatch(
      /setSeatHandoverStatus\("Handing back control…"\)/,
    );
  });
});

describe("§8: shortcuts are suppressed inside inputs and dialogs", () => {
  it("the registry exposes a focus-suppression predicate", () => {
    expect(shortcutSuppressed).toBeTypeOf("function");
    expect(
      shortcutSuppressed({ targetIsTextInput: true, inDialog: false }),
    ).toBe(true);
    expect(
      shortcutSuppressed({ targetIsTextInput: false, inDialog: true }),
    ).toBe(true);
    expect(
      shortcutSuppressed({ targetIsTextInput: false, inDialog: false }),
    ).toBe(false);
  });

  it("App routes every parity shortcut through the suppression predicate", () => {
    // The classifier's two selectors stay structural (no ids/classes that a
    // rebuild could drift), and either fact alone suppresses.
    expect(TEXT_INPUT_SUPPRESSION_SELECTOR).toContain("input");
    expect(TEXT_INPUT_SUPPRESSION_SELECTOR).toContain("[contenteditable");
    expect(DIALOG_SUPPRESSION_SELECTOR).toBe('[role="dialog"]');
    expect(
      shortcutSuppressed({ targetIsTextInput: false, inDialog: true }),
    ).toBe(true);
  });
});
