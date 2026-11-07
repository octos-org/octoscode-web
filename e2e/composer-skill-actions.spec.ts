import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const token = "tab-scoped-e2e-token";

async function start(page: Page, workspace: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  const reference = new URL(page.url()).searchParams.get("s");
  return (JSON.parse(reference!) as string[])[2]!;
}

function invocations(page: Page) {
  const frames: Array<{ method?: string; params?: Record<string, unknown> }> =
    [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        // Not JSON-RPC.
      }
    }),
  );
  return frames;
}

const progress = (page: Page, sessionId: string, status = "succeeded") =>
  page.request.post(
    `${FIXTURE_ORIGIN}/__test__/skill/job/progress?session_id=${encodeURIComponent(sessionId)}&status=${status}`,
  );

test("runs a skill action from the composer, retries a failed job into a new job, and tracks the jobs across a refresh", async ({
  page,
}) => {
  const frames = invocations(page);
  const sessionId = await start(
    page,
    `/workspace/composer-skill-actions-${Date.now()}`,
  );
  const chip = page.locator("[data-skill-actions]");
  const trigger = chip.getByRole("button", { name: "Actions", exact: true });

  // The actions list is real server data, gated by capability.
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Skill actions" });
  await expect(menu.getByText("Run document probe")).toBeVisible();
  await expect(menu.getByText(/not as a prompt/)).toBeVisible();

  // Run it: one invoke, one job, no prompt turn.
  await menu.getByText("Run document probe").click();
  await menu.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    menu.locator("[data-skill-job] [data-job-status='queued']"),
  ).toBeVisible();
  expect(
    frames.filter((frame) => frame.method === "skill/action/invoke"),
  ).toHaveLength(1);
  expect(frames.filter((frame) => frame.method === "turn/start")).toHaveLength(
    0,
  );

  // Progress arrives live.
  await progress(page, sessionId, "running");
  await expect(
    menu.locator("[data-skill-job] [data-job-status='running']"),
  ).toBeVisible();

  // The provider fails this job: Retry starts a NEW job, never a prompt.
  await progress(page, sessionId, "failed");
  await expect(
    menu.locator("[data-skill-job] [data-job-status='failed']"),
  ).toBeVisible();
  await expect(menu.getByText(/refused the document/)).toBeVisible();
  await menu.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(menu.locator("[data-skill-job]")).toHaveCount(2);
  await progress(page, sessionId);
  await expect(
    menu.locator("[data-skill-job] [data-job-status='succeeded']"),
  ).toBeVisible();
  await menu.getByText("Result details").click();
  await expect(menu.getByText("protocol action fixture")).toBeVisible();
  expect(
    frames.filter((frame) => frame.method === "skill/action/invoke"),
  ).toHaveLength(2);
  expect(frames.filter((frame) => frame.method === "turn/start")).toHaveLength(
    0,
  );

  // A refresh shows the SAME server jobs; nothing is invoked again.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled({ timeout: 30_000 });
  await page
    .locator("[data-skill-actions]")
    .getByRole("button", { name: "Actions", exact: true })
    .click();
  const again = page.getByRole("dialog", { name: "Skill actions" });
  await expect(again.locator("[data-skill-job]")).toHaveCount(2);
  await expect(
    again.locator("[data-skill-job] [data-job-status='succeeded']"),
  ).toBeVisible();
  expect(
    frames.filter((frame) => frame.method === "skill/action/invoke"),
  ).toHaveLength(2);
});
