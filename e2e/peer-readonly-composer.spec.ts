import { expect, test, type Page } from "@playwright/test";
import {
  holdTerminals,
  releaseTerminal,
  terminalHeld,
} from "./fixture-controls";
import { FIXTURE_ORIGIN, connectAndStartWorkspace } from "./fixture-session.ts";
import { productNavigation, sessionRow } from "./sessions";
import { observeFrames } from "./turn-observers";

/**
 * Focused peer session shows the read-only composer (audit row 7, brief 0915).
 *
 * Product: a focused PEER Session replaces the editable composer with a dim
 * status row. `ComposerInput.tsx:114` disables the textarea when
 * `peerReadonlySlug` is non-null; `:237-241` renders a `role="status"` row with
 * `PEER_READONLY_HINT` (`peer-readonly.ts:16-18`, the en.yml:171 copy).
 * Membership is by EXACT peer identity — never a `peer-` topic prefix, which
 * false-positives (`peer-readonly.ts:24-36`).
 *
 * Interrupt authority stays master-side: a11y review 0800 §1 — the disabled
 * peer composer's Esc→onInterrupt never fires. So this spec proves BOTH
 * directions of the brief's Esc clause: (a) Esc on the peer surface sends NO
 * `turn/interrupt` (no leak to the wrong Session), and (b) the interrupt path
 * still fires when a turn is live and the master authority surface holds focus.
 *
 * DELIBERATELY MOUSE-FREE (repo precedent keyboard-parity.spec.ts:23): setup
 * uses `fill` + `press("Enter")`; every navigation/activation is
 * `keyboard.press` / `.focus()`. Locators under an open modal are CSS — the
 * ModalSurface sets `aria-hidden="true"` on the `<main>` wrapping the sidebar
 * (App.tsx:1171, ModalSurface.tsx:50-60), hiding it from role queries.
 *
 * Mock fixture hooks cited (apps/web/scripts/mock-ui-server.mjs):
 *   • native-peer staging — `peer/prepare` -> one `peer/staged` per peer
 *     (`stagePeers` :512-553; dispatch :2657-2700).
 *   • `/__test__/terminal/hold-next` holds the next socket turn (:1341-1358,
 *     arm counter :509); `terminal/state` reports the held set (:1374).
 *   • `/__test__/terminal/release` / `/__test__/terminal/reset` / `/__test__/peers/reset`.
 */

const composer = (page: Page) => page.locator(".composer textarea");
const hint = (page: Page) =>
  page.locator('[role="status"][class*="peerReadonly"]');
const sessionRows = (page: Page) =>
  productNavigation(page).locator('[role="treeitem"][data-session-id]');

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
});

test("focused peer shows the read-only composer and Esc never leaks", async ({
  page,
  request,
}) => {
  const w = observeFrames(page);
  await connectAndStartWorkspace(page, "/srv/work/peer-readonly-composer");
  const masterId = String(w.calls("session/open")[0]!.params!.session_id!);
  const masterTitle = await sessionRows(page)
    .first()
    .getAttribute("data-session-id");

  // Stage ONE native peer from the master through the /peer dialog
  // (mock `peer/prepare` -> `peer/staged`; :512-553).
  await composer(page).fill("/peer");
  await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Peer brief", { exact: true })
    .fill("Read-only composer parity");
  await dialog
    .getByRole("spinbutton", { name: "Peers", exact: true })
    .fill("1");
  // Hold the peer's kickoff turn so it is still live at step 4a.
  await holdTerminals(request);
  await dialog
    .getByRole("button", { name: "Start peers", exact: true })
    .press("Enter");
  // The mock DELIBERATELY replays every `peer/staged` notification a second
  // time to prove the replay path never mints a second peer open or kickoff
  // (mock-ui-server.mjs:3205-3207, comment on :3206). So count DISTINCT staged
  // slugs — the real product contract — never the raw replayed frame count.
  await expect
    .poll(
      () =>
        new Set(w.events("peer/staged").map((f) => String(f.params?.slug)))
          .size,
    )
    .toBe(1);
  await dialog
    .getByRole("button", { name: "Close peers", exact: true })
    .press("Enter");
  await expect(dialog).toHaveCount(0);

  const staged = w.events("peer/staged")[0]!.params!;
  const slug = String(staged.slug);
  const peerId = `${String(staged.profile_id)}:local:tui#${String(staged.topic)}`;
  // A peer is not an ordinary Session row. The dock exposes its real slug and
  // opens the exact retained peer record instead of adding a second list entry.
  await expect(sessionRows(page)).toHaveCount(1);
  await expect(sessionRows(page).filter({ hasText: slug })).toHaveCount(0);
  const peerRow = page.locator(`button[data-peer-slug="${slug}"]`);
  await expect(peerRow).toContainText(slug);
  // Activated without moving focus (as assistive tech can), so the composer
  // still holds focus when it turns read-only.
  await composer(page).focus();
  await peerRow.dispatchEvent("click");

  // The peer surface replaces the editable textarea with one aligned status,
  // and focus lands on it instead of dropping to the page (a11y review 0800 §1).
  await expect(composer(page)).toHaveCount(0);
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toBeFocused();
  await expect(hint(page)).toContainText("read-only");
  await expect(hint(page)).toContainText(slug);
  await expect(
    page.getByRole("button", { name: "Send prompt", exact: true }),
  ).toHaveCount(0);

  // 4a. Peer surface is interrupt-inert: Esc sends NO turn/interrupt
  //     (a11y review 0800 §1 — the disabled composer's Esc path never fires;
  //      interrupt authority stays master-side, TUI app/render.rs:1699-1708).
  //     The peer's kickoff turn is held at the server, so a leaked Esc would
  //     have a live turn to interrupt.
  await terminalHeld(request, peerId);
  await page.keyboard.press("Escape");
  expect(w.calls("turn/interrupt")).toHaveLength(0);

  // 5. The status action returns to the actual owner master and restores input.
  const master = sessionRow(productNavigation(page), masterTitle!);
  await hint(page)
    .getByRole("button", { name: "Return to master", exact: true })
    .click();
  await expect(master).toHaveAttribute("aria-current", "page");
  await expect(composer(page)).toBeEnabled();
  await expect(composer(page)).toBeFocused();
  await expect(hint(page)).toHaveCount(0);

  // 4b. Esc DOES reach the interrupt path when a turn is live and the master
  //     authority surface holds focus (the path is intact, not global-struck).
  await holdTerminals(request);
  await composer(page).fill("Live master turn for Esc");
  await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .press("Enter");
  await terminalHeld(request, masterId);
  await composer(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => w.calls("turn/interrupt").length).toBe(1);
  expect(w.calls("turn/interrupt")[0]!.params).toMatchObject({
    session_id: masterId,
  });
  await releaseTerminal(request, masterId);
});
