import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "tab-scoped-e2e-token";
const CWD = "/srv/work/native-workflows-fleet";

interface SentFrame {
  method: string;
  params?: Record<string, unknown>;
}

function observe(page: Page): SentFrame[] {
  const sent: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as SentFrame;
      if (frame.method) sent.push(frame);
    });
  });
  return sent;
}

async function connect(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(TOKEN);
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .press("Enter");
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible())
    await chooser.getByRole("button", { name: "Add workspace" }).press("Enter");
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(CWD);
  await add
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .press("Enter");
  await expect(page.getByText(CWD, { exact: true })).toBeVisible();
}

test("native Fleet uses prepare/open/start, gather, steer and interrupt", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sent = observe(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connect(page);

  const entry = page.locator('aside [data-fleet-nav="entry"]');
  await expect(entry).toBeEnabled();
  await entry.click();
  const fleet = page.locator('section[aria-label="Fleet"]');
  await expect(fleet).toBeVisible();
  await expect(fleet.locator('[data-fleet-field="model"]')).toHaveCount(0);
  await expect(fleet.locator('[data-fleet-field="session"]')).toHaveCount(0);
  await fleet
    .locator('[data-fleet-field="brief"]')
    .fill("Native peer integration");
  await fleet.locator('[data-fleet-action="start"]').press("Enter");

  const rows = fleet.locator("[data-fleet-row]");
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await expect(rows.first()).toHaveAttribute("data-fleet-status", "Working");
  expect(sent.some((frame) => frame.method === "peer/prepare")).toBe(true);
  expect(sent.some((frame) => frame.method === "session/open")).toBe(true);
  expect(sent.some((frame) => frame.method === "turn/start")).toBe(true);
  expect(sent.some((frame) => frame.method === "peer/dispatch")).toBe(false);
  await expect(
    fleet.locator('[data-fleet-advanced-summary="true"]'),
  ).toHaveCount(0);

  await fleet.locator('[data-fleet-action="gather"]').press("Enter");
  await expect(fleet.getByText("Gather queued in this Session")).toBeVisible();
  expect(sent.some((frame) => frame.method === "peer/gather")).toBe(true);
  expect(
    sent.some(
      (frame) =>
        frame.method === "turn/start" &&
        JSON.stringify(frame.params).includes("Peer results gathered"),
    ),
  ).toBe(true);

  const slug = (await rows.first().getAttribute("data-fleet-row"))!;
  await fleet
    .locator(`[data-fleet-field="steer-${slug}"]`)
    .fill("Please narrow the scope");
  await fleet
    .locator(`[data-fleet-row="${slug}"] [data-fleet-action="steer"]`)
    .press("Enter");
  await expect
    .poll(() => sent.some((frame) => frame.method === "turn/steer"))
    .toBe(true);

  await fleet
    .locator(`[data-fleet-row="${slug}"] [data-fleet-action="stop"]`)
    .press("Enter");
  await expect
    .poll(() => sent.some((frame) => frame.method === "turn/interrupt"))
    .toBe(true);
  await fleet.getByText("Finished (1)", { exact: true }).click();
  await expect(fleet.locator(`[data-fleet-row="${slug}"]`)).toHaveAttribute(
    "data-fleet-status",
    "Stopped",
  );
});
