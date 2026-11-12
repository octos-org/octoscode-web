import { expect, test } from "@playwright/test";
import { startSession } from "./fixture-session";
import { openSettings } from "./sessions";
import { sendResult } from "./wire";

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
      sendResult(socket, request.id, shutdowns === 1 ? {} : { stopping: true });
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
  await startSession(page, "/workspace/server-shutdown");
  await expect(page.getByLabel("Message Octos")).toBeVisible();
  await openSettings(page);
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
  const settings = await openSettings(page);
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
