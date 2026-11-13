import { expect, test, type Page } from "@playwright/test";
import { openSessionController } from "./session-settings.ts";
import { connectAndStartWorkspace } from "./fixture-session.ts";
import { observeFrames } from "./turn-observers";

/**
 * peer/control seat semantics — SOURCE ONLY (draft, not executed), migrated to
 * the §10 surfaces by grant UX4-4020.
 *
 * The per-seat command cluster (`data-control-panel="peer"`) and the seat
 * badges that lived in the REMOVED chat control bar now exist only inside the
 * Session settings pane's Advanced section (`details.session-config-advanced`,
 * mounted by App through SessionConfigPane's `advancedChildren`). The four
 * commands keep the SAME wire contract: one `peer/control` frame per
 * activation, typed refusals bounded by the §6 label table, raw server copy
 * never rendered.
 *
 * The fail-closed negative (no-feature) is asserted on the PANE: a workspace
 * whose caps leave out `external_driver_v1` mounts NO seat panel there and
 * sends zero frames. Fleet's no-fleet variant (peer-controller.spec.ts) covers
 * a server with neither the method nor the feature.
 *
 * Fixture: the `peer-control-<variant>` family in mock-ui-server.mjs
 * (plan 0810 §1-§3). Variants: (default) accepted receipts; refused -> state
 * "refused" receipts; stale -> typed driver_fence_stale errors; duplicate ->
 * duplicate:true receipts; no-method / no-feature omit the caps.
 */
/** Wire method of the single control leaf. */
const CONTROL_METHOD = "peer/control";
/** Workspace NAME prefix; full path is `/srv/work/peer-control-<variant>`. */
const WORKSPACE_PREFIX = "peer-control-";
/** The four commands, in product order (peer-control-commands.ts). */
const COMMAND_KINDS = [
  "approval_respond",
  "question_respond",
  "steer",
  "interrupt",
] as const;
type CommandKind = (typeof COMMAND_KINDS)[number];

/**
 * The seat commands inside the pane's Advanced section. The pane is a dialog
 * named "Session settings"; Advanced is a <details> the helper opens.
 */
function pane(page: Page) {
  return page.getByRole("dialog", { name: "Session settings", exact: true });
}
function panel(page: Page) {
  return pane(page).locator('[data-control-panel="peer"]');
}
function command(page: Page, kind: CommandKind) {
  return panel(page).locator(`[data-control-command="${kind}"]`);
}
function receipt(page: Page) {
  return panel(page).locator('[data-control-state="receipt"]');
}

/**
 * Connect to the fixture and start a workspace whose synthetic variant is the
 * suffix (empty string = the accepted/default family). On advertised variants
 * the seat must be acquired through the pane's own Acquire affordance (P2q:
 * the seat is opt-in, never automatic).
 */
async function connect(
  page: Page,
  variant: string,
): Promise<{ workspace: string }> {
  const workspace = `${WORKSPACE_PREFIX}${variant}`;
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  await openSessionController(page);
  if (variant !== "no-feature") {
    // §5.2/pane: the ONLY acquisition paths are the pane/Fleet Take-control
    // affordances (Acquire seat in Advanced). Nothing auto-acquires.
    await page
      .getByRole("button", { name: "Acquire seat", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Release seat", exact: true }),
    ).toBeEnabled();
  }
  return { workspace };
}

test.describe("peer/control seat semantics (pane Advanced, synthetic fixture)", () => {
  // ------------------------------------------------ fail-closed negatives
  test("no seat panel when external_driver_v1 is unadvertised (no-feature)", async ({
    page,
  }) => {
    const w = observeFrames(page);
    await connect(page, "no-feature");
    await expect(panel(page)).toHaveCount(0);
    expect(w.calls(CONTROL_METHOD)).toHaveLength(0);
  });

  // ------------------------------------- one frame / command, accepted receipt
  test("each command, from the keyboard or a click, emits exactly ONE frame and an accepted receipt", async ({
    page,
  }) => {
    const w = observeFrames(page);
    await connect(page, "");
    await expect(
      panel(page).getByRole("group", { name: "Commands" }),
    ).toBeVisible();

    // Keyboard reach: Steer is focusable and Enter activates it once.
    const steer = command(page, "steer");
    await steer.focus();
    await expect(steer).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(1);
    await expect(receipt(page)).toBeVisible();
    // The mock mints a FIXED slug in every receipt.
    await expect(receipt(page).locator("[data-receipt-slug]")).toHaveText(
      "synthetic-peer",
    );
    await expect(
      receipt(page).locator('[data-receipt-duplicate="false"]'),
    ).toHaveText("Newly applied");
    await w.settled(w.calls(CONTROL_METHOD)[0]!);

    // The other three commands, clicked: one frame each, never a retry.
    for (const kind of COMMAND_KINDS.filter((k) => k !== "steer")) {
      const before = w.calls(CONTROL_METHOD).length;
      await command(page, kind).click();
      await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    }
    expect(w.calls(CONTROL_METHOD)).toHaveLength(COMMAND_KINDS.length);
  });
});
