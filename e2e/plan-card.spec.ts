import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * plan.todos.v1 — the agent's live checklist above the composer.
 *
 * The fixture streams a plan sequence only to the plan token and drops the
 * feature entirely for the absent token, so this file covers both halves of
 * the gate: the card appearing, replacing itself wholesale, clearing on the
 * authoring turn's terminal, and the feature-absent case with no card at all.
 */

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const PLAN_TOKEN = "plan-fixture-e2e-token";
const ABSENT_TOKEN = "plan-absent-e2e-token";
const PROMPT = "Plan fixture";

async function start(page: Page, token: string, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

function card(page: Page): Locator {
  return page.locator('[data-plan-card="true"]');
}

function rows(page: Page): Locator {
  return card(page).locator("li");
}

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill(text);
  await input.press("Enter");
}

/** Park this turn's terminal so the plan stays up while the spec reads it. */
async function holdTerminal(request: APIRequestContext) {
  expect(
    (
      await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/hold-next`)
    ).status(),
  ).toBe(204);
}

async function releaseTerminal(request: APIRequestContext) {
  const state = (await (
    await request.get(`${FIXTURE_ORIGIN}/__test__/terminal/state`)
  ).json()) as { held: { session_id: string }[] };
  const owner = state.held[0]!.session_id;
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/terminal/release?session_id=${encodeURIComponent(owner)}`,
      )
    ).status(),
  ).toBe(204);
}

test("shows the plan, replaces it wholesale, and clears it when the turn ends", async ({
  page,
  request,
}) => {
  await start(page, PLAN_TOKEN, "/workspace/plan-card");
  await holdTerminal(request);
  await send(page, PROMPT);

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
  await releaseTerminal(request);
  await expect(card(page)).toHaveCount(0);
});

test("collapses and expands from the keyboard without losing the plan", async ({
  page,
  request,
}) => {
  await start(page, PLAN_TOKEN, "/workspace/plan-keyboard");
  await holdTerminal(request);
  await send(page, PROMPT);
  await expect(card(page)).toBeVisible();

  const toggle = card(page).getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rows(page).first()).toBeVisible();

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rows(page).first()).toBeHidden();
  // Collapsed, the header still names the work and its progress.
  await expect(toggle).toContainText("Shipping the coding surface");
  await expect(toggle).toContainText("done");

  await page.keyboard.press(" ");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rows(page).first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('[data-plan-card="true"]')
    .analyze();
  expect(results.violations).toEqual([]);
  await releaseTerminal(request);
});

test("renders no plan surface when the server does not advertise the feature", async ({
  page,
}) => {
  await start(page, ABSENT_TOKEN, "/workspace/plan-absent");
  await send(page, PROMPT);
  // The turn runs and completes normally…
  await expect(page.getByText("all tests passing")).toBeVisible();
  // …and nothing is pinned above the composer.
  await expect(card(page)).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
});
