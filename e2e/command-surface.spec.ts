import { expect, test, type Page } from "@playwright/test";
import { holdTerminals, releaseTerminal } from "./fixture-controls";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import {
  composer,
  newSessionIn,
  productNavigation,
  selectedSessionId,
  selectSession,
  sessionRow,
  stopButton,
} from "./sessions";
import { observeFrames } from "./turn-observers";

const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/history/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/gather/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

async function sendSlashCommand(page: Page, command: string): Promise<void> {
  await composer(page).fill(command);
  await page.getByRole("button", { name: "Send prompt" }).click();
}

/**
 * Product invariant: an unknown or unimplemented
 * command fails closed — it is never sent to the model as ordinary text and
 * never reaches turn/start.
 */
test("fails closed for an unknown command and sends no model input", async ({
  page,
}) => {
  const cwd = "/srv/work/unknown-command";
  const wire = observeFrames(page);
  await connectAndStartWorkspace(page, cwd);

  await sendSlashCommand(page, "/definitely-not-a-real-command");
  await expect(
    page.getByText("/definitely-not-a-real-command is unavailable"),
  ).toBeVisible();
  await expect(page.getByText("Nothing was sent to the model.")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  expect(wire.calls("turn/start")).toHaveLength(0);
});

test("queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only", async ({
  page,
  request,
}) => {
  const wire = observeFrames(page);
  const cwd = "/srv/work/gather-exact-owner";
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sourceOpen = wire.calls("session/open")[0]!;
  const sessionId = String(sourceOpen.params!.session_id);
  const a = sessionRow(sidebar, await selectedSessionId(sidebar));
  const brief = "Gather this exact peer receipt";
  await sendSlashCommand(page, "/peer");
  const peers = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await peers.getByLabel("Peer brief", { exact: true }).fill(brief);
  await peers.getByRole("button", { name: "Start peers", exact: true }).click();
  await expect.poll(() => wire.calls("turn/start").length).toBe(1);
  const staged = wire.events("peer/staged")[0]!.params!;
  const slug = String(staged.slug);
  const peerId =
    String(staged.profile_id) + ":local:tui#" + String(staged.topic);
  const terminals = () =>
    wire
      .events("projection/envelope")
      .filter((frame) => frame.params?.payload?.type === "turn_terminal");
  await expect
    .poll(() =>
      terminals().some((frame) => frame.params!.session_id === peerId),
    )
    .toBe(true);
  await peers.getByRole("button", { name: "Close peers", exact: true }).click();
  await expect(a).toHaveAttribute("aria-current", "page");
  await holdTerminals(request);
  const activePrompt = "Keep A active while its gather result is in flight";
  await composer(page).fill(activePrompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(stopButton(page)).toBeVisible();
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/gather/hold-next?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await composer(page).fill("/gather " + slug);
    await page
      .getByRole("button", { name: "Queue prompt", exact: true })
      .click();
  }
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(FIXTURE_ORIGIN + "/__test__/gather/state")
          ).json()
        ).held,
    )
    .toEqual([sessionId]);
  expect(wire.calls("peer/gather")).toHaveLength(1);
  expect(wire.calls("peer/gather")[0]!.params).toEqual({
    session_id: sessionId,
    profile_id: sourceOpen.params!.profile_id,
    slugs: [slug],
  });
  const bKey = await newSessionIn(sidebar, "gather-exact-owner");
  // Two Session rows; the peer lives in the dock, not in the Session list.
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(2);
  await expect(sidebar.locator(`button[data-peer-slug="${slug}"]`)).toHaveCount(
    1,
  );
  await expect(a).not.toHaveAttribute("aria-current", "page");
  const b = sessionRow(sidebar, bKey);
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/gather/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  await a.click();
  await expect(page.getByText("1 queued", { exact: true })).toBeVisible();
  expect(wire.calls("turn/start")).toHaveLength(2);
  await selectSession(sidebar, bKey);
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByText(/Peer results gathered|Keep A active/),
  ).toHaveCount(0);
  await releaseTerminal(request, sessionId);
  await expect.poll(() => wire.calls("turn/start").length).toBe(3);
  const synthesis = wire.calls("turn/start")[2]!;
  const expected =
    "Peer results gathered from the blackboard:\n\n## peer " +
    slug +
    " (done)\nBrief: " +
    brief +
    "\n\nFixture peer completed";
  expect(synthesis.params).toMatchObject({
    session_id: sessionId,
    input: [{ kind: "text", text: expected }],
  });
  expect(synthesis.params!.turn_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect
    .poll(
      () =>
        terminals().filter((frame) => frame.params!.session_id === sessionId)
          .length,
    )
    .toBe(2);
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByText(/Peer results gathered|Keep A active/),
  ).toHaveCount(0);
  await a.click();
  await expect(page.getByText(expected, { exact: true })).toHaveCount(1);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  await sendSlashCommand(page, "/peer");
  await peers
    .getByRole("button", { name: "Refresh blackboard", exact: true })
    .click();
  await expect.poll(() => wire.calls("peer/gather").length).toBe(2);
  await expect
    .poll(() => wire.replyTo(wire.calls("peer/gather")[1]!)?.result)
    .toBeTruthy();
  expect(wire.calls("turn/start")).toHaveLength(3);
  expect(wire.calls("turn/interrupt")).toHaveLength(0);
});
