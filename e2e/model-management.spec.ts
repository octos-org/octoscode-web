import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const AUTH_TOKEN = "tab-scoped-e2e-token";
const WORKSPACE = "/workspace/model-management-e2e";

async function connectAndStartWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).click();

  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(WORKSPACE);
  await addWorkspace.getByRole("button", { name: "Add & Start" }).click();
  await expect(page.getByText(WORKSPACE, { exact: true })).toBeVisible();
}

async function openModelSettings(page: Page): Promise<Locator> {
  const productNavigation = page.getByRole("complementary", {
    name: "Product navigation",
  });
  await productNavigation.getByRole("button", { name: "Settings" }).click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Models", exact: true }).click();
  await expect(settings.getByRole("tabpanel")).toHaveAttribute(
    "data-settings-section",
    "models",
  );
  return settings;
}

function configuredProvider(settings: Locator, modelId: string): Locator {
  return settings
    .getByRole("list", { name: "Configured providers" })
    .getByRole("listitem")
    .filter({ hasText: modelId });
}

async function secretLeakState(
  page: Page,
  secret: string,
): Promise<{ dom: boolean; local: boolean; session: boolean }> {
  return page.evaluate((candidate) => {
    const storageContains = (storage: Storage) => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? "";
        if (key.includes(candidate)) return true;
        if ((storage.getItem(key) ?? "").includes(candidate)) return true;
      }
      return false;
    };

    return {
      dom: document.documentElement.outerHTML.includes(candidate),
      local: storageContains(window.localStorage),
      session: storageContains(window.sessionStorage),
    };
  }, secret);
}

test("manages a provider through the DSH-style Models settings flow", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const settings = await openModelSettings(page);

  const primary = configuredProvider(settings, "glm-5.3-flash");
  await expect(primary).toContainText("GLM-5.3-Flash");
  await expect(primary).toContainText("Primary");
  await expect(primary).toContainText("Credential configured");

  await settings.getByRole("button", { name: "Add provider" }).click();
  const editor = settings.getByRole("form", { name: "Add model provider" });
  await expect(editor).toBeVisible();

  await editor.getByLabel("Provider / family ID").fill("deepseek");
  await expect(editor.getByLabel("Model ID")).toHaveValue("deepseek-chat");
  await expect(editor.getByLabel("Route ID")).toHaveValue("openrouter");
  await expect(editor.getByLabel("Route label")).toHaveValue("OpenRouter");
  await expect(editor.getByLabel("API protocol")).toHaveValue("openai");
  await expect(editor.getByLabel("Credential environment")).toHaveValue(
    "OPENROUTER_API_KEY",
  );
  await expect(editor.getByLabel("Base URL")).toHaveValue(
    "https://openrouter.ai/api/v1",
  );

  const apiKey = editor.getByLabel("API key");
  await expect(apiKey).toHaveAttribute("type", "password");
  const ephemeralCredential = `e2e-${crypto.randomUUID()}`;
  await apiKey.fill(ephemeralCredential);

  await editor.getByRole("button", { name: "Test connection" }).click();
  await expect(editor.getByRole("status")).toHaveText("Connection succeeded.");

  await editor.getByRole("button", { name: "Fetch available models" }).click();
  await expect(editor.getByRole("status")).toHaveText(
    "2 available models found.",
  );
  const endpointModels = editor.getByRole("region", {
    name: "Available from endpoint",
  });
  await expect(
    endpointModels.getByRole("button", { name: "deepseek-chat" }),
  ).toBeVisible();
  await expect(
    endpointModels.getByRole("button", { name: "deepseek-reasoner" }),
  ).toBeVisible();

  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(
    settings.getByRole("status").filter({ hasText: "Provider saved." }),
  ).toBeVisible();

  let added = configuredProvider(settings, "deepseek-chat");
  await expect(added).toBeVisible();
  await expect(added).toContainText("OpenRouter");
  await expect(added).toContainText("Credential configured");
  expect(await secretLeakState(page, ephemeralCredential)).toEqual({
    dom: false,
    local: false,
    session: false,
  });

  await added.getByRole("button", { name: "Edit Deepseek Chat" }).click();
  const edit = settings.getByRole("form", { name: "Edit model provider" });
  await expect(edit.getByLabel("API key")).toHaveValue("");
  await expect(edit.getByLabel("API key")).toHaveAttribute(
    "placeholder",
    "Leave blank to keep the configured key",
  );
  await expect(
    edit.getByText(
      "Configured. Enter a value only to replace it; the stored key is never read back.",
      { exact: true },
    ),
  ).toBeVisible();
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toBeHidden();

  added = configuredProvider(settings, "deepseek-chat");
  await added.getByRole("button", { name: "Delete Deepseek Chat" }).click();
  const confirmation = settings.getByRole("dialog", {
    name: "Delete model provider?",
  });
  const deleteButton = confirmation.getByRole("button", {
    name: "Delete provider",
  });
  await expect(deleteButton).toBeDisabled();
  await confirmation
    .getByLabel("Type DELETE deepseek/deepseek-chat to confirm")
    .fill("DELETE deepseek/deepseek-chat");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(confirmation).toBeHidden();
  await expect(
    settings.getByRole("status").filter({ hasText: "Provider deleted." }),
  ).toBeVisible();
  await expect(configuredProvider(settings, "deepseek-chat")).toHaveCount(0);
});

test("keeps a rejected provider draft while redacting the failure", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const settings = await openModelSettings(page);
  await settings.getByRole("button", { name: "Add provider" }).click();

  const editor = settings.getByRole("form", { name: "Add model provider" });
  await editor.getByLabel("Provider / family ID").fill("deepseek");
  const rejectedCredential = ["sk", "rejected", "secret"].join("-");
  await editor.getByLabel("API key").fill(rejectedCredential);
  await editor.getByRole("button", { name: "Test connection" }).click();

  await expect(editor.getByRole("alert")).toHaveText(
    "Connection failed. Check the endpoint, protocol, model, and credential.",
  );
  await expect(editor.getByLabel("Provider / family ID")).toHaveValue(
    "deepseek",
  );
  await expect(editor.getByLabel("Model ID")).toHaveValue("deepseek-chat");
  await expect(editor.getByLabel("Route ID")).toHaveValue("openrouter");
  expect(
    await editor
      .getByLabel("API key")
      .evaluate((input: HTMLInputElement) => Boolean(input.value)),
  ).toBe(true);
  expect(
    await page.evaluate(
      (candidate) =>
        document.documentElement.textContent?.includes(candidate) ?? false,
      rejectedCredential,
    ),
  ).toBe(false);
});
