import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const chip = (page: Page) => page.locator("[data-draft-estimate]");
const estimateButton = (page: Page) =>
  page.getByRole("button", { name: /^This message ≈/ });
const panel = (page: Page) =>
  page.getByRole("group", { name: "Before sending" });

/** The transcript estimate `session/status/read` returned, per session, in order. */
function statusContexts(page: Page) {
  const seen: Array<{ session: string; tokens: number }> = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      // Only `session/status/read` (it carries `runtime_mode`); hydrate has
      // its own copy.
      const state = frame?.result?.runtime_mode
        ? frame.result.context_state
        : null;
      if (state && typeof state.token_estimate === "number")
        seen.push({ session: state.session_id, tokens: state.token_estimate });
    }),
  );
  return seen;
}

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(composer(page)).toBeEnabled();
}

async function sendAndSettle(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(
    page.getByText("Completed with", { exact: false }).last(),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue("");
}

async function openEstimate(page: Page) {
  await estimateButton(page).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

const exact = (value: number) => new Intl.NumberFormat("en-US").format(value);

test("before sending, the composer shows this message's estimate and the server's context, never a price", async ({
  page,
}) => {
  const contexts = statusContexts(page);
  await start(page, "/workspace/draft-estimate");
  // An empty composer shows nothing.
  await expect(chip(page)).toHaveCount(0);
  await expect.poll(() => contexts.length).toBeGreaterThan(0);
  const first = contexts[0]!;

  // Short draft: 15 ASCII characters is 3 tokens by Core's count, plus 4 for
  // the message. No reply yet, so the window is unknown.
  await composer(page).fill("Review the plan");
  await expect(estimateButton(page)).toHaveAccessibleName(
    "This message ≈7 tokens, estimated",
  );
  let estimate = await openEstimate(page);
  await expect(estimate).toContainText(`Context so far≈${exact(first.tokens)}`);
  await expect(estimate).toContainText(
    "instructions and tool definitions sent with every request are not in it",
  );
  await expect(estimate).toContainText(
    "The context window is known once this session replies while this page is open.",
  );
  await expect(estimate).toContainText(
    "Not included: the reply, and this turn’s tool calls and their output.",
  );
  await expect(estimate).toContainText("No price before sending");
  await expect(estimate).not.toContainText("After sending");
  await expect(estimate).not.toContainText(/[$¥€]|USD|CNY/);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(estimate).toBeHidden();

  // Long draft: 4,000 characters, counted the way the server counts.
  await composer(page).fill("x".repeat(4_000));
  await expect(estimateButton(page)).toHaveAccessibleName(
    "This message ≈1,004 tokens, estimated",
  );

  // Clearing the draft hides it again.
  await composer(page).fill("   ");
  await expect(chip(page)).toHaveCount(0);

  // After a reply the server has reported its prompt estimate and the window.
  // The fixture reports 50,000 plus the session's transcript estimate.
  const promptOf = (tokens: number) => 50_000 + tokens;
  const percentOf = (tokens: number) =>
    `${Math.round(((promptOf(tokens) + 7) / 1_000_000) * 100)}% of 1,000,000`;
  await sendAndSettle(page, "Summarise the repository");
  await expect(chip(page)).toHaveCount(0);
  await composer(page).fill("Review the plan");
  estimate = await openEstimate(page);
  await expect(estimate).toContainText(
    `Context so far≈${exact(promptOf(first.tokens))}`,
  );
  await expect(estimate).toContainText(
    `After sending≈${percentOf(first.tokens)}`,
  );
  await expect(estimate).toContainText(
    "the last prompt it sent, instructions and tool definitions included",
  );
  await expect(estimate).not.toContainText("known once this session replies");
  await expect(estimate).not.toContainText(/[$¥€]|USD|CNY/);
  await page.keyboard.press("Escape");
  await composer(page).fill("");

  // A new session in the same folder: its own context, none of the last one's.
  const navigation = page.locator("aside");
  await navigation
    .getByRole("treeitem", { name: "draft-estimate", exact: true })
    .hover();
  await navigation
    .getByRole("button", { name: "New session in draft-estimate", exact: true })
    .click();
  await expect(composer(page)).toBeEnabled();
  await expect
    .poll(() => contexts.find((entry) => entry.session !== first.session))
    .toBeTruthy();
  const second = contexts.find((entry) => entry.session !== first.session)!;
  await composer(page).fill("Review the plan");
  estimate = await openEstimate(page);
  await expect(estimate).toContainText(
    `Context so far≈${exact(second.tokens)}`,
  );
  await expect(estimate).not.toContainText(exact(promptOf(first.tokens)));
  await expect(estimate).not.toContainText("After sending");
  await expect(estimate).toContainText("known once this session replies");
  await page.keyboard.press("Escape");

  // B replies too, with its own report.
  await sendAndSettle(page, "Check the test suite");
  await composer(page).fill("Review the plan");
  estimate = await openEstimate(page);
  await expect(estimate).toContainText(
    `Context so far≈${exact(promptOf(second.tokens))}`,
  );
  await page.keyboard.press("Escape");
  await composer(page).fill("");

  // Back to A: its latest report and window, not the value its reopen read
  // and nothing of B's.
  const reopenReads = contexts.length;
  await navigation
    .getByRole("treeitem", { name: /Summarise the repository/ })
    .click();
  await expect
    .poll(() =>
      contexts
        .slice(reopenReads)
        .some((entry) => entry.session === first.session),
    )
    .toBe(true);
  await expect(page.getByText("Completed with").first()).toBeVisible();
  await composer(page).fill("Review the plan");
  estimate = await openEstimate(page);
  await expect(estimate).toContainText(
    `Context so far≈${exact(promptOf(first.tokens))}`,
  );
  await expect(estimate).toContainText(
    `After sending≈${percentOf(first.tokens)}`,
  );
  await expect(estimate).toContainText("tool definitions included");
  await expect(estimate).not.toContainText(exact(promptOf(second.tokens)));
  await expect(estimate).not.toContainText(
    `Context so far≈${exact(first.tokens)}`,
  );
});

test("the threshold warning comes from the server's own number", async ({
  page,
}) => {
  await start(page, "/workspace/draft-estimate-full");
  await sendAndSettle(page, "Summarise the repository");

  // 699,950 + 5 stays under the server's 700,000.
  await composer(page).fill("hi");
  await expect(estimateButton(page)).toHaveAccessibleName(
    "This message ≈5 tokens, estimated",
  );
  await expect(estimateButton(page)).not.toHaveAttribute("data-tone");

  // 699,950 + 104 reaches it.
  await composer(page).fill("x".repeat(400));
  await expect(estimateButton(page)).toHaveAccessibleName(
    "This message ≈104 tokens, estimated. The server will compact first.",
  );
  await expect(estimateButton(page)).toHaveAttribute("data-tone", "attention");
  const estimate = await openEstimate(page);
  await expect(estimate).toContainText(
    "reaches the server’s compaction threshold of about 700,000",
  );
  await expect(estimate).toContainText("After sending≈70% of 1,000,000");
});

test("on a phone the estimate stays beside the input, not over it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, "/workspace/draft-estimate-phone");
  await composer(page).fill("x".repeat(4_000));
  await expect(estimateButton(page)).toHaveText("≈1,004");
  const input = (await composer(page).boundingBox())!;
  const box = (await estimateButton(page).boundingBox())!;
  const overlaps =
    box.x < input.x + input.width &&
    input.x < box.x + box.width &&
    box.y < input.y + input.height &&
    input.y < box.y + box.height;
  expect(overlaps).toBe(false);
  const estimate = await openEstimate(page);
  const open = (await estimate.boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.scrollingElement!.scrollWidth <=
        document.scrollingElement!.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveValue("x".repeat(4_000));
});
