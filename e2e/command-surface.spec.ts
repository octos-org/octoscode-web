import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/history/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/gather/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

interface ObservedRpc {
  direction: "sent" | "received";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}
function observeRpc(page: Page) {
  const frames: ObservedRpc[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      frames.push({ ...JSON.parse(String(payload)), direction: "sent" }),
    );
    socket.on("framereceived", ({ payload }) =>
      frames.push({ ...JSON.parse(String(payload)), direction: "received" }),
    );
  });
  return {
    frames,
    requests: (method: string) =>
      frames.filter(
        (frame) => frame.direction === "sent" && frame.method === method,
      ),
    result: (request: ObservedRpc) =>
      frames.find(
        (frame) => frame.direction === "received" && frame.id === request.id,
      )?.result,
  };
}
async function armHistoryRefresh(
  request: APIRequestContext,
  sessionId: string,
) {
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/history/hold-refresh?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
}
async function expectHistoryRefreshHeld(
  request: APIRequestContext,
  sessionId: string,
  dialog: Locator,
) {
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/history/state")
      ).json()) as { held: string[] };
      return state.held;
    })
    .toEqual([sessionId]);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Applying and refreshing the owning Session…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close history", exact: true }),
  ).toBeDisabled();
}
async function releaseHistoryRefresh(
  request: APIRequestContext,
  sessionId: string,
) {
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/history/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
}

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function composer(page: Page): Locator {
  return page.getByPlaceholder(COMPOSER_PLACEHOLDER);
}

function observeStartedTurns(page: Page): () => number {
  let starts = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) starts += 1;
    });
  });
  return () => starts;
}

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
  const startedTurns = observeStartedTurns(page);
  await connectAndStartWorkspace(page, cwd);

  await sendSlashCommand(page, "/definitely-not-a-real-command");
  await expect(
    page.getByText("/definitely-not-a-real-command is unavailable"),
  ).toBeVisible();
  await expect(page.getByText("Nothing was sent to the model.")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  expect(startedTurns()).toBe(0);
});

test("keeps the rewind receipt and restores only the owning prompt draft after canonical refresh", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await connectAndStartWorkspace(page, "/srv/work/history-rewind-receipt");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  const prompts = [
    "First user-rooted checkpoint",
    "Second user-rooted checkpoint",
  ];
  for (const [index, prompt] of prompts.entries()) {
    await composer(page).fill(prompt);
    await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .click();
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(index + 1);
  }
  await sendSlashCommand(page, "/rewind");
  const dialog = page.getByRole("dialog", {
    name: "Rewind conversation",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "#1 · " + prompts[0], exact: true })
    .click();
  await armHistoryRefresh(request, sessionId);
  await dialog
    .getByRole("button", { name: "Confirm conversation rewind", exact: true })
    .click();
  await expectHistoryRefreshHeld(request, sessionId, dialog);
  expect(
    protocol.requests("session/rollback").map((frame) => frame.params),
  ).toEqual([{ session_id: sessionId, num_turns: 2 }]);
  await releaseHistoryRefresh(request, sessionId);
  const receipt = dialog.getByText(
    "Conversation rewound. Workspace files were not restored.",
    { exact: true },
  );
  await expect(receipt).toBeVisible();
  await expect(receipt).toHaveCount(1);
  await expect(
    dialog.getByRole("button", {
      name: "Confirm conversation rewind",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(composer(page)).toHaveValue(prompts[0]!);
  await expect(composer(page)).toBeEnabled();
  const conversation = page.locator(
    '[role="region"][aria-label="Conversation"]',
  );
  for (const prompt of prompts)
    await expect(conversation.getByText(prompt, { exact: true })).toHaveCount(
      0,
    );
  await expect(conversation.getByText(COMPLETION_TEXT)).toHaveCount(0);
  expect(protocol.requests("session/rollback")).toHaveLength(1);
  expect(protocol.requests("snapshot/restore")).toHaveLength(0);
  expect(protocol.requests("session/open")).toHaveLength(1);
  expect(protocol.requests("turn/start")).toHaveLength(2);
});

test("queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  const cwd = "/srv/work/gather-exact-owner";
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sourceOpen = protocol.requests("session/open")[0]!;
  const sessionId = String(sourceOpen.params!.session_id);
  const aKey = await sidebar
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  const a = sidebar.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(aKey)}]`,
  );
  const brief = "Gather this exact peer receipt";
  await sendSlashCommand(page, "/peer");
  const peers = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await peers.getByLabel("Peer brief", { exact: true }).fill(brief);
  await peers.getByRole("button", { name: "Start peers", exact: true }).click();
  await expect.poll(() => protocol.requests("turn/start").length).toBe(1);
  const staged = protocol.frames.find(
    (frame) => frame.direction === "received" && frame.method === "peer/staged",
  )!.params!;
  const slug = String(staged.slug);
  const peerId =
    String(staged.profile_id) + ":local:tui#" + String(staged.topic);
  const terminals = () =>
    protocol.frames.filter(
      (frame) =>
        frame.direction === "received" &&
        frame.method === "projection/envelope" &&
        (frame.params?.payload as { type?: string })?.type === "turn_terminal",
    );
  await expect
    .poll(() =>
      terminals().some((frame) => frame.params!.session_id === peerId),
    )
    .toBe(true);
  await peers.getByRole("button", { name: "Close peers", exact: true }).click();
  await expect(a).toHaveAttribute("aria-current", "page");
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/terminal/hold-next")
    ).status(),
  ).toBe(204);
  const activePrompt = "Keep A active while its gather result is in flight";
  await composer(page).fill(activePrompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
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
  expect(protocol.requests("peer/gather")).toHaveLength(1);
  expect(protocol.requests("peer/gather")[0]!.params).toEqual({
    session_id: sessionId,
    profile_id: sourceOpen.params!.profile_id,
    slugs: [slug],
  });
  await sidebar
    .locator('[data-workspace-name="gather-exact-owner"]')
    .getByRole("button", { name: "gather-exact-owner", exact: true })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in gather-exact-owner",
      exact: true,
    })
    .click();
  // Two Session rows; the peer lives in the dock, not in the Session list.
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(2);
  await expect(sidebar.locator(`button[data-peer-slug="${slug}"]`)).toHaveCount(
    1,
  );
  await expect(a).not.toHaveAttribute("aria-current", "page");
  const bKey = await sidebar
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  const b = sidebar.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(bKey)}]`,
  );
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
  expect(protocol.requests("turn/start")).toHaveLength(2);
  await b.click();
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByText(/Peer results gathered|Keep A active/),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/terminal/state")
      ).json()) as { held: Array<{ session_id: string }> };
      return state.held.some((held) => held.session_id === sessionId);
    })
    .toBe(true);
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/terminal/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  await expect.poll(() => protocol.requests("turn/start").length).toBe(3);
  const synthesis = protocol.requests("turn/start")[2]!;
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
  expect(Buffer.byteLength(expected, "utf8")).toBeLessThanOrEqual(64 * 1024);
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
  await expect.poll(() => protocol.requests("peer/gather").length).toBe(2);
  await expect
    .poll(() => protocol.result(protocol.requests("peer/gather")[1]!))
    .toBeTruthy();
  expect(protocol.requests("turn/start")).toHaveLength(3);
  expect(protocol.requests("turn/interrupt")).toHaveLength(0);
});
