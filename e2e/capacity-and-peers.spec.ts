import { expect, test } from "@playwright/test";
import { disconnect, holdTerminals } from "./fixture-controls";
import { FIXTURE_ORIGIN, connectAndStartWorkspace } from "./fixture-session.ts";
import {
  newSessionIn,
  productNavigation,
  selectSession,
  selectedSessionId,
  sendPrompt,
  sessionRow,
} from "./sessions";
import { observeFrames, observeTransports } from "./turn-observers";

const SLOW_PREFIX = "Continue this turn while I open another Session";
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";
const BROWSER_TURNS = 12;
const PEER_COUNT = 3;

test("holds twelve browser turns and three browser-started native peers on one pooled socket", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = "/srv/work/twelve-plus-peers";
  const protocol = observeFrames(page);
  const transports = observeTransports(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await holdTerminals(request, BROWSER_TURNS + PEER_COUNT);
  try {
    await connectAndStartWorkspace(page, cwd);
    const sidebar = productNavigation(page);
    // v0.10.0 renders the workspace tree item as a <div role="treeitem">
    // (it was a <section> before). Match the ARIA role, not the tag.
    const workspace = sidebar.locator(
      '[data-workspace-name="twelve-plus-peers"]',
    );
    const sessionByMarker = new Map<string, string>();
    const starts = () => protocol.calls("turn/start");
    for (let index = 0; index < BROWSER_TURNS; index += 1) {
      const marker = SLOW_PREFIX + " twelve-" + index + "-marker";
      await sendPrompt(page, marker);
      await expect.poll(() => starts().length).toBe(index + 1);
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toBeVisible();
      sessionByMarker.set(marker, await selectedSessionId(sidebar));
      await newSessionIn(sidebar, "twelve-plus-peers");
      const showMore = workspace.locator('button[class*="showMore"]');
      if (await showMore.isVisible()) await showMore.click();
      await expect(
        sidebar.locator('[role="treeitem"][data-session-id]'),
      ).toHaveCount(index + 2);
    }
    const masterTitle = await selectedSessionId(sidebar);
    const masterOpen = protocol.calls("session/open").at(-1)!;
    await sendPrompt(page, "/peer");
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
    await expect.poll(() => protocol.calls("peer/prepare").length).toBe(1);
    const prepared = protocol.calls("peer/prepare")[0]!;
    expect(prepared.params).toMatchObject({
      session_id: masterOpen.params!.session_id,
      n: PEER_COUNT,
    });
    const events = protocol.events("peer/staged");
    const peers = [
      ...new Map(
        events.map((frame) => [frame.params!.topic, frame.params!]),
      ).values(),
    ];
    expect(peers).toHaveLength(PEER_COUNT);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const peer of peers) {
      expect(peer.session_id).toBe(masterOpen.params!.session_id);
      expect(peer.profile_id).toBe(masterOpen.params!.profile_id);
      const peerId =
        String(peer.profile_id) + ":local:tui#" + String(peer.topic);
      const opens = protocol
        .calls("session/open")
        .filter((frame) => frame.params?.session_id === peerId);
      expect(opens).toHaveLength(1);
      expect(opens[0]!.params).toMatchObject({
        profile_id: peer.profile_id,
        cwd: peer.cwd,
      });
      const kicks = starts().filter(
        (frame) => frame.params?.session_id === peerId,
      );
      expect(kicks).toHaveLength(1);
      expect(kicks[0]!.params!.turn_id).toMatch(uuid);
      expect(kicks[0]!.params!.input).toEqual([
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
    expect(transports.live()).toBe(1);
    expect(new Set(starts().map((frame) => frame.socket))).toEqual(
      new Set([masterOpen.socket]),
    );
    expect(new Set(starts().map((frame) => frame.params!.turn_id)).size).toBe(
      15,
    );
    // Every start reached the server and is still running there.
    const state = (await (
      await request.get(FIXTURE_ORIGIN + "/__test__/diagnostics/state")
    ).json()) as {
      activeBySession: Record<string, { workspace_root: string } | null>;
    };
    expect(
      Object.values(state.activeBySession).filter(
        (active) => active?.workspace_root === cwd,
      ),
    ).toHaveLength(15);
    await dialog
      .locator("button")
      .filter({ hasText: /^Close peers$/ })
      .click();
    await expect(sessionRow(sidebar, masterTitle)).toHaveAttribute(
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
          protocol
            .events("projection/envelope")
            .filter((frame) => frame.params?.payload?.type === "turn_terminal")
            .length,
      )
      .toBe(15);
    for (const [marker, title] of sessionByMarker) {
      await selectSession(sidebar, title);
      await expect(page.getByText(marker, { exact: true })).toHaveCount(1);
      await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    }
    expect(starts()).toHaveLength(15);
    expect(protocol.calls("turn/interrupt")).toEqual([]);

    // Closing the selected native peer retains its transcript and focus. It
    // is a read-only tombstone, not a resumable background execution record.
    const peer = peers[0]!;
    const peerId = String(peer.profile_id) + ":local:tui#" + String(peer.topic);
    const peerRow = page.locator(
      `button[data-peer-slug="${String(peer.slug)}"]`,
    );
    await peerRow.click();
    await expect(peerRow).toBeVisible();
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
    await expect(peerRow).toBeVisible();
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    await expect(page.locator(".composer textarea")).toHaveCount(0);
    await expect(page.locator('h1:text-is("Connect to Octos")')).toHaveCount(0);
    const opensBeforeLoss = protocol.calls("session/open").length;
    await disconnect(request);
    // The other fifteen retained records recover; the closed peer never opens
    // again and no admitted kickoff UUID is replayed.
    await expect
      .poll(() => protocol.calls("session/open").length, { timeout: 30_000 })
      .toBe(opensBeforeLoss + 15);
    expect(
      protocol
        .calls("session/open")
        .filter((frame) => frame.params?.session_id === peerId),
    ).toHaveLength(1);
    expect(starts()).toHaveLength(15);
    await expect(peerRow).toBeVisible();
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
    await expect(page.locator(".composer textarea")).toHaveCount(0);
  } finally {
    await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  }
});
