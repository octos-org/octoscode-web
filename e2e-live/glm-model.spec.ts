import { expect, test } from "@playwright/test";

const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = required("OCTOSCODE_LIVE_TOKEN");
const cwd = required("OCTOSCODE_LIVE_WORKSPACE");
const sessionId = required("OCTOSCODE_LIVE_SESSION_ID");

test("runs a GLM-5.2 coding turn and restores it after refresh", async ({
  page,
}) => {
  await page.addInitScript(
    ({ endpoint, token, cwd, sessionId }) => {
      localStorage.setItem(
        "octoscode-web.connection.v1",
        JSON.stringify({
          version: 1,
          endpoint,
          sessionId,
          profileId: "coding",
          cwd,
        }),
      );
      sessionStorage.setItem("octoscode-web.connection-token.v1", token);
      sessionStorage.setItem("octoscode-web.auto-connect.v1", "1");
    },
    { endpoint, token, cwd, sessionId },
  );

  await page.goto("/");
  await expect(page.locator(".workspace-title small")).toHaveText(sessionId, {
    timeout: 30_000,
  });

  const workspaceWrite = page.getByRole("button", {
    name: "Workspace write",
  });
  await expect(workspaceWrite).toBeVisible();
  if ((await workspaceWrite.getAttribute("aria-pressed")) !== "true") {
    await workspaceWrite.click();
    await expect(workspaceWrite).toHaveAttribute("aria-pressed", "true");
  }

  const inspector = page.locator("#work-inspector");
  if (!(await inspector.isVisible())) {
    await page.locator(".inspector-toggle").click({ timeout: 10_000 });
  }
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("glm-5.2");
  await expect(inspector).toContainText("zai");

  const composer = page.getByPlaceholder(
    "Ask Octos to change, explain, or review code…",
  );
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(
    "Create GLM_E2E.md in this workspace with exactly one line: GLM-5.2 web end-to-end verified. Read the file back with a tool. Do not modify anything else. After verification, reply with the exact marker GLM_E2E_OK.",
  );
  await page.getByRole("button", { name: "Send prompt" }).click();

  const result = page.locator(".entry-assistant").filter({
    hasText: "GLM_E2E_OK",
  });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if ((await result.count()) > 0 && (await result.last().isVisible())) break;

    const approval = page.getByRole("dialog").filter({
      hasText: "Approval required",
    });
    if ((await approval.count()) > 0 && (await approval.first().isVisible())) {
      await approval
        .first()
        .getByRole("button", { name: /This session/ })
        .click();
    }

    const question = page.getByRole("dialog").filter({
      hasText: "Octos needs input",
    });
    if ((await question.count()) > 0 && (await question.first().isVisible())) {
      throw new Error("The bounded live task unexpectedly requested input");
    }
    await page.waitForTimeout(2_000);
  }
  await expect(result.last()).toBeVisible();

  await page.reload();

  await expect(page.locator(".workspace-title small")).toHaveText(sessionId, {
    timeout: 30_000,
  });
  await expect(
    page.locator(".entry-assistant").filter({ hasText: "GLM_E2E_OK" }).last(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByRole("button", { name: "Connect workspace" }),
  ).toBeVisible();
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live model gate`);
  return value;
}
