import { expect, test, type Page } from "@playwright/test";
import {
  holdTerminals,
  releaseTerminal,
  terminalHeld,
} from "./fixture-controls";
import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  FIXTURE_TOKEN,
} from "./fixture-session";
import {
  newSessionIn,
  productNavigation,
  selectSession,
  selectedSessionId,
} from "./sessions";
import { observeSent } from "./turn-observers";

const storageKey = "octoscode.web.display.v1";
const input = (page: Page) => page.locator(".composer textarea");
const preferences = (page: Page) =>
  // Chromium's native AX name is checked below. Playwright's synthetic name
  // lookup omits this dynamically loaded dialog despite a valid labelledby.
  page.locator('[role="dialog"]').filter({
    has: page.getByRole("heading", {
      name: /^(Browser preferences|浏览器偏好设置)$/,
    }),
  });
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
async function storage(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

test("bare Normal Escape interrupts only the selected owner, while Vim changes preserve the other busy Session", async ({
  page,
  request,
}) => {
  const starts = observeSent(page, "turn/start"),
    interrupts = observeSent(page, "turn/interrupt"),
    workspace = "local-preferences-vim-interrupt";
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  await command(page, "/vimmode");
  const a = await selectedSessionId(productNavigation(page));
  await holdTerminals(request);
  try {
    await command(page, "Vim interrupt A");
    const aStart = starts()[0]!;
    await terminalHeld(request, String(aStart.session_id));
    await newSessionIn(productNavigation(page), workspace);
    await expect(input(page)).toBeEnabled();
    await holdTerminals(request);
    await command(page, "Vim interrupt B must remain active");
    const bStart = starts()[1]!;
    await terminalHeld(request, String(bStart.session_id));
    await selectSession(productNavigation(page), a);
    await input(page).focus();
    if ((await input(page).getAttribute("data-vim-mode")) === "insert")
      await input(page).press("Escape");
    expect(interrupts()).toHaveLength(0);
    await input(page).press("Escape");
    await expect.poll(() => interrupts().length).toBe(1);
    expect(interrupts()[0]).toMatchObject({
      session_id: aStart.session_id,
      turn_id: aStart.turn_id,
    });
    await terminalHeld(request, String(bStart.session_id));
    expect(starts()).toHaveLength(2);
    await releaseTerminal(request, String(bStart.session_id));
  } finally {
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  }
});

test("only explicit save persists display preferences; reload restores preferences and the separate draft without storing credentials", async ({
  page,
}) => {
  const starts = observeSent(page, "turn/start");
  await connectAndStartWorkspace(page, "/srv/work/local-preferences-save");
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
  expect(JSON.stringify(await storage(page))).not.toContain(FIXTURE_TOKEN);
  expect(starts()).toHaveLength(0);
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
  expect(JSON.stringify(await storage(page))).not.toContain(FIXTURE_TOKEN);
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
  expect(starts()).toHaveLength(0);
});
