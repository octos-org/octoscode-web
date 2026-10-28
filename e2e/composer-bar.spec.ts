import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

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

const settings = (page: Page) =>
  page.getByRole("group", { name: "Message settings" });

/** The fixture has no skills methods; advertise and answer them locally. */
async function offerSkills(page: Page) {
  const turnStarts: string[] = [];
  const advertise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(advertise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? [...new Set([...entry, "profile/skills/list"])]
          : advertise(entry),
      ]),
    );
  };
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      server.onMessage((message) =>
        route.send(JSON.stringify(advertise(JSON.parse(String(message))))),
      );
      route.onMessage((message) => {
        const request = JSON.parse(String(message));
        if (request.method === "turn/start") turnStarts.push(request.id);
        if (request.method !== "profile/skills/list") {
          server.send(message);
          return;
        }
        route.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              profile_id: request.params.profile_id,
              count: 1,
              skills: [
                {
                  name: "office-docx",
                  version: "1.0.0",
                  tool_count: 3,
                  source_repo: null,
                },
              ],
            },
          }),
        );
      });
    },
  );
  return turnStarts;
}

test("the composer shows where, who, and what it may do, at a glance", async ({
  page,
}) => {
  await start(page, "/workspace/composer-bar");
  const row = settings(page);
  await expect(
    row.getByRole("button", { name: /^Folder \/workspace\/composer-bar\./ }),
  ).toContainText("composer-bar");
  await expect(row.getByRole("button", { name: /^Model: / })).toBeVisible();
  await expect(
    row.getByRole("button", { name: /^Permission: / }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Attach images" }),
  ).toBeVisible();
  // The fixture advertises no skills methods, so there is no dead entry.
  await expect(
    row.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^This session used / }),
  ).toBeVisible();

  const model = row.getByRole("button", { name: /^Model: / });
  await model.click();
  const menu = page.getByRole("menu", { name: "Model" });
  await expect(menu).toContainText("every session");
  await expect(
    menu.getByRole("menuitemradio", { name: /GLM 5\.3 Flash/ }),
  ).toContainText("Fast · Chinese");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(model).toBeFocused();

  await page.getByRole("button", { name: /^This session used / }).click();
  const usage = page.getByRole("group", { name: "Session usage" });
  await expect(usage).toContainText("Input tokens");
  await expect(usage).toContainText("not a bill");
});

test("a skill adds an editable line and never sends", async ({ page }) => {
  const turnStarts = await offerSkills(page);
  await start(page, "/workspace/composer-skills");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Draft the Q4 summary");
  await settings(page)
    .getByRole("button", { name: "Skills", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /office-docx/ }).click();
  await expect(composer).toHaveValue(
    "Use the office-docx skill: Draft the Q4 summary",
  );
  await expect(composer).toBeFocused();
  expect(turnStarts).toEqual([]);
});

test("another folder starts a new session that keeps the unsent text", async ({
  page,
}) => {
  await start(page, "/workspace/composer-first");
  const composer = page.getByRole("textbox", { name: "Message Octos" });

  // Cancelling the picker drops the carry.
  await composer.fill("Not this time");
  await settings(page)
    .getByRole("button", { name: /^Folder / })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();

  await composer.fill("Summarise the sales data");
  await settings(page)
    .getByRole("button", { name: /^Folder / })
    .click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Add workspace" }).click();
  await picker
    .getByLabel("Server workspace path")
    .fill("/workspace/composer-second");
  await picker.getByLabel("Server workspace path").press("Enter");
  await expect(
    settings(page).getByRole("button", { name: /^Folder / }),
  ).toContainText("composer-second");
  await expect(composer).toHaveValue("Summarise the sales data");
});

test("dropped files stage images and explain what cannot be attached", async ({
  page,
}) => {
  await start(page, "/workspace/composer-drop");
  const drop = (files: { name: string; type: string }[]) =>
    page.evaluate((files) => {
      const transfer = new DataTransfer();
      for (const file of files)
        transfer.items.add(new File(["x"], file.name, { type: file.type }));
      const target = document.querySelector(".composer")!;
      for (const type of ["dragover", "drop"])
        target.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
    }, files);

  await drop([{ name: "report.pdf", type: "application/pdf" }]);
  await expect(page.locator(".composer")).toContainText(
    "Only images can be attached for now",
  );
  await expect(page.getByRole("dialog", { name: "Turn images" })).toHaveCount(
    0,
  );

  await drop([{ name: "chart.png", type: "image/png" }]);
  const images = page.getByRole("dialog", { name: "Turn images" });
  await expect(images).toContainText("chart.png");
});
