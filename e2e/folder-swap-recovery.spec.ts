import { expect, test } from "@playwright/test";

import { FIXTURE_ORIGIN } from "./fixture-session";

/**
 * T-0740 (T-0739 R1/R2/R3): a user home root is refused with the typed
 * `-32120 chat_workspace_reserved`. Both refusal surfaces — the picker's
 * typed-path form and the first-run wizard — must show the Chinese reason and
 * an explicit folder-swap entry, and the recovery must reach a subfolder and
 * open a coding session. The new-folder input carries an accessible name.
 */
test.use({ locale: "zh-CN" });

// The folder browser is gated on the browse capability, which the fixture
// advertises only to this token.
const BROWSE_TOKEN = "workspace-browse-e2e-token";

async function connectZh(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("服务器地址").fill(FIXTURE_ORIGIN);
  await page.getByLabel("访问令牌", { exact: true }).fill(BROWSE_TOKEN);
  await page.getByRole("button", { name: "连接", exact: true }).click();
}

test("reserved home folder: disabled main button, typed refusal, folder swap", async ({
  page,
}) => {
  await connectZh(page);

  // The home root itself is never directly usable: the main action is
  // disabled with the hint, and the new-folder name input is labelled.
  await page.getByRole("button", { name: "转到上一级文件夹" }).click();
  await page.getByRole("button", { name: "转到上一级文件夹" }).click();
  await page.getByRole("button", { name: "打开文件夹 home" }).click();
  await page.getByRole("button", { name: "打开文件夹 t0740-user" }).click();
  await expect(
    page.getByRole("button", { name: "使用此文件夹", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("主目录不能直接用作工作区", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "新文件夹名称" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  // Typed manually, the refusal is Chinese and offers the folder swap.
  await page.getByRole("button", { name: "手动输入路径" }).click();
  const addWorkspace = page.getByRole("region", { name: "添加工作区" });
  await addWorkspace.getByLabel("服务器工作区路径").fill("/home/t0740-user");
  await addWorkspace.getByRole("button", { name: "开始会话" }).click();
  const failure = addWorkspace.getByRole("alert");
  await expect(failure).toContainText("受保护的 Chat 工作区");
  const swap = failure.getByRole("button", {
    name: "更换文件夹",
    exact: true,
  });
  await expect(swap).toBeVisible();

  // The swap goes back to the folder browser, opened at the refused path.
  await swap.click();
  await expect(
    page.getByText("主目录不能直接用作工作区", { exact: false }),
  ).toBeVisible();

  // A subfolder is the recovery: the coding session actually opens.
  await page.getByRole("button", { name: "打开文件夹 project" }).click();
  await page.getByRole("button", { name: "使用此文件夹", exact: true }).click();
  await expect(
    page.getByPlaceholder("让 Octos 修改、解释或审查代码…"),
  ).toBeEnabled();
});

test("wizard refusal is translated and offers folder swap to the browser", async ({
  page,
}) => {
  await connectZh(page);
  await page.getByRole("button", { name: "手动输入路径" }).click();
  const addWorkspace = page.getByRole("region", { name: "添加工作区" });
  await addWorkspace.getByLabel("服务器工作区路径").fill("/home/t0740-fresh");
  await addWorkspace.getByRole("button", { name: "开始会话" }).click();

  const onboarding = page.getByRole("dialog", {
    name: "设置你的编程助手",
  });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: "继续", exact: true }).click();
  await onboarding
    .getByLabel("使用自定义 OpenAI 兼容地址", { exact: true })
    .check();
  await onboarding
    .getByLabel("自定义 OpenAI 兼容基础地址", { exact: true })
    .fill("http://127.0.0.1:11434/v1");
  await onboarding
    .getByRole("button", { name: "测试、保存并打开", exact: true })
    .click();

  // The typed refusal inside the wizard is Chinese (T-0739 R2), not the
  // English constant, and carries the same folder-swap recovery.
  const failure = onboarding.getByRole("alert").last();
  await expect(failure).toContainText("受保护的 Chat 工作区");
  await expect(failure).not.toContainText("protected Chat workspace");
  const swap = failure.getByRole("button", {
    name: "更换文件夹",
    exact: true,
  });
  await expect(swap).toBeVisible();
  await swap.click();

  // Folder swap leaves the wizard and opens the folder browser.
  await expect(onboarding).toBeHidden();
  await expect(
    page.getByRole("button", { name: "转到上一级文件夹" }),
  ).toBeVisible();
});
