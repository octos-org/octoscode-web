import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

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

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const token = "tab-scoped-e2e-token";

const composer = (page: Page) => page.locator(".composer textarea");
const hint = (page: Page) => page.locator(".composer p.peer-readonly-composer");
// CSS (not role) — survives routing that hides ancestors from the a11y tree.
const productNavigation = (page: Page) =>
  page.locator('aside[aria-label="Product navigation"]');
const sessionRows = (page: Page) =>
  productNavigation(page).locator('button[role="treeitem"]');

type Frame = { method?: string; params?: Record<string, unknown> };
function wire(page: Page) {
  const sent: Frame[] = [];
  const received: Frame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Frame;
      if (frame.method) sent.push(frame);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Frame;
      if (frame.method) received.push(frame);
    });
  });
  return {
    sent,
    received,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
  };
}

/** Keyboard-only connect: fill fields, activate every control with Enter. */
async function connectAndStartWorkspace(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Auth token").fill(token);
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .press("Enter");
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).press("Enter");
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(`/srv/work/${workspace}`);
  await add
    .getByRole("button", { name: "Add & Start", exact: true })
    .press("Enter");
  await expect(composer(page)).toBeEnabled();
}

async function heldTurn(request: APIRequestContext, owner: string) {
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(`${origin}/__test__/terminal/state`)
      ).json()) as { held: { session_id: string }[] };
      return state.held.map((item) => item.session_id);
    })
    .toContain(owner);
}

test.afterEach(async ({ request }) => {
  await request.post(`${origin}/__test__/terminal/reset`);
  await request.post(`${origin}/__test__/peers/reset`);
});

test("focused peer shows the read-only composer and Esc never leaks", async ({
  page,
  request,
}) => {
  const w = wire(page);
  await connectAndStartWorkspace(page, "peer-readonly-composer");
  const masterId = String(w.calls("session/open")[0]!.params!.session_id!);
  const masterTitle = await sessionRows(page)
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();

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
        new Set(
          w.received
            .filter((f) => f.method === "peer/staged")
            .map((f) => String(f.params?.slug)),
        ).size,
    )
    .toBe(1);
  await dialog
    .getByRole("button", { name: "Close peers", exact: true })
    .press("Enter");
  await expect(dialog).toHaveCount(0);

  const staged = w.received.find((f) => f.method === "peer/staged")!.params!;
  const slug = String(staged.slug);
  const peerId = `${String(staged.profile_id)}:local:tui#${String(staged.topic)}`;
  // The peer Session row title is `Session <last-8-of-slug>` (repo precedent
  // capacity-and-peers.spec.ts:285-288).
  const peerRow = sessionRows(page).filter({
    hasText: `Session ${slug.slice(-8)}`,
  });
  await expect(peerRow).toHaveCount(1);

  // Focus the peer's Session by keyboard: Enter -> onSelect -> local switch.
  await peerRow.focus();
  await peerRow.press("Enter");
  await expect(peerRow).toHaveAttribute("aria-current", "page");

  // 1. The textarea is disabled on the peer surface (ComposerInput.tsx:114).
  await expect(composer(page)).toBeDisabled();
  // 2. The role="status" row shows the en.yml:171 hint, naming the slug
  //    (ComposerInput.tsx:237-241; peer-readonly.ts:16-18).
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toContainText("read-only peer");
  await expect(hint(page)).toContainText(slug.slice(-8));
  // 3. Keyboard focus is not lost to <body>: the activated row keeps it.
  await expect(peerRow).toBeFocused();
  expect(peerId).toBe(String(staged.profile_id) + ":local:tui#" + String(staged.topic));

  // 4a. Peer surface is interrupt-inert: Esc sends NO turn/interrupt
  //     (a11y review 0800 §1 — the disabled composer's Esc path never fires;
  //      interrupt authority stays master-side, TUI app/render.rs:1699-1708).
  await page.keyboard.press("Escape");
  expect(w.calls("turn/interrupt")).toHaveLength(0);

  // 5. Switching back to the master re-enables the composer.
  const master = sessionRows(page).filter({ hasText: masterTitle! });
  await master.focus();
  await master.press("Enter");
  await expect(master).toHaveAttribute("aria-current", "page");
  await expect(composer(page)).toBeEnabled();
  await expect(hint(page)).toHaveCount(0);

  // 4b. Esc DOES reach the interrupt path when a turn is live and the master
  //     authority surface holds focus (the path is intact, not global-struck).
  expect(
    (await request.post(`${origin}/__test__/terminal/hold-next`)).status(),
  ).toBe(204);
  await composer(page).fill("Live master turn for Esc");
  await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .press("Enter");
  await heldTurn(request, masterId);
  await composer(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => w.calls("turn/interrupt").length).toBe(1);
  expect(w.calls("turn/interrupt")[0]!.params).toMatchObject({
    session_id: masterId,
  });
  expect(
    (
      await request.post(
        `${origin}/__test__/terminal/release?session_id=${encodeURIComponent(masterId)}`,
      )
    ).status(),
  ).toBe(204);
});