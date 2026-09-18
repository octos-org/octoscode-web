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
// v0.10.0's QueuedPrompts replaced our pre-rebase `.prompt-queue` div with
// `<section aria-label="Queued prompts">` under CSS-module class names
// (apps/web/src/features/composer/QueuedPrompts.tsx:14). Target the accessible
// name — the stable contract — never a module-hashed class.
const promptQueue = (page: Page) =>
  page.getByRole("region", { name: "Queued prompts" });
const row = (page: Page, idSuffix: string) =>
  page.locator('button[role="treeitem"]').filter({
    has: page.locator('[class*="sessionTitle"]', {
      hasText: new RegExp(`(?:^|\\s)${idSuffix}$`),
    }),
  });
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
  const displayed = (
    await page
      .locator(
        'button[role="treeitem"][aria-current="page"] [class*="sessionTitle"]',
      )
      .innerText()
  ).trim();
  // The browser-owned Session/会话 label translates live, the confirmed native
  // identifier suffix does not. Do not pin a row to its earlier English label.
  const suffix = displayed.split(/\s+/).at(-1);
  if (!suffix || !/^[a-zA-Z0-9_-]+$/.test(suffix))
    throw new Error("Selected Session has no stable identifier suffix");
  return suffix;
}
async function sibling(page: Page, workspace: string) {
  const navigation = page.locator("aside");
  await navigation
    // v0.10.0's sidebar renders the workspace group as a <div role="treeitem">
    // (ProductSidebar.tsx:765-772) so its tree navigation can own the node id;
    // the role + accessible name are the contract, the tag name never was.
    .locator(`[role="treeitem"][aria-label="${workspace}"]`)
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
  // question takeover, or a /theme | /language | /images surface). In the modal
  // cases the clear is not observable, so a bare `toHaveValue("")` times out with
  // "element(s) not found". Accept any of these signals; no fixed sleeps. The
  // 15 s ceiling absorbs the nondeterministic helper race observed under host load.
  await expect
    .poll(
      async () => {
        // Any mounted modal (approval/question takeover, or a /theme |
        // /language | /images surface) also counts as acceptance.
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
    .getByRole("button", { name: /^(Close preferences|关闭偏好设置)$/ })
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
async function caret(page: Page, start: number, end = start) {
  await input(page).evaluate(
    (element, selection) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(selection.start, selection.end);
    },
    { start, end },
  );
}
async function storage(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

test("five themes and live language/Vim changes preserve two busy Sessions, queued text and local images without RPC", async ({
  page,
  request,
}, testInfo) => {
  const wire = observe(page),
    workspace = "local-preferences-busy";
  await connect(page, workspace);
  const a = await title(page),
    aOwner = wire.calls("session/open").at(-1)!.params!.session_id!;
  await hold(request);
  try {
    await command(page, "Preference A first held turn");
    await held(request, aOwner);
    await command(page, "Preference A second queued turn");
    await expect(promptQueue(page)).toContainText(
      "Preference A second queued turn",
    );
    await command(page, "/images");
    const images = page.getByRole("dialog", { name: "Turn images" });
    await images.getByLabel("Choose image files").setInputFiles({
      name: "local-only.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0D8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await images
      .getByRole("button", { name: "Close images", exact: true })
      .click();
    await sibling(page, workspace);
    const b = await title(page),
      bOwner = wire.calls("session/open").at(-1)!.params!.session_id!;
    await hold(request);
    await command(page, "Preference B first held turn");
    await held(request, bOwner);
    await input(page).fill("B untouched draft");
    await row(page, a).click();
    await expect.poll(() => wire.pending.size).toBe(0);
    const requestsBefore = wire.sent.length;
    for (const [value, label, surface, stringColor] of [
      ["terminal", "Terminal", null, null],
      ["codex", "Codex", "rgb(15, 18, 24)", "#68d391"],
      ["claude", "Claude", "rgb(38, 31, 26)", "#78cd96"],
      ["slate", "Slate", "rgb(20, 25, 35)", "#5bc481"],
      ["solarized", "Solarized", "rgb(0, 43, 54)", "#859900"],
    ] as const) {
      await command(page, "/theme");
      if (value === "terminal") {
        await expect(
          page
            .locator('[role="dialog"]')
            .getByRole("heading", { name: "Browser preferences" }),
        ).toBeVisible();
        await testInfo.attach("preference-dialog-label-diagnostic", {
          contentType: "application/json",
          body: JSON.stringify(
            await page.getByRole("dialog").evaluate((dialog) => {
              const id = dialog.getAttribute("aria-labelledby");
              return {
                id,
                labels: id
                  ? Array.from(document.querySelectorAll("[id]"))
                      .filter((node) => node.id === id)
                      .map((node) => ({
                        tag: node.tagName,
                        text: node.textContent,
                        display: getComputedStyle(node).display,
                        visibility: getComputedStyle(node).visibility,
                        hidden: node.getAttribute("aria-hidden"),
                      }))
                  : [],
                resolvedText: id
                  ? document.getElementById(id)?.textContent
                  : null,
                escaped: id ? CSS.escape(id) : null,
                selectedText: id
                  ? document.querySelector(`#${CSS.escape(id)}`)?.textContent
                  : null,
                treeRoot: dialog.getRootNode().nodeName,
              };
            }),
            null,
            2,
          ),
        });
        const cdp = await page.context().newCDPSession(page);
        const ax = await cdp.send("Accessibility.getFullAXTree");
        expect(
          ax.nodes
            .filter((node) => node.role?.value === "dialog")
            .map((node) => node.name?.value),
        ).toEqual(["Browser preferences"]);
        await testInfo.attach("preference-dialog-native-accessibility", {
          contentType: "application/json",
          body: JSON.stringify(
            ax.nodes.filter(
              (node) =>
                node.role?.value === "dialog" ||
                (node.role?.value === "heading" &&
                  node.name?.value === "Browser preferences"),
            ),
            null,
            2,
          ),
        });
        await cdp.detach();
      }
      const select = preferences(page).getByRole("combobox", {
        name: "Theme",
        exact: true,
      });
      await expect(select.locator("option")).toHaveText([
        "Terminal",
        "Codex",
        "Claude",
        "Slate",
        "Solarized",
      ]);
      await select.selectOption({ label });
      await expect(page.locator("html")).toHaveAttribute(
        "data-display-theme",
        value!,
      );
      if (surface) {
        // Attributes alone miss a production build dropping the palette CSS.
        await expect(page.locator("body")).toHaveCSS(
          "background-color",
          surface,
        );
        expect(
          await page
            .locator("html")
            .evaluate((element) =>
              getComputedStyle(element)
                .getPropertyValue("--shiki-token-string")
                .trim(),
            ),
        ).toBe(stringColor);
      }
      if (value === "solarized") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: testInfo.outputPath("solarized-preferences-390px.png"),
        });
        const bounds = await preferences(page).boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      }
      await closePreferences(page);
      if (value === "solarized") {
        await page.screenshot({
          path: testInfo.outputPath("solarized-busy-sessions-390px.png"),
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(390);
        await page.setViewportSize({ width: 1280, height: 720 });
      }
    }
    await command(page, "/lang zh");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
    await expect(input(page)).toHaveAttribute(
      "placeholder",
      "让 Octos 修改、解释或审查代码…",
    );
    await command(page, "/language");
    await expect(
      preferences(page).getByRole("combobox", { name: "语言", exact: true }),
    ).toHaveValue("zh");
    await preferences(page)
      .getByRole("combobox", { name: "语言", exact: true })
      .selectOption("en");
    await expect(
      preferences(page).getByRole("heading", { name: "Browser preferences" }),
    ).toBeVisible();
    await closePreferences(page);
    await command(page, "/vimmode");
    await expect(input(page)).toHaveAttribute("data-vim-mode", "insert");
    await command(page, "/vim-mode");
    expect(wire.sent).toHaveLength(requestsBefore);
    expect(wire.calls("turn/start")).toHaveLength(2);
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    expect(wire.sockets()).toBe(1);
    expect((await storage(page))[storageKey]).toBeUndefined();
    await expect(promptQueue(page)).toContainText(
      "Preference A second queued turn",
    );
    await command(page, "/images");
    await expect(
      images.getByRole("list", { name: "Selected images" }),
    ).toContainText("local-only.png");
    await expect(
      images.getByText("Selected; not uploaded", { exact: true }),
    ).toBeVisible();
    await images
      .getByRole("button", { name: "Close images", exact: true })
      .click();
    await row(page, b).click();
    await expect(input(page)).toHaveValue("B untouched draft");
    await expect(promptQueue(page)).toHaveCount(0);
    await row(page, a).click();
    await release(request, aOwner);
    await expect.poll(() => wire.calls("turn/start").length).toBe(3);
    expect(wire.calls("turn/start")[2]!.params).toMatchObject({
      session_id: aOwner,
      input: [{ kind: "text", text: "Preference A second queued turn" }],
    });
    expect(wire.calls("turn/start")[2]!.params).not.toHaveProperty("media");
    await release(request, bOwner);
  } finally {
    await request.post(`${origin}/__test__/terminal/reset`);
  }
});

for (const kind of ["approval", "question"] as const) {
  test(`language changes translate retained ${kind} controls without translating Core content or changing its owner`, async ({
    page,
  }) => {
    const wire = observe(page),
      workspace = `local-preferences-${kind}`;
    await connect(page, workspace);
    const a = await title(page);
    await sibling(page, workspace);
    const b = await title(page);
    await row(page, a).click();
    await command(page, "/lang zh");
    await command(page, `Request ${kind} fixture`);
    const dialog = page.getByRole("dialog", {
      name:
        kind === "approval"
          ? "Run product checks?"
          : "Choose verification depth",
    });
    await expect(dialog).toBeVisible();
    const request = wire.received.find(
      (frame) =>
        frame.method ===
        (kind === "approval"
          ? "approval/requested"
          : "user_question/requested"),
    )!;
    expect(request).toBeDefined();
    if (kind === "approval") {
      await expect(dialog.getByText("需要批准", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /^是/ })).toBeVisible();
      await expect(
        dialog.getByText("The agent wants to run the repository checks.", {
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await expect(
        dialog.getByRole("button", { name: "继续", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("group", {
          name: "Checks Which checks should run?",
          exact: true,
        }),
      ).toBeVisible();
    }
    // A modal takes over its own composer. Switch to B using the retained sidebar,
    // then change global locale from B and return to the same unresolved A request.
    await row(page, b).click();
    await command(page, "/lang en");
    await row(page, a).click();
    await expect(dialog).toBeVisible();
    expect(wire.calls("approval/respond")).toHaveLength(0);
    expect(wire.calls("user_question/respond")).toHaveLength(0);
    if (kind === "approval") {
      await expect(
        dialog.getByText("Approval required", { exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: /^Yes/ }).click();
    } else {
      await dialog.getByLabel(/Full/).check();
      await dialog
        .getByRole("button", { name: "Continue", exact: true })
        .click();
    }
    await expect(dialog).toHaveCount(0);
    const responses = wire.calls(
      kind === "approval" ? "approval/respond" : "user_question/respond",
    );
    expect(responses).toHaveLength(1);
    expect(responses[0]!.params).toMatchObject({
      session_id: request.params!.session_id,
      [kind === "approval" ? "approval_id" : "question_id"]:
        request.params![kind === "approval" ? "approval_id" : "question_id"],
    });
    expect(wire.calls("turn/start")).toHaveLength(1);
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    expect(wire.sockets()).toBe(1);
  });
}

test("Vim editing keeps Insert Escape and pending-operator Escape local, while Normal Enter uses the existing FIFO", async ({
  page,
  request,
}) => {
  const wire = observe(page);
  await connect(page, "local-preferences-vim-fifo");
  await command(page, "/vimmode");
  await hold(request);
  try {
    await command(page, "Vim active turn");
    const owner = wire.calls("turn/start")[0]!.params!.session_id!;
    await held(request, owner);
    await input(page).fill("alpha beta");
    await input(page).press("Escape");
    await expect(input(page)).toHaveAttribute("data-vim-mode", "normal");
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    await input(page).press("d");
    await input(page).press("Escape");
    await expect(input(page)).toHaveValue("alpha beta");
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    await input(page).press("0");
    await input(page).press("w");
    await input(page).press("x");
    await expect(input(page)).toHaveValue("alpha eta");
    await input(page).press("Enter");
    await expect(promptQueue(page)).toContainText("alpha eta");
    expect(wire.calls("turn/start")).toHaveLength(1);
    await release(request, owner);
    await expect.poll(() => wire.calls("turn/start").length).toBe(2);
    expect(wire.calls("turn/start")[1]!.params).toMatchObject({
      session_id: owner,
      input: [{ kind: "text", text: "alpha eta" }],
    });
    expect(wire.calls("turn/interrupt")).toHaveLength(0);
    await expect(promptQueue(page)).toHaveCount(0);
  } finally {
    await request.post(`${origin}/__test__/terminal/reset`);
  }
});

test("Vim focus/Session ownership, Unicode deletion, IME and clipboard modifiers never edit another draft or hijack native keys", async ({
  page,
}) => {
  const wire = observe(page),
    workspace = "local-preferences-vim-ownership";
  await connect(page, workspace);
  const a = await title(page);
  await command(page, "/vimmode");
  await input(page).fill("A😀draft");
  await input(page).press("Escape");
  await caret(page, 1);
  await input(page).press("x");
  await expect(input(page)).toHaveValue("Adraft");
  await input(page).press("d");
  await sibling(page, workspace);
  const b = await title(page);
  await input(page).fill("B first\nB second");
  // First Escape normalizes either retained Normal or freshly reset Insert.
  if ((await input(page).getAttribute("data-vim-mode")) === "insert")
    await input(page).press("Escape");
  await caret(page, 1);
  await input(page).press("d");
  await expect(input(page)).toHaveValue("B first\nB second");
  await input(page).press("d");
  await expect(input(page)).toHaveValue("B second");
  await row(page, a).click();
  await expect(input(page)).toHaveValue("Adraft");
  await row(page, b).click();
  await caret(page, 0);
  if ((await input(page).getAttribute("data-vim-mode")) === "insert")
    await input(page).press("Escape");
  const unconsumed = await input(page).evaluate((element) => {
    const events = [
      new KeyboardEvent("keydown", {
        key: "h",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "Escape",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ];
    return events.map((event) => {
      element.dispatchEvent(event);
      return !event.defaultPrevented;
    });
  });
  expect(unconsumed).toEqual([true, true, true, true]);
  await expect(input(page)).toHaveValue("B second");
  await expect(input(page)).toHaveAttribute("data-vim-mode", "normal");
  await input(page).press("i");
  await caret(page, 0, 8);
  await input(page).press("ArrowRight");
  await expect(input(page)).toHaveValue("B second");
  expect(wire.calls("turn/start")).toHaveLength(0);
  expect(wire.calls("turn/interrupt")).toHaveLength(0);
});

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
