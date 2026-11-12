import { expect, test, type Page } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session";
import { observeFrames } from "./turn-observers";
import {
  holdPermissionReceipt,
  type PermissionSetResult,
} from "./permission-receipt";

async function prepareReadOnly(page: Page, network = "Network blocked") {
  await connectAndStartWorkspace(
    page,
    `/workspace/approval-clarity-${Date.now()}`,
  );
  await page
    .getByRole("button", { name: /Session settings|Workspace write/ })
    .first()
    .click();
  const settings = page.getByRole("dialog", { name: "Session settings" });
  await settings
    .locator('button[aria-haspopup="menu"]')
    .filter({ hasText: /Write|Read/ })
    .first()
    .click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^Read · ${network}`) })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Session settings" }),
  ).toHaveCount(0);
  await page.reload();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  return composer;
}

async function prepareDeniedWrite(page: Page) {
  const composer = await prepareReadOnly(page);
  await composer.fill("Fail a write fixture");
  await composer.press("Enter");
  const retry = page.getByRole("button", {
    name: "Switch to write and continue",
  });
  await expect(retry).toBeVisible();
  return { composer, retry };
}

test("switching stops the running workaround, then redoes the request with write access", async ({
  page,
}) => {
  const frames = observeFrames(page);
  const watched = ["permission/profile/set", "turn/interrupt", "turn/start"];
  const composer = await prepareReadOnly(page);
  await composer.fill("Fail a write and ask to work around it");
  await composer.press("Enter");
  // The approval card covers the dock, so the way out has to live inside it.
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  const retry = approval.getByRole("button", {
    name: "Switch to write and continue",
  });
  await expect(retry).toBeVisible();
  await expect(approval.getByRole("status")).toContainText(
    "This stops the current response",
  );
  const before = frames.sent.length;
  await retry.click();
  await expect(approval).toBeHidden();
  await expect(
    page.locator("details").filter({ hasText: "report.md written" }),
  ).toHaveCount(1);
  expect(
    frames.sent
      .slice(before)
      .flatMap(({ method }) =>
        method && watched.includes(method) ? method : [],
      ),
  ).toEqual(watched);
});

test("a late permission retry never starts in or clears another Session", async ({
  page,
}) => {
  const receipt = await holdPermissionReceipt(page);
  const { composer, retry } = await prepareDeniedWrite(page);
  receipt.arm();
  await retry.click();
  await expect.poll(receipt.isHeld).toBe(true);
  await page
    .locator("aside")
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  await picker
    .getByLabel("Server workspace path")
    .fill("/workspace/permission-retry-other");
  await picker.getByLabel("Server workspace path").press("Enter");
  await composer.fill("DO NOT LOSE: unrelated B draft");
  const before = receipt.starts();
  receipt.release();
  await page.waitForTimeout(300);
  await expect(composer).toHaveValue("DO NOT LOSE: unrelated B draft");
  expect(receipt.starts()).toBe(before);
});

// A permission retry redoes the request only on an applied workspace-write
// receipt for the network the user chose; any other answer is reported and
// starts nothing (T-0530).
for (const [answer, edit] of [
  [
    "broadens network access",
    (result) => {
      result.current!.network = "allow";
    },
  ],
  [
    "is not applied",
    (result) => {
      result.applied = false;
    },
  ],
] satisfies [string, (result: PermissionSetResult) => void][]) {
  test(`permission retry refuses a response that ${answer}`, async ({
    page,
  }) => {
    const receipt = await holdPermissionReceipt(page);
    const { retry } = await prepareDeniedWrite(page);
    receipt.arm();
    await retry.click();
    await expect.poll(receipt.isHeld).toBe(true);
    const before = receipt.starts();
    receipt.release(edit);
    await expect(
      page.getByText("The server did not apply workspace write permission."),
    ).toBeVisible();
    expect(receipt.starts()).toBe(before);
  });
}
