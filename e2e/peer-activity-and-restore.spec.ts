import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  COMPOSER_PLACEHOLDER,
  FIXTURE_ORIGIN,
  connectAndStartWorkspace,
  runFolder,
} from "./fixture-session.ts";

/**
 * e2e — peer activity glyphs from REAL peer Session frames + per-session
 * interrupt-prompt restore (brief C/DEEPSEEK-E2E-ACTIVITY-AND-RESTORE-SPEC-1545;
 * gaps 5/9 landed in C/evidence/native-deepseek-web-gaps-5-9-composer-1150.md).
 * Fixture producers added under brief 2320.
 *
 * Gaps wired under test:
 *   (b) `SessionPeerCoordinator.observeNotification` maps a PEER's own Session
 *       frames (turn/started, approval/requested, approval/decided,
 *       turn/completed|error) onto the dock row -> activity `live` / `blocked`
 *       / `done` (session-peer-coordinator.ts:134-176, :405-420).
 *   (c) composer `onInterruptPromptRestore` (use-turn-controller.ts:39/:378)
 *       parks the interrupted prompt on the OWNING record by `scope.sessionId`
 *       (never the selected session) and drains it once (session-composer-drafts
 *       `#restores`; use-octos-session.ts:683+).
 *
 * Drive paths are the PRODUCT's, never a test hook:
 *   • staging = `/peer` composer command -> `Session peers` dialog -> `Peers`
 *     spinbutton -> `Start peers` (matches capacity-and-peers.spec.ts:153,
 *     command-surface.spec.ts:511). There is NO `window.octos.preparePeers`
 *     bridge anywhere in product or fixture.
 *   • `peer/prepare` answers with one `peer/staged` per peer
 *     (mock-ui-server.mjs:3344-3356); the dock row's `data-activity` /
 *     `data-peer-slug` hooks live at PeerDock.tsx:244-256.
 *   • activity producers (mock-ui-server.mjs `emitPeerActivityFrame`): a ROOT
 *     composer text `Peer turn|approval|resolve|complete fixture <slug>` emits
 *     that peer Session's OWN frame on the shared owner socket — `turn/started`
 *     -> live, `approval/requested` -> blocked, `approval/decided` -> clears the
 *     block, `turn/completed` -> done.
 *
 * The dock's whole life is ONE user chain (it absorbed peer-dock.spec.ts):
 * hidden with no peers -> two staged idle rows -> a peer turn goes live -> its
 * approval blocks the row while approval actions stay fail-closed -> the
 * resolution clears it -> the turn lands done beside a live sibling ->
 * `/peer clear` prunes only the done row. The collapsed "N/N landed" pill is
 * not threaded into the live app (ProductSidebar.tsx:744), so it is not
 * asserted here; `formatPeerDockPill` covers its copy.
 */

const PEER_COUNT = 2;
const PEER_BRIEF = "Peer activity and restore triage";
/** The fixture accepts any `/srv/work/*` path and opens a Session for it. */
const CWD = "/srv/work/peer-activity-restore";
const WORKSPACE = "peer-activity-restore";

const productNavigation = (page: Page): Locator => page.locator("aside");
const peerDock = (page: Page): Locator =>
  productNavigation(page).locator('section[role="region"][aria-label="Peers"]');
const dockRow = (page: Page, slug: string): Locator =>
  peerDock(page).locator(`button[data-peer-slug="${slug}"]`);
/** The row's activity lives on the aria-hidden glyph span (PeerDock.tsx:252). */
const dockActivity = (page: Page, slug: string): Locator =>
  dockRow(page, slug).locator("[data-activity]");
const composer = (page: Page): Locator =>
  page.getByPlaceholder(COMPOSER_PLACEHOLDER);

interface Observed {
  staged: Record<string, unknown>[];
  sentMethods: string[];
}
/** Records `peer/staged` receipts and every outbound RPC method name. */
function observe(page: Page): Observed {
  const observed: Observed = { staged: [], sentMethods: [] };
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      if (frame.method === "peer/staged" && frame.params)
        observed.staged.push(frame.params);
    });
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as { method?: string };
      if (frame.method) observed.sentMethods.push(frame.method);
    });
  });
  return observed;
}

