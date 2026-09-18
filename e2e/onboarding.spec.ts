import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

async function connectWithKeyboard(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await expect(
    page.getByRole("region", { name: "Add workspace" }),
  ).toBeVisible();
}

test("validates the address without opening a socket and leaves focus on the correction", async ({
  page,
}) => {
  let sockets = 0;
  await page.goto("/");
  page.on("websocket", () => sockets++);
  const address = page.getByLabel("Server origin");
  await address.fill("not a server address");
  await address.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Enter a complete address",
  );
  await expect(address).toBeFocused();
  await expect(address).toHaveAttribute("aria-invalid", "true");
  expect(sockets).toBe(0);

  await address.fill(`${FIXTURE_ORIGIN}?token=must-not-be-remembered`);
  await address.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Put your token in Auth token",
  );
  expect(sockets).toBe(0);
  await page.getByRole("button", { name: "Use this page" }).click();
  await expect(address).toHaveValue(new URL(page.url()).origin);
  await expect(address).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sockets).toBe(0);
});

test("explains missing authentication while preserving password privacy and IME entry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  const token = page.getByLabel("Auth token", { exact: true });
  await token.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  await token.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Auth token is required.",
  );
  await expect(
    page.getByRole("complementary", { name: "Product navigation" }),
  ).toHaveCount(0);

  await token.fill("tab-scoped-e2e-token");
  await expect(token).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show token" }).click();
  await expect(token).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide token" }).click();
  await expect(token).toHaveAttribute("type", "password");
});

test("starts a first workspace with the keyboard and focuses the useful field when adding another", async ({
  page,
}) => {
  await connectWithKeyboard(page);
  const path = page.getByLabel("Server workspace path");
  await expect(path).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Back to workspaces" }),
  ).toHaveCount(0);
  await path.fill("/workspace/onboarding-keyboard");
  await path.press("Enter");
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await expect(composer).toBeVisible();
  await composer.fill("keep my draft");

  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await expect(dialog.getByLabel("Server workspace path")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveValue("keep my draft");
});

test("keeps an in-flight workspace creation visible when Escape or the backdrop is used", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as {
        method?: string;
        params?: { cwd?: string };
      };
      if (
        request.method === "launch/resolve" &&
        request.params?.cwd === "/workspace/onboarding-pending"
      ) {
        release = () => server.send(message);
      } else {
        server.send(message);
      }
    });
  });
  await connectWithKeyboard(page);
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/onboarding-initial");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog
    .getByLabel("Server workspace path")
    .fill("/workspace/onboarding-pending");
  await dialog.getByLabel("Server workspace path").press("Enter");
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Starting…" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  release?.();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("/workspace/onboarding-pending", { exact: true }),
  ).toBeVisible();
});
