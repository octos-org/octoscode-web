import { expect, test, type Locator, type Page } from "@playwright/test";
import { holdTerminals, releaseTerminal } from "./fixture-controls";
import { FIXTURE_ORIGIN, openSessionId, startSession } from "./fixture-session";
import { sendPrompt } from "./sessions";

/**
 * plan.todos.v1 — the agent's live checklist above the composer.
 *
 * The fixture streams a plan sequence only to the plan token and drops the
 * feature entirely for the absent token, so this file covers both halves of
 * the gate: the card appearing, replacing itself wholesale, clearing on the
 * authoring turn's terminal, and the feature-absent case with no card at all.
 */

const PLAN_TOKEN = "plan-fixture-e2e-token";
const PROMPT = "Plan fixture";

function card(page: Page): Locator {
  return page.locator('[data-plan-card="true"]');
}

function rows(page: Page): Locator {
  return card(page).locator("li");
}

test("shows the plan, replaces it wholesale, and clears it when the turn ends", async ({
  page,
  request,
}) => {
  await startSession(page, "/workspace/plan-card", PLAN_TOKEN);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
  // Park this turn's terminal so the plan stays up while the spec reads it.
  await holdTerminals(request);
  await sendPrompt(page, PROMPT);

  // The first plan arrives with the turn.
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("Shipping the coding surface");
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText("Inspect the workspace");
  await expect(rows(page).nth(0)).toContainText("In progress");
  await expect(rows(page).nth(2)).toContainText("P2");
  await expect(card(page)).toContainText("0 of 3 done");

  // The card sits above the composer, not inside the transcript.
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  const planBox = (await card(page).boundingBox())!;
  const composerBox = (await composer.boundingBox())!;
  expect(planBox.y + planBox.height).toBeLessThanOrEqual(composerBox.y + 1);

  // The next `plan/updated` REPLACES the list — an item drops out and a new
  // one appears. A client that merged would show four rows here.
  expect(
    (await request.post(`${FIXTURE_ORIGIN}/__test__/plan/advance`)).status(),
  ).toBe(204);
  await expect(card(page)).toContainText("Update the changelog");
  await expect(rows(page)).toHaveCount(3);
  await expect(card(page)).not.toContainText("Run product checks");
  await expect(card(page)).toContainText("1 of 3 done");

  // The authoring turn's terminal drops the checklist; nothing lingers.
  await releaseTerminal(request, await openSessionId(page));
  await expect(card(page)).toHaveCount(0);
});