/** Stage `PEER_COUNT` peers through the REAL `/peer` dialog and await the rows. */
async function stagePeers(page: Page, observed: Observed): Promise<string[]> {
  await composer(page).fill("/peer");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Peer brief", { exact: true }).fill(PEER_BRIEF);
  await dialog
    .getByRole("spinbutton", { name: "Peers", exact: true })
    .fill(String(PEER_COUNT));
  await dialog
    .getByRole("button", { name: "Start peers", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Close peers", exact: true })
    .click();
  await expect(dialog).toBeHidden();

  // The fixture replays every `peer/staged` (mock-ui-server.mjs:3344-3345), so
  // count DISTINCT slugs — the product contract — never raw frames.
  await expect
    .poll(() => new Set(observed.staged.map((p) => String(p.slug))).size)
    .toBe(PEER_COUNT);
  const slugs = [...new Set(observed.staged.map((p) => String(p.slug)))];
  for (const slug of slugs) await expect(dockRow(page, slug)).toBeVisible();
  return slugs;
}

/** The first staged slug. `PEER_COUNT >= 1` guarantees one exists; throwing
 * keeps a mis-staged fixture from flowing `undefined` into a locator. */
function firstSlug(slugs: string[]): string {
  const slug = slugs[0];
  if (slug === undefined) throw new Error("the fixture staged no peer");
  return slug;
}

/**
 * Send one ROOT-composer prompt and let the fixture's turn seed its peer frame.
 * The button is `Send prompt` while idle and `Queue prompt` while a turn runs;
 * a queued trigger still fires when its turn actually starts, and the callers'
 * `toHaveAttribute` assertions auto-retry across that delay.
 */
async function sendPrompt(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page
    .getByRole("button", { name: /^(Send|Queue) prompt$/, exact: false })
    .click();
}

/** Drive one peer row to `live` through the fixture's `turn/started` producer. */
async function startPeerTurn(page: Page, slug: string): Promise<void> {
  await sendPrompt(page, `Peer turn fixture ${slug}`);
  await expect(dockActivity(page, slug)).toHaveAttribute(
    "data-activity",
    "live",
  );
}

test.describe("the peer dock follows each peer's own Session", () => {
  test("rows go idle -> live -> blocked -> live -> done, approvals stay fail-closed, /peer clear prunes the done row", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    try {
      await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
      const observed = observe(page);
      await connectAndStartWorkspace(page, runFolder("peer-dock"));

      // Hidden with no peers: `PeerDock.tsx:197-199` returns null for a null
      // OR empty roster, so neither the region nor a row exists yet.
      await expect(peerDock(page)).toHaveCount(0);

      const slugs = await stagePeers(page, observed);
      const [primary, sibling] = [
        firstSlug(slugs),
        slugs[1] ?? firstSlug(slugs),
      ];
      // The browser really drove `peer/prepare` (no fabricated counter), and
      // each real slug is both the visible name and accessible-name prefix.
      expect(observed.sentMethods).toContain("peer/prepare");
      for (const slug of slugs) {
        await expect(dockActivity(page, slug)).toHaveAttribute(
          "data-activity",
          "idle",
        );
        await expect(dockRow(page, slug)).toHaveAccessibleName(
          new RegExp(`^${slug} idle`),
        );
      }

      // `turn/started` on the peer's OWN Session -> the row goes live.
      await startPeerTurn(page, primary);
      const row = dockRow(page, primary);
      await expect(row).toHaveAccessibleName(
        new RegExp(`^${primary} streaming`),
      );

      // `approval/requested` on the peer's OWN Session -> blocked + `⚠ needs you`.
      await sendPrompt(page, `Peer approval fixture ${primary}`);
      await expect(dockActivity(page, primary)).toHaveAttribute(
        "data-activity",
        "blocked",
      );
      await expect(row).toHaveAccessibleName(/needs you/);

      // UX4-4020: App DOES thread `onApprovalRespond` now (App.tsx:1491 ->
      // peers.approvalRespond), but the sink exists ONLY while a control seat is
      // acquired (`...(controlAcquire === null ? {} : { approvalRespond })`),
      // and THIS workspace advertises no session/driver methods — so no acquire,
      // no sink, and the dock still renders no row actions (fail-closed as
      // designed). Alt+Y must stay inert here; the positive path lives in
      // peer-control.spec.ts / peer-controller.spec.ts on `peer-control-*`.
      await expect(peerDock(page).locator("[data-row-action]")).toHaveCount(0);
      await row.focus();
      await expect(row).toBeFocused();
      await row.press("Alt+KeyY");
      await expect(dockActivity(page, primary)).toHaveAttribute(
        "data-activity",
        "blocked",
      );
      await expect(peerDock(page).locator("[data-row-action]")).toHaveCount(0);
      // Answering a row is a no-op, so focus stays on the still-mounted row.
      await expect(row).toBeFocused();
      expect(observed.sentMethods).not.toContain("peer/control");

      // The block clears on the peer's OWN resolution frame (`approval/decided`),
      // which the coordinator folds as `attention-resolved` -> back to live.
      await sendPrompt(page, `Peer resolve fixture ${primary}`);
      await expect(dockActivity(page, primary)).toHaveAttribute(
        "data-activity",
        "live",
      );

      // A second live peer: the one that must survive the prune.
      await startPeerTurn(page, sibling);

      // `turn/completed` on the peer's OWN Session -> that row lands `done`,
      // and the sibling stays live.
      await sendPrompt(page, `Peer complete fixture ${primary}`);
      await expect(dockActivity(page, primary)).toHaveAttribute(
        "data-activity",
        "done",
      );
      await expect(dockRow(page, primary)).toHaveAccessibleName(
        new RegExp(`^${primary} done`),
      );
      await expect(dockActivity(page, sibling)).toHaveAttribute(
        "data-activity",
        "live",
      );

      // `/peer clear` (brief 2600; TUI `clear_finished_peers` store.rs:1012-1043)
      // is a CLIENT-side prune of the ACTIVE session's FINISHED rows only.
      await sendPrompt(page, "/peer clear");
      await expect
        .poll(() => dockRow(page, primary).count(), { timeout: 15_000 })
        .toBe(0);
      await expect(dockRow(page, sibling)).toHaveCount(1);
      await expect(dockActivity(page, sibling)).toHaveAttribute(
        "data-activity",
        "live",
      );
      // The count lands in the composer's polite live region, in the exact
      // `peerClearAnnouncement(1)` wording (singular "peer").
      await expect(
        page.getByRole("status").filter({ hasText: "1 finished peer cleared" }),
      ).toHaveCount(1);
    } finally {
      await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
      await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
    }
  });
});

test.describe("per-session interrupt-prompt restore", () => {
  test("a draft is restored only in the session that owned the interrupted turn", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await connectAndStartWorkspace(page, CWD);
    const draft = "keep-me-draft";

    // Session A: send a draft, then interrupt A's live turn via the product's
    // own stop control (TurnStopButton; accessible name Interrupt|Stop).
    const navigation = productNavigation(page);
    const selectedSession = navigation.locator(
      '[role="treeitem"][data-session-id][aria-current="page"]',
    );
    const sessionAId = await selectedSession.getAttribute("data-session-id");
    if (!sessionAId) throw new Error("workspace start opened no Session");
    await composer(page).fill(draft);
    await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .click();
    await page.getByRole("button", { name: /^(Interrupt|Stop)$/ }).click();

    // The interrupted prompt is parked back on A's OWNING record.
    await expect(composer(page)).toHaveValue(draft);

    // Open a sibling Session B under the SAME workspace (native-workflows.spec
    // `sibling`, :90-101): hover the workspace row, then `New session in …`.
    // B has its OWN composer record, so A's draft must NOT leak into it.
    const workspaceRow = navigation.locator(
      `[data-workspace-name=${JSON.stringify(WORKSPACE)}]`,
    );
    await workspaceRow
      .getByRole("button", { name: WORKSPACE, exact: true })
      .hover();
    await navigation
      .getByRole("button", { name: `New session in ${WORKSPACE}` })
      .click();
    await expect
      .poll(() => selectedSession.getAttribute("data-session-id"))
      .not.toBe(sessionAId);
    const sessionBId = await selectedSession.getAttribute("data-session-id");
    if (!sessionBId) throw new Error("sibling action opened no Session");
    await expect(
      navigation.locator(
        `[role="treeitem"][data-session-id=${JSON.stringify(sessionBId)}]`,
      ),
    ).toHaveAttribute("aria-current", "page");
    await expect(composer(page)).toHaveValue("");

    // Back to A: the draft is restored exactly once.
    await navigation
      .locator(
        `[role="treeitem"][data-session-id=${JSON.stringify(sessionAId)}]`,
      )
      .click();
    await expect
      .poll(() => selectedSession.getAttribute("data-session-id"))
      .toBe(sessionAId);
    await expect(composer(page)).toHaveValue(draft);
  });
});
