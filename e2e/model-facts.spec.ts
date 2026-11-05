import { expect, test, type Page } from "@playwright/test";

/**
 * T-0419: the model menu states only what the server proves, from
 * `profile/llm/catalog` and the profile's configuration (the fields Core
 * b5d32903 returns). A model's name is never read for capabilities.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const PROFILE = "_main";

async function start(page: Page, cwd: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

const trigger = (page: Page) =>
  page
    .getByRole("group", { name: "Message settings" })
    .getByRole("button", { name: /^Model: / });

async function overrides(page: Page, query: string) {
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/model-overrides?profile=${PROFILE}&${query}`,
  );
  expect(response.ok()).toBe(true);
}

// The fixture outlives this file: put back the models and the selection.
test.afterEach(async ({ page }) => {
  await overrides(page, "reset=1");
});

test("states only the server's facts for each model and follows a change", async ({
  page,
}) => {
  await start(page, `/workspace/model-facts-${Date.now()}`);
  await trigger(page).click();
  const menu = page.getByRole("menu", { name: "Model" });
  const glm = menu.getByRole("menuitemradio", { name: /GLM 5\.3 Flash/ });
  const deepseek = menu.getByRole("menuitemradio", {
    name: /DeepSeek V4 Pro/,
  });
  await expect(glm.locator("[data-model-facts]")).toHaveText(
    /200K token context\s*8,192 token max output/,
  );
  // No catalog row and nothing configured: nothing to say, whatever its name suggests.
  await expect(deepseek.locator("[data-model-facts]")).toHaveCount(0);
  for (const guess of ["Hard problems", "Fast", "Chinese", "Coding"])
    await expect(menu).not.toContainText(guess);
  await page.keyboard.press("Escape");

  // The chip names the running model, DeepSeek V4 here, with GLM pending a
  // restart. The list says nothing about that model, so neither does the chip:
  // the pending model's facts must not attach to it.
  await expect(trigger(page)).toHaveAccessibleName(/^Model: DeepSeek V4\./);
  await expect(trigger(page)).not.toHaveAttribute("title");

  // Configuration overrides the catalog, and a refresh picks it up.
  await overrides(
    page,
    "model=deepseek-v4-pro&context_window=64000&lacks_vision=1",
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await trigger(page).click();
  await expect(deepseek.locator("[data-model-facts]")).toHaveText(
    /64K token context\s*Images not sent/,
  );
});

test("the chip carries the facts of the model the runtime reports", async ({
  page,
}) => {
  // Core reports the running model in session/status/read.
  let running = {
    model: "glm-5.3-flash",
    provider: "zai",
    title: "GLM 5.3 Flash",
  };
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      const statusReads = new Set<string>();
      route.onMessage((data) => {
        const frame = JSON.parse(String(data));
        if (frame.method === "session/status/read")
          statusReads.add(String(frame.id));
        server.send(data);
      });
      server.onMessage((data) => {
        const frame = JSON.parse(String(data));
        if (statusReads.has(String(frame.id)) && frame.result) {
          frame.result.model = running;
          route.send(JSON.stringify(frame));
        } else route.send(data);
      });
    },
  );
  await overrides(
    page,
    "model=deepseek-v4-pro&context_window=64000&lacks_vision=1",
  );
  await start(page, `/workspace/model-facts-chip-${Date.now()}`);
  await expect(trigger(page)).toHaveAttribute(
    "title",
    "200K token context · 8,192 token max output",
  );
  // Switching models: the chip follows once the runtime reports the new one.
  running = {
    model: "deepseek-v4-pro",
    provider: "deepseek",
    title: "DeepSeek V4 Pro",
  };
  await trigger(page).click();
  await page
    .getByRole("menu", { name: "Model" })
    .getByRole("menuitemradio", { name: /DeepSeek V4 Pro/ })
    .click();
  await expect(trigger(page)).toHaveAttribute(
    "title",
    "64K token context · Images not sent",
  );
});

test("without metadata the selector still works and sending is not held up", async ({
  page,
}) => {
  const heldConfigReads: (() => void)[] = [];
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      route.onMessage((data) => {
        const frame = JSON.parse(String(data));
        // Neither fact source ever answers.
        if (frame.method === "profile/llm/catalog") return;
        if (frame.method === "profile/llm/list" && !frame.params?.session_id) {
          heldConfigReads.push(() => server.send(data));
          return;
        }
        server.send(data);
      });
      server.onMessage((data) => route.send(data));
    },
  );
  await start(page, `/workspace/model-facts-silent-${Date.now()}`);
  await expect.poll(() => heldConfigReads.length).toBeGreaterThan(0);
  await trigger(page).click();
  const menu = page.getByRole("menu", { name: "Model" });
  await expect(
    menu.getByRole("menuitemradio", { name: /GLM 5\.3 Flash/ }),
  ).toBeVisible();
  await expect(menu.locator("[data-model-facts]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger(page)).not.toHaveAttribute("title");

  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Send while the facts are still pending");
  await composer.press("Enter");
  await expect(page.getByText("Turn complete").last()).toBeVisible();
});

test("facts stay inside the menu at 390px, leaving the composer row as it was", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, `/workspace/model-facts-phone-${Date.now()}`);
  const row = page.getByRole("group", { name: "Message settings" });
  const before = await row.boundingBox();
  await trigger(page).click();
  const menu = page.getByRole("menu", { name: "Model" });
  await expect(menu.locator("[data-model-facts]").first()).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const spill = await menu.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(spill).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  expect(await row.boundingBox()).toEqual(before);
});
