import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session";
import { openSettings } from "./sessions";
import { axeViolations } from "./axe";

function connector(settings: ReturnType<Page["getByRole"]>, id: string) {
  return settings.locator(`[data-connector-id="${id}"]`);
}

test("manages HTTP connectors and keeps existing stdio controls", async ({
  page,
}) => {
  await startSession(page, `/srv/work/connector-management-${Date.now()}`);
  const settings = await openSettings(page, "Connectors");
  const legacy = connector(settings, "legacy");
  const docs = connector(settings, "docs");
  await expect(legacy).toContainText("Legacy HTTP");
  await expect(docs).toContainText("Documentation MCP");

  await settings.getByRole("button", { name: "Add HTTP connector" }).click();
  const add = settings.getByRole("form", { name: "Add HTTP connector" });
  await add.getByLabel("Connector name").fill("Team docs");
  await add.getByLabel("HTTP URL").fill("https://mcp.example.test/team");
  await add.getByRole("button", { name: "Save connector" }).click();
  const created = connector(settings, "http-3");
  await expect(created).toContainText("Team docs");
  await expect(created).toContainText("connected");

  await created.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = settings.getByRole("form", { name: "Edit connector" });
  await edit.getByLabel("Connector name").fill("Team docs updated");
  await edit.getByLabel("HTTP URL").fill("https://mcp.example.test/v2");
  await edit.getByRole("button", { name: "Save connector" }).click();
  await expect(created).toContainText("Team docs updated");

  await created.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(created).toContainText("disabled");
  await expect(
    created.getByRole("button", { name: "Reconnect" }),
  ).toBeDisabled();
  await created.getByRole("button", { name: "Enable", exact: true }).click();
  await created.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(created).toContainText("connected");

  await docs.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(docs).toContainText("disabled");
  await docs.getByRole("button", { name: "Enable", exact: true }).click();
  await docs.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(docs).toContainText("connected");

  await created.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(created).toContainText("Delete Team docs updated?");
  await created.getByRole("button", { name: "Confirm delete" }).click();
  await expect(created).toHaveCount(0);
  await expect(settings.getByText(/oauth/i)).toHaveCount(0);
  expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
});

test("adds a stdio connector from the server's allowlist, never a command", async ({
  page,
}) => {
  await startSession(page, `/srv/work/connector-management-${Date.now()}`);
  const settings = await openSettings(page, "Connectors");
  await expect(
    settings.getByText(
      "Add HTTP connectors, or stdio connectors from the server's allowlist.",
    ),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Add stdio connector" }).click();
  const add = settings.getByRole("form", { name: "Add stdio connector" });
  const entry = add.getByLabel("Allowlist entry");
  await expect(entry.locator("option")).toHaveText([
    "Shared files",
    "Echo tools",
  ]);
  await expect(entry).toHaveAccessibleDescription(
    "Read-only access to the shared project folder",
  );
  // Only the name is typed; the server's operator fixed the command.
  await expect(add.getByRole("textbox")).toHaveCount(1);
  await expect(add.getByLabel("Connector name")).toHaveValue("Shared files");
  await entry.selectOption("echo");
  await expect(add.getByLabel("Connector name")).toHaveValue("Echo tools");
  await expect(
    add.getByText("Read-only access to the shared project folder"),
  ).toHaveCount(0);
  expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
  await add.getByRole("button", { name: "Save connector" }).click();
  const created = connector(settings, "stdio-3");
  await expect(created).toContainText("Echo tools");
  await expect(created).toContainText("stdio");
  await expect(created).toContainText("connected");
});

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/connectors/reset`);
});
