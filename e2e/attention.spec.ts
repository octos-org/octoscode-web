import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
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

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Server workspace path").fill(WORKSPACE);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function settings(page: Page) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(
    dialog.getByRole("button", { name: "Desktop notifications", exact: true }),
  ).toBeVisible();
  return dialog;
}

async function enable(page: Page) {
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  const toggle = dialog.getByRole("button", {
    name: "Desktop notifications",
    exact: true,
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

async function send(page: Page, prompt = "Stream a reply fixture") {
  await page.getByRole("textbox", { name: "Message Octos" }).fill(prompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("desktop notifications require Settings opt-in and stay silent while reading", async ({
  page,
}) => {
  await instrument(page);
  await start(page);
  const originalTitle = await page.title();
  await enable(page);
  await send(page);
  await expect(page.getByText(FINISHED, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle(originalTitle);
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual(
    [],
  );
  const dialog = await settings(page);
  await dialog
    .getByRole("button", { name: "Desktop notifications", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Desktop notifications", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("octoscode-web:desktop-notifications"),
    ),
  ).toBe("false");
});

test("a hidden current Session completion notifies once and returning clears its badge", async ({
  page,
}) => {
  await instrument(page);
  await start(page);
  const originalTitle = await page.title();
  await enable(page);
  await hidden(page, true);
  await send(page);
  await expect(page.getByText(FINISHED, { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  await expect
    .poll(() => page.evaluate(() => window.__attentionProbe.notices.length))
    .toBe(1);
  // A normal App render after the persisted answer and terminal cannot notify twice.
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("A next draft");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("A next draft");
  expect(await page.evaluate(() => window.__attentionProbe.notices)).toEqual([
    {
      title: "Octoscode",
      body: "A background response finished. Return to Octoscode to review it.",
      closed: false,
    },
  ]);
  await hidden(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveTitle(originalTitle);
  expect(
    await page.evaluate(() =>
      window.__attentionProbe.notices.every((notice) => notice.closed),
    ),
  ).toBe(true);
});

test("denied desktop permission keeps tab counts working and Disconnect clears attention", async ({
  page,
}) => {
  await instrument(page, "denied");
  await start(page);
  const originalTitle = await page.title();
  const dialog = await settings(page);
  expect(await page.evaluate(() => window.__attentionProbe.requests)).toBe(0);
  await dialog
    .getByRole("button", { name: "Desktop notifications", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Notifications are blocked",
  );
  await expect(
    dialog.getByRole("button", { name: "Desktop notifications", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await hidden(page, true);
  await send(page);
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
  await start(page);
  const originalTitle = await page.title();
  await enable(page);
  const navigation = page.getByRole("complementary", {
    name: "Product navigation",
  });
  const sessions = navigation.getByRole("treeitem", { name: /Session / });
  const originalSessionTitle = await sessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalSessionTitle)
    throw new Error("Expected a confirmed Session title");
  await send(page, "Continue this turn while I open another Session");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await navigation
    .getByRole("treeitem", { name: "attention-check", exact: true })
    .getByRole("button", { name: "attention-check", exact: true })
    .hover();
  await navigation
    .getByRole("button", {
      name: "New session in attention-check",
      exact: true,
    })
    .click();
  await expect(sessions).toHaveCount(2);
  await expect(
    navigation.locator('[title="Completed in background"]'),
  ).toBeVisible();
  await expect(page).toHaveTitle(`(1) ${originalTitle}`);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices),
  ).toHaveLength(1);
  const original = navigation
    .locator('button[role="treeitem"]')
    .filter({ hasText: originalSessionTitle });
  await original.click();
  await expect(original).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(originalTitle);
  expect(
    await page.evaluate(() => window.__attentionProbe.notices[0]?.closed),
  ).toBe(true);
});
