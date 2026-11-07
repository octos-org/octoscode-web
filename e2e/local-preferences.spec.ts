import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const storageKey = "octoscode.web.display.v1";
const token = "tab-scoped-e2e-token";
const input = (page: Page) => page.locator(".composer textarea");
const preferences = (page: Page) =>
  // Chromium's native AX name is checked below. Playwright's synthetic name
  // lookup omits this dynamically loaded dialog despite a valid labelledby.
  page.locator('[role="dialog"]').filter({
    has: page.getByRole("heading", {
      name: /^(Browser preferences|浏览器偏好设置)$/,
    }),
  });
const row = (page: Page, sessionId: string) =>
  page.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(sessionId)}]`,
  );
type Frame = {
  id?: string;
  method?: string;
  params?: {
    session_id?: string;
    turn_id?: string;
    approval_id?: string;
    question_id?: string;
    input?: { kind: string; text?: string }[];
    reasoning_effort?: string;
    media?: unknown[];
  };
  result?: unknown;
  error?: unknown;
};
function observe(page: Page) {
  const sent: Frame[] = [],
    received: Frame[] = [],
    pending = new Set<string>();
  let sockets = 0;
  page.on("websocket", (socket) => {
    const id = ++sockets;
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Frame;
      if (frame.method) sent.push(frame);
      if (frame.id !== undefined) pending.add(`${id}:${frame.id}`);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Frame;
      received.push(frame);
      if (frame.id !== undefined) pending.delete(`${id}:${frame.id}`);
    });
  });
  return {
    sent,
    received,
    pending,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
    sockets: () => sockets,
  };
}
async function connect(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await expect(chooser).toBeVisible();
    if (
      await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
    ) {
      await chooser.getByRole("button", { name: "Add workspace" }).click();
    }
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(`/srv/work/${workspace}`);
  await add.getByRole("button", { name: /Add & Start|Start session/ }).click();
  await expect(input(page)).toBeEnabled();
}
async function title(page: Page) {
  const sessionId = await page
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  if (!sessionId) throw new Error("Expected a selected Session id");
  return sessionId;
}
async function sibling(page: Page, workspace: string) {
  const navigation = page.locator("aside");
  await navigation
    // The stable workspace id is the contract, not its accessible name.
    .locator(`[data-workspace-name=${JSON.stringify(workspace)}]`)
    .locator('button[class*="workspaceToggle"]')
    .hover();
  await navigation
    .locator(`button[aria-label="New session in ${workspace}"]`)
    .click();
  await expect(input(page)).toBeEnabled();
}
async function command(page: Page, text: string) {
  await input(page).fill(text);
  await page.locator(".send-button").click();
  // Send acceptance has THREE valid outcomes: the composer clears (turn admitted
  // or queued), OR the composer unmounts/is replaced by the approval/question
  // takeover the instant its frame arrives (App.tsx swaps in
  // ApprovalPanel/UserQuestionPanel), OR ANY modal dialog mounts (an approval or
  // question takeover, or a /theme | /language surface). In the modal
  // cases the clear is not observable, so a bare `toHaveValue("")` times out with
  // "element(s) not found". Accept any of these signals; no fixed sleeps. The
  // 15 s ceiling absorbs the nondeterministic helper race observed under host load.
  await expect
    .poll(
      async () => {
        // Any mounted modal (approval/question takeover, or a /theme |
        // /language surface) also counts as acceptance.
        if ((await page.getByRole("dialog").count()) > 0) return true;
        const composer = input(page);
        if ((await composer.count()) === 0) return true; // taken over by a modal
        // Bounded read (1340 triage): an UNBOUNDED inputValue waits its own 30 s
        // default — LONGER than this poll's 15 s ceiling — so if a takeover lands
        // between the count() above and this read, the predicate wedges and the
        // poll rejects before it can re-check. 1 s keeps the loop able to re-evaluate.
        const value = await composer
          .inputValue({ timeout: 1_000 })
          .catch(() => null);
        return value === "" || value === null; // cleared (or just unmounted)
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}
async function closePreferences(page: Page) {
  await preferences(page)
    .getByRole("button", {
      name: /Close preferences|关闭偏好设置|Close|关闭/,
    })
    .click();
  await expect(preferences(page)).toHaveCount(0);
}
async function hold(request: APIRequestContext) {
  expect(
    (await request.post(`${origin}/__test__/terminal/hold-next`)).status(),
  ).toBe(204);
}
async function held(request: APIRequestContext, owner: string) {
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(`${origin}/__test__/terminal/state`)
      ).json()) as { held: { session_id: string }[] };
      return state.held.map((item) => item.session_id);
    })
    .toContain(owner);
}
async function release(request: APIRequestContext, owner: string) {
  expect(
    (
      await request.post(
        `${origin}/__test__/terminal/release?session_id=${encodeURIComponent(owner)}`,
      )
    ).status(),
  ).toBe(204);
}
async function storage(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

test("bare Normal Escape interrupts only the selected owner, while Vim changes preserve the other busy Session", async ({
  page,
  request,
}) => {
  const wire = observe(page),
    workspace = "local-preferences-vim-interrupt";
  await connect(page, workspace);
  await command(page, "/vimmode");
  const a = await title(page);
  await hold(request);
  try {
    await command(page, "Vim interrupt A");
    const aStart = wire.calls("turn/start")[0]!.params!;
    await held(request, aStart.session_id!);
    await sibling(page, workspace);
    await hold(request);
    await command(page, "Vim interrupt B must remain active");
    const bStart = wire.calls("turn/start")[1]!.params!;
    await held(request, bStart.session_id!);
    await row(page, a).click();
    await input(page).focus();
    if ((await input(page).getAttribute("data-vim-mode")) === "insert")
      await input(page).press("Escape");
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    await input(page).press("Escape");
    await expect.poll(() => wire.calls("turn/interrupt").length).toBe(1);
    expect(wire.calls("turn/interrupt")[0]!.params).toMatchObject({
      session_id: aStart.session_id,
      turn_id: aStart.turn_id,
    });
    await held(request, bStart.session_id!);
    expect(wire.calls("turn/start")).toHaveLength(2);
    await release(request, bStart.session_id!);
  } finally {
    await request.post(`${origin}/__test__/terminal/reset`);
  }
});

test("only explicit save persists display preferences; reload restores preferences and the separate draft without storing credentials", async ({
  page,
}) => {
  const wire = observe(page);
  await connect(page, "local-preferences-save");
  const before = await storage(page);
  await command(page, "/theme");
  await preferences(page)
    .locator('label:has-text("Theme") select')
    .selectOption("claude");
  await preferences(page)
    .locator('label:has-text("Language") select')
    .selectOption("zh");
  await preferences(page)
    .getByRole("checkbox", { name: "Vim 编辑", exact: true })
    .check();
  await closePreferences(page);
  expect((await storage(page))[storageKey]).toBeUndefined();
  await command(page, "/saveconfig");
  const saved = await storage(page);
  expect(JSON.parse(saved[storageKey]!)).toEqual({
    version: 1,
    theme: "claude",
    language: "zh",
    vimMode: true,
  });
  expect(
    Object.fromEntries(
      Object.entries(saved).filter(([key]) => key !== storageKey),
    ),
  ).toEqual(before);
  await input(page).fill("PRIVATE_COMPOSER_DRAFT");
  expect((await storage(page))[storageKey]).toBe(saved[storageKey]);
  expect(JSON.stringify(await storage(page))).not.toContain(token);
  expect(wire.calls("turn/start")).toHaveLength(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  await expect(page.locator("html")).toHaveAttribute(
    "data-display-theme",
    "claude",
  );
  await expect(input(page)).toBeEnabled();
  // Draft recovery is separate from the explicitly saved display preferences.
  await expect(input(page)).toHaveValue("PRIVATE_COMPOSER_DRAFT");
  expect((await storage(page))[storageKey]).toBe(saved[storageKey]);
  expect(JSON.stringify(await storage(page))).not.toContain(token);
  await input(page).fill("");
  await expect(input(page)).toHaveAttribute("data-vim-mode", "insert");
  await command(page, "/theme");
  await expect(
    preferences(page).getByRole("checkbox", { name: "Vim 编辑", exact: true }),
  ).toBeChecked();
  await preferences(page)
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  await preferences(page)
    .getByRole("button", { name: "Save browser preferences", exact: true })
    .click();
  expect(JSON.parse((await storage(page))[storageKey]!)).toEqual({
    version: 1,
    theme: "claude",
    language: "en",
    vimMode: true,
  });
  expect(wire.calls("turn/start")).toHaveLength(0);
});
