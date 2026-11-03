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
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      const withoutSkills = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(withoutSkills);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(
          Object.entries(value).flatMap(([key, entry]) => [
            [
              key,
              key === "supported_methods" && Array.isArray(entry)
                ? entry.filter((method) => method !== "profile/skills/list")
                : withoutSkills(entry),
            ],
          ]),
        );
      };
      server.onMessage((message) =>
        route.send(JSON.stringify(withoutSkills(JSON.parse(String(message))))),
      );
      route.onMessage((message) => server.send(message));
    },
  );
  await start(page, "/workspace/composer-bar");
  const row = settings(page);
  await expect(
    row.getByRole("button", { name: /^Folder \/workspace\/composer-bar\./ }),
  ).toContainText("composer-bar");
  await expect(row.getByRole("button", { name: /^Model: / })).toBeVisible();
  await expect(
    row.getByRole("button", { name: /^Permission: / }),
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "Attach files" })).toBeVisible();
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

test("phones fold skills and files into one +", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const turnStarts = await offerSkills(page);
  await start(page, "/workspace/composer-phone");
  const row = settings(page);
  await expect(
    row.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Attach files", exact: true }),
  ).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add skills or files" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Draft the Q4 summary");
  await add.click();
  const menu = page.getByRole("menu", { name: "Add" });
  await expect(
    menu.getByRole("menuitem", { name: "Attach files" }),
  ).toBeVisible();
  await expect(menu.getByRole("group", { name: "Skills" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await menu.getByRole("menuitem", { name: /office-docx/ }).click();
  await expect(menu).toBeHidden();
  await expect(composer).toHaveValue(
    "Use the office-docx skill: Draft the Q4 summary",
  );
  await expect(composer).toBeFocused();

  await add.click();
  const chooser = page.waitForEvent("filechooser");
  await menu.getByRole("menuitem", { name: "Attach files" }).click();
  await chooser;
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

function attached(page: Page) {
  return page.getByRole("list", { name: "Attached files" });
}

function dropOn(page: Page, selector: string) {
  return (files: { name: string; type: string }[]) =>
    page.evaluate(
      ({ files, selector }) => {
        const transfer = new DataTransfer();
        for (const file of files)
          transfer.items.add(new File(["x"], file.name, { type: file.type }));
        const target = document.querySelector(selector)!;
        return ["dragover", "drop"].map(
          // dispatchEvent is false once a listener claimed the event, which
          // is what keeps the browser from opening the dropped file.
          (type) =>
            !target.dispatchEvent(
              new DragEvent(type, {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
              }),
            ),
        );
      },
      { files, selector },
    );
}

async function acceptUploads(page: Page) {
  await page.route("**/api/upload", async (route) => {
    const profile = route.request().headers()["x-profile-id"];
    const name = /filename="([^"]+)"/.exec(
      route.request().postData() ?? "",
    )?.[1];
    await route.fulfill({
      json: [
        `up/${Buffer.from(`${profile}/${name}`).toString("base64url")}/${name}`,
      ],
    });
  });
}

test("dropped files land in the tray, and what cannot be attached is explained", async ({
  page,
}) => {
  await acceptUploads(page);
  await start(page, "/workspace/composer-drop");
  const drop = dropOn(page, ".composer");

  await drop([
    { name: "report.pdf", type: "application/pdf" },
    { name: "sales.csv", type: "application/vnd.ms-excel" },
  ]);
  await expect(attached(page).locator('li[data-status="ready"]')).toHaveCount(
    2,
  );
  await expect(attached(page)).toContainText("report.pdf");
  await expect(attached(page)).toContainText("sales.csv");

  await drop([
    { name: "budget.xlsx", type: "" },
    { name: "chart.png", type: "image/png" },
  ]);
  await expect(page.locator(".composer")).toContainText(
    "Office files aren't supported: budget.xlsx.",
  );
  await expect(attached(page).locator('li[data-status="ready"]')).toHaveCount(
    3,
  );

  await attached(page)
    .getByRole("button", { name: "Remove report.pdf", exact: true })
    .click();
  await expect(attached(page).getByRole("listitem")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".composer")
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("a drop anywhere in the conversation attaches, and a missed drop stays on the page", async ({
  page,
}) => {
  await acceptUploads(page);
  await start(page, "/workspace/composer-drop-wide");
  const csv = [{ name: "sales.csv", type: "text/csv" }];

  await expect(dropOn(page, ".conversation-scroll")(csv)).resolves.toEqual([
    true,
    true,
  ]);
  await expect(attached(page).locator('li[data-status="ready"]')).toHaveCount(
    1,
  );

  await expect(dropOn(page, "aside")(csv)).resolves.toEqual([true, true]);
  await expect(attached(page).getByRole("listitem")).toHaveCount(1);
});

test("sending waits for uploads, then carries the files and shows them on the message", async ({
  page,
}) => {
  let finishUpload: () => void = () => {};
  const uploadHeld = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route("**/api/upload", async (route) => {
    await uploadHeld;
    const profile = route.request().headers()["x-profile-id"];
    await route.fulfill({
      json: [
        `up/${Buffer.from(`${profile}/sales`).toString("base64url")}/sales.csv`,
      ],
    });
  });
  const turnStarts = await offerSkills(page);
  await start(page, "/workspace/composer-send-files");
  const composer = page.getByRole("textbox", { name: "Message Octos" });

  const chooser = page.waitForEvent("filechooser");
  await settings(page)
    .getByRole("button", { name: "Attach files", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("a,b\n1,2\n"),
  });
  await expect(
    attached(page).locator('li[data-status="uploading"]'),
  ).toHaveCount(1);

  await composer.press("Enter");
  await expect(page.locator(".composer")).toContainText(
    "Tell Octos what to do with the attached files.",
  );
  await composer.fill("Clean this up");
  await composer.press("Enter");
  await expect(page.locator(".composer")).toContainText(
    "Some files aren't uploaded yet.",
  );
  expect(turnStarts).toEqual([]);
  await expect(composer).toHaveValue("Clean this up");

  finishUpload();
  await expect(attached(page).locator('li[data-status="ready"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".composer")).not.toContainText(
    "Some files aren't uploaded yet.",
  );
  await composer.press("Enter");
  await expect.poll(() => turnStarts.length).toBe(1);
  await expect(attached(page)).toHaveCount(0);
  await expect(
    page.locator("article").filter({ hasText: "Clean this up" }),
  ).toContainText("sales.csv");
});

test("/attach opens the file picker", async ({ page }) => {
  await start(page, "/workspace/composer-attach-command");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("/attach");
  const chooser = page.waitForEvent("filechooser");
  await composer.press("Enter");
  await chooser;
});
