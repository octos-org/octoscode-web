import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const SLOW_PREFIX = "Continue this turn while I open another Session";
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";
const BROWSER_TURNS = 12;
const PEER_COUNT = 3;

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

async function selectedSessionTitle(sidebar: Locator): Promise<string> {
  const title = await sidebar
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!title) throw new Error("Expected a selected Session title");
  return title;
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator('button[role="treeitem"]').filter({ hasText: title });
}

async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Add & Start" }).click();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
}

interface ProtocolFrame {
  socket: number;
  method: string;
  params: Record<string, unknown>;
}
function observeProtocol(page: Page) {
  const sent: ProtocolFrame[] = [];
  const received: ProtocolFrame[] = [];
  const openSockets = new Set<number>();
  let sequence = 0;
  page.on("websocket", (socket) => {
    const id = ++sequence;
    openSockets.add(id);
    socket.on("close", () => openSockets.delete(id));
    const capture = (target: ProtocolFrame[], payload: string | Buffer) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      if (frame.method)
        target.push({
          socket: id,
          method: frame.method,
          params: frame.params ?? {},
        });
    };
    socket.on("framesent", ({ payload }) => capture(sent, payload));
    socket.on("framereceived", ({ payload }) => capture(received, payload));
  });
  return { sent, received, openSockets };
}
test("holds twelve browser turns and three browser-started native peers on one pooled socket", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = "/srv/work/twelve-plus-peers";
  const protocol = observeProtocol(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  for (let index = 0; index < BROWSER_TURNS + PEER_COUNT; index += 1) {
    expect(
      (
        await request.post(FIXTURE_ORIGIN + "/__test__/terminal/hold-next")
      ).status(),
    ).toBe(204);
  }
  try {
    await connectAndStartWorkspace(page, cwd);
    const sidebar = productNavigation(page);
    const workspace = sidebar.locator(
      'section[role="treeitem"][aria-label="twelve-plus-peers"]',
    );
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    const sessionByMarker = new Map<string, string>();
    const starts = () =>
      protocol.sent.filter((frame) => frame.method === "turn/start");
    for (let index = 0; index < BROWSER_TURNS; index += 1) {
      const marker = SLOW_PREFIX + " twelve-" + index + "-marker";
      await composer.fill(marker);
      await page
        .getByRole("button", { name: "Send prompt", exact: true })
        .click();
      await expect.poll(() => starts().length).toBe(index + 1);
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toBeVisible();
      const runningTitle = await selectedSessionTitle(sidebar);
      sessionByMarker.set(marker, runningTitle);
      await workspace
        .locator('button[class*="workspaceToggle"]')
        .hover();
      await sidebar
        .locator('button[aria-label="New session in twelve-plus-peers"]')
        .click();
      await expect(
        sidebar.locator('button[role="treeitem"][aria-current="page"]'),
      ).not.toContainText(runningTitle);
      const showMore = workspace.locator('button[class*="showMore"]');
      if (await showMore.isVisible()) await showMore.click();
      await expect(
        sidebar
          .locator('button[role="treeitem"]')
          .filter({ hasText: /Session / }),
      ).toHaveCount(index + 2);
    }
    const masterTitle = await selectedSessionTitle(sidebar);
    const masterOpen = protocol.sent
      .filter((frame) => frame.method === "session/open")
      .at(-1)!;
    await composer.fill("/peer");
    await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Session peers",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Peer brief", { exact: true })
      .fill("Verify native peer fixture capacity");
    await dialog
      .getByRole("spinbutton", { name: "Peers", exact: true })
      .fill(String(PEER_COUNT));
    await dialog
      .getByRole("button", { name: "Start peers", exact: true })
      .click();
    await expect.poll(() => starts().length).toBe(BROWSER_TURNS + PEER_COUNT);
    await expect(
      dialog.getByRole("list", { name: "Session peers" }).getByRole("listitem"),
    ).toHaveCount(PEER_COUNT);
    await expect
      .poll(
        () =>
          protocol.sent.filter((frame) => frame.method === "peer/prepare")
            .length,
      )
      .toBe(1);
    const prepared = protocol.sent.find(
      (frame) => frame.method === "peer/prepare",
    )!;
    expect(prepared.params).toMatchObject({
      session_id: masterOpen.params.session_id,
      n: PEER_COUNT,
    });
    const events = protocol.received.filter(
      (frame) => frame.method === "peer/staged",
    );
    const peers = [
      ...new Map(
        events.map((frame) => [frame.params.topic, frame.params]),
      ).values(),
    ];
    expect(peers).toHaveLength(PEER_COUNT);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const peer of peers) {
      expect(peer.session_id).toBe(masterOpen.params.session_id);
      expect(peer.profile_id).toBe(masterOpen.params.profile_id);
      const peerId =
        String(peer.profile_id) + ":local:tui#" + String(peer.topic);
      const opens = protocol.sent.filter(
        (frame) =>
          frame.method === "session/open" && frame.params.session_id === peerId,
      );
      expect(opens).toHaveLength(1);
      expect(opens[0]!.params).toMatchObject({
        profile_id: peer.profile_id,
        cwd: peer.cwd,
      });
      const kicks = starts().filter(
        (frame) => frame.params.session_id === peerId,
      );
      expect(kicks).toHaveLength(1);
      expect(kicks[0]!.params.turn_id).toMatch(uuid);
      expect(kicks[0]!.params.input).toEqual([
        {
          kind: "text",
          text:
            "You are a peer agent. Your brief:\n\nVerify native peer fixture capacity\n\n(The durable copy of this brief is at " +
            String(peer.brief_path) +
            " — re-read it if your context is compacted.)",
        },
      ]);
      expect(kicks[0]!.socket).toBe(masterOpen.socket);
      expect(opens[0]!.socket).toBe(masterOpen.socket);
    }
    expect(protocol.openSockets.size).toBe(1);
    expect(new Set(starts().map((frame) => frame.socket))).toEqual(
      new Set([masterOpen.socket]),
    );
    expect(new Set(starts().map((frame) => frame.params.turn_id)).size).toBe(
      15,
    );
    const diagnostics = await request.get(
      FIXTURE_ORIGIN + "/__test__/diagnostics/state",
    );
    const state = (await diagnostics.json()) as {
      activeBySession: Record<
        string,
        { turn_id: string; owner: string; workspace_root: string } | null
      >;
    };
    for (const turn of starts()) {
      expect(
        state.activeBySession[String(turn.params.session_id)],
      ).toMatchObject({
        turn_id: turn.params.turn_id,
        owner: "socket",
        workspace_root: cwd,
      });
    }
    expect(
      Object.values(state.activeBySession).filter(
        (active) => active?.workspace_root === cwd,
      ),
    ).toHaveLength(15);
    await dialog
      .locator("button")
      .filter({ hasText: /^Close peers$/ })
      .click();
    await expect(sessionRowByTitle(sidebar, masterTitle)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      (
        await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset")
      ).status(),
    ).toBe(204);
    await expect
      .poll(
        () =>
          protocol.received.filter(
            (frame) =>
              frame.method === "projection/envelope" &&
              (frame.params.payload as { type?: string }).type ===
                "turn_terminal",
          ).length,
      )
      .toBe(15);
    for (const [marker, title] of sessionByMarker) {
      const target = sessionRowByTitle(sidebar, title);
      await target.click();
      await expect(target).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(marker, { exact: true })).toHaveCount(1);
      await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    }
    expect(starts()).toHaveLength(15);
    expect(
      protocol.sent.filter((frame) => frame.method === "turn/interrupt"),
    ).toEqual([]);

    // Closing the selected native peer retains its transcript and focus. It
    // is a read-only tombstone, not a resumable background execution record.
    const peer = peers[0]!;
    const peerId = String(peer.profile_id) + ":local:tui#" + String(peer.topic);
    const peerRow = sessionRowByTitle(
      sidebar,
      "Session " + String(peer.slug).slice(-8),
    );
    await peerRow.click();
    await expect(peerRow).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    expect(
      (
        await request.post(
          FIXTURE_ORIGIN +
            "/__test__/peers/close?session_id=" +
            encodeURIComponent(peerId),
        )
      ).status(),
    ).toBe(204);
    await expect(
      page.getByText(
        "This peer Session is closed. Its transcript is retained; choose another Session to continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(peerRow).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    await expect(page.locator(".composer textarea")).toBeDisabled();
    await expect(
      page.locator('h1:text-is("Connect to Octos")'),
    ).toHaveCount(0);
    const opensBeforeLoss = protocol.sent.filter(
      (frame) => frame.method === "session/open",
    ).length;
    expect(
      (await request.post(FIXTURE_ORIGIN + "/__test__/disconnect")).status(),
    ).toBe(204);
    // The other fifteen retained records recover; the closed peer never opens
    // again and no admitted kickoff UUID is replayed.
    await expect
      .poll(
        () =>
          protocol.sent.filter((frame) => frame.method === "session/open")
            .length,
        { timeout: 30_000 },
      )
      .toBe(opensBeforeLoss + 15);
    expect(
      protocol.sent.filter(
        (frame) =>
          frame.method === "session/open" && frame.params.session_id === peerId,
      ),
    ).toHaveLength(1);
    expect(starts()).toHaveLength(15);
    await expect(peerRow).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    await expect(page.locator(".composer textarea")).toBeDisabled();
  } finally {
    await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  }
});
