import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session";

const toggle = (page: Page) =>
  page.getByRole("button", { name: /^Session panel/ });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Session panel" });

test("Files browses the real workspace tree and previews any file in it", async ({
  page,
}) => {
  // T-0417: the server lists the workspace (dirs AND files); the panel
  // browses folders, pages, and opens a plain workspace file for preview.
  await startSession(page, `/workspace/file-tree-${Date.now()}`);
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Files" }).click();
  const files = panel(page).getByRole("tabpanel");
  await expect(files).toContainText(
    "The workspace as the server lists it, one folder at a time.",
  );
  await expect(files.getByRole("button", { name: "README.md" })).toBeVisible();
  await expect(
    files.getByRole("button", { name: "src", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");

  // Nested browse down to a leaf file, then preview it.
  await files.getByRole("button", { name: "src", exact: true }).click();
  await expect(
    files.getByRole("button", { name: "nested", exact: true }),
  ).toBeVisible();
  await files.getByRole("button", { name: "nested", exact: true }).click();
  await files.getByRole("button", { name: "deep.txt" }).click();
  await expect(panel(page).getByLabel("Selected file")).toContainText(
    "src/nested/deep.txt",
  );
  await expect(panel(page).getByRole("tabpanel")).toContainText(
    "deep tree content",
  );

  // Keyset pagination: docs lists two entries, "Show more" the third.
  await panel(page).getByRole("tab", { name: "Files" }).click();
  await files.getByRole("button", { name: "docs", exact: true }).click();
  await expect(files.getByRole("button", { name: "guide.md" })).toBeVisible();
  await expect(files.getByRole("button", { name: "spec.md" })).toHaveCount(0);
  await files.getByRole("button", { name: "Show more" }).click();
  await expect(files.getByRole("button", { name: "spec.md" })).toBeVisible();

  // The selection and expanded folders survive a reload from server facts.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("tab", { name: "Files" }).click();
  await expect(
    panel(page).getByRole("button", { name: "deep.txt" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "deep.txt" }),
  ).toHaveAttribute("aria-current", "true");
});
