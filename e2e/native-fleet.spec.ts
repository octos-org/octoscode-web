import { expect, test } from "@playwright/test";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { observeFrames } from "./turn-observers";

const CWD = "/srv/work/native-workflows-fleet";

test("native Fleet uses prepare/open/start, gather, steer and interrupt", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const wire = observeFrames(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, CWD);

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
  expect(wire.calls("peer/prepare")).not.toHaveLength(0);
  expect(wire.calls("session/open")).not.toHaveLength(0);
  expect(wire.calls("turn/start")).not.toHaveLength(0);
  expect(wire.calls("peer/dispatch")).toHaveLength(0);
  await expect(
    fleet.locator('[data-fleet-advanced-summary="true"]'),
  ).toHaveCount(0);

  await fleet.locator('[data-fleet-action="gather"]').press("Enter");
  await expect(fleet.getByText("Gather queued in this Session")).toBeVisible();
  expect(wire.calls("peer/gather")).not.toHaveLength(0);
  expect(
    wire
      .calls("turn/start")
      .some((frame) =>
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
  await expect.poll(() => wire.calls("turn/steer").length).toBeGreaterThan(0);

  await fleet
    .locator(`[data-fleet-row="${slug}"] [data-fleet-action="stop"]`)
    .press("Enter");
  await expect
    .poll(() => wire.calls("turn/interrupt").length)
    .toBeGreaterThan(0);
});
