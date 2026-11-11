import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";
import { observeSent } from "./turn-observers";

const start = (page: Page, cwd: string) => startSession(page, cwd);

const settings = (page: Page) =>
  page.getByRole("group", { name: "Message settings" });

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
  const turnStarts = observeSent(page, "turn/start");
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
  expect(turnStarts()).toEqual([]);
  await expect(composer).toHaveValue("Clean this up");

  finishUpload();
  await expect(attached(page).locator('li[data-status="ready"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".composer")).not.toContainText(
    "Some files aren't uploaded yet.",
  );
  await composer.press("Enter");
  await expect.poll(() => turnStarts().length).toBe(1);
  await expect(attached(page)).toHaveCount(0);
  const message = page.locator("article").filter({ hasText: "Clean this up" });
  await expect(message).toContainText("sales.csv");
  // A short message must not squeeze the file row onto two lines.
  const preview = await message
    .getByRole("button", { name: "Preview" })
    .boundingBox();
  const download = await message
    .getByRole("button", { name: /^Download / })
    .boundingBox();
  expect(download!.y).toBe(preview!.y);
});
