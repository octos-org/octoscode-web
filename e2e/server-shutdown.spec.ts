import { expect, test } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

test("server shutdown is capability gated, explicit, and truthful on an unconfirmed result", async ({
  page,
}) => {
  let advertised = false;
  let shutdowns = 0;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method !== "server/shutdown") {
        server.send(message);
        return;
      }
      shutdowns++;
      // Exercise the browser contract without shutting down the shared fixture.
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: shutdowns === 1 ? {} : { stopping: true },
        }),
      );
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      const capabilities =
        frame.result?.capabilities ?? frame.result?.opened?.capabilities;
      if (advertised && capabilities)
        capabilities.supported_methods.push("server/shutdown");
      socket.send(JSON.stringify(frame));
    });
  });
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/server-shutdown");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(page.getByLabel("Message Octos")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop server", exact: true }),
  ).toHaveCount(0);

  advertised = true;
  await page.reload();
  await expect(page.getByLabel("Message Octos")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 320 });
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "Stop server", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "Stop the Octos server?" });
  const cancel = confirm.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  expect(shutdowns).toBe(0);
  const trigger = settings.getByRole("button", {
    name: "Stop server",
    exact: true,
  });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  expect(shutdowns).toBe(0);
  await trigger.click();
  await confirm
    .getByRole("button", { name: "Stop server", exact: true })
    .click();
  await expect(confirm.getByRole("alert")).toHaveText(
    "Shutdown was not confirmed. Check the server before trying again.",
  );
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await cancel.click();
  await expect(settings).toBeVisible();
  await trigger.click();
  await confirm
    .getByRole("button", { name: "Stop server", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  expect(shutdowns).toBe(2);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
});
