import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session";
import {
  newSessionIn,
  openSettings,
  selectSession,
  sendPrompt,
} from "./sessions";

const WORKSPACE = "/workspace/attention-check";
const FINISHED = "Completed with pnpm check and all tests passing.";

interface AttentionProbe {
  hidden: boolean;
  permission: NotificationPermission;
  result: NotificationPermission;
  requests: number;
  notices: { title: string; body: string; closed: boolean }[];
}
declare global {
  interface Window {
    __attentionProbe: AttentionProbe;
  }
}

async function instrument(
  page: Page,
  result: NotificationPermission = "granted",
) {
  await page.addInitScript((permissionResult) => {
    const state: AttentionProbe = {
      hidden: false,
      permission: "default",
      result: permissionResult,
      requests: 0,
      notices: [],
    };
    window.__attentionProbe = state;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (state.hidden ? "hidden" : "visible"),
    });
    class BrowserNotification {
      static get permission() {
        return state.permission;
      }
      static async requestPermission() {
        state.requests++;
        state.permission = state.result;
        return state.result;
      }
      readonly notice: AttentionProbe["notices"][number];
      onclick: ((event: Event) => void) | null = null;
      constructor(title: string, options: NotificationOptions) {
        this.notice = { title, body: options.body ?? "", closed: false };
        state.notices.push(this.notice);
      }
      close() {
        this.notice.closed = true;
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: BrowserNotification,
    });
  }, result);
}

async function settings(page: Page) {
  const dialog = await openSettings(page);
  await expect(
    dialog.getByRole("button", { name: /desktop notifications/ }),
  ).toBeVisible();
  return dialog;
}

async function enable(page: Page) {
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  const toggle = dialog.getByRole("button", {
    name: /desktop notifications/,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(1);
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate((next) => {
    window.__attentionProbe.hidden = next;
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("denied desktop permission keeps tab counts working and Disconnect clears attention", async ({
  page,
}) => {
  await instrument(page, "denied");
  await startSession(page, WORKSPACE);
  const originalTitle = await page.title();
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  await dialog.getByRole("button", { name: /desktop notifications/ }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Notifications are blocked",
  );
  await expect(
    dialog.getByRole("button", { name: /desktop notifications/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await hidden(page, true);
  await sendPrompt(page, "Stream a reply fixture");
  await expect(page.getByText(FINISHED, { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual(
    [],
  );
  const reopened = await settings(page);
  await reopened
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(originalTitle);
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual(
    [],
  );
});

test("a background Session completing while another is selected signals and acknowledges on return", async ({
  page,
}) => {
  await instrument(page);
  await startSession(page, WORKSPACE);
  const originalTitle = await page.title();
  await enable(page);
  const navigation = page.getByRole("complementary", {
    name: "Product navigation",
  });
  const sessions = navigation.locator('[role="treeitem"][data-session-id]');
  const originalSessionTitle = await sessions
    .first()
    .getAttribute("data-session-id");
  if (!originalSessionTitle)
    throw new Error("Expected a confirmed Session title");
  await sendPrompt(page, "Continue this turn while I open another Session");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await newSessionIn(navigation, "attention-check");
  await expect(sessions).toHaveCount(2);
  await expect(
    navigation.locator('[title="Completed in background"]'),
  ).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices),
  ).toHaveLength(1);
  await selectSession(navigation, originalSessionTitle);
  await expect(page).toHaveTitle(originalTitle);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices[0]?.closed),
  ).toBe(true);
});
