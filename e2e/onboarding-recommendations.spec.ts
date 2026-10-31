import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};
const FAMILY_IDS = [
  "zai-coding",
  "deepseek",
  "moonshot",
  "zai",
  "dashscope",
  "minimax",
  "zhipu",
  "anthropic",
  "gemini",
  "groq",
  "local",
  "minimax-cn",
  "moonshot-coding",
  "nvidia",
  "ollama",
  "openai",
  "openrouter",
  "r9s",
  "vertex",
  "vllm",
];

async function openOnboarding(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const path = page.getByLabel("Server workspace path");
  await path.fill("/srv/work/no-profile");
  await path.press("Enter");
  return page.getByRole("dialog", { name: "Set up your coding assistant" });
}

test("recommended providers stay concise, readable, and reachable on mobile", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (
        frame.result?.families &&
        typeof frame.result.families === "object" &&
        !Array.isArray(frame.result.families) &&
        "deepseek" in frame.result.families
      ) {
        frame.result.families = Object.fromEntries(
          FAMILY_IDS.map((id) => [
            id,
            {
              id,
              env: "TEST_API_KEY",
              models: [
                {
                  id: id === "zai-coding" ? "glm-5.3" : `${id}-model`,
                  endpoints: [],
                },
              ],
            },
          ]),
        );
        message = JSON.stringify(frame);
      }
      socket.send(message);
    });
  });
  const onboarding = await openOnboarding(page);
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByRole("radio")).toHaveCount(6);
  await expect(
    onboarding.getByRole("radio", { name: /Z.ai Coding Plan/ }),
  ).toBeChecked();
  await expect(
    onboarding.getByRole("radio", { name: /Anthropic/ }),
  ).toHaveCount(0);
  await expect(
    onboarding.getByRole("button", { name: "Continue" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('section[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(onboarding).toHaveScreenshot(
    "onboarding-recommendations.png",
    SNAPSHOT,
  );

  await onboarding.getByText("More providers", { exact: true }).click();
  await expect(
    onboarding.getByRole("radio", { name: /Anthropic/ }),
  ).toBeVisible();
  await expect(
    onboarding.getByText("Claude models from Anthropic"),
  ).toBeVisible();
  await expect(
    onboarding.getByRole("radio", { name: /Google Gemini/ }),
  ).toBeVisible();
  await expect(onboarding.getByText("Gemini models from Google")).toBeVisible();
  await expect(onboarding.getByRole("radio")).toHaveCount(20);
  await onboarding.getByText("More providers", { exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const continueButton = onboarding.getByRole("button", { name: "Continue" });
  const box = await continueButton.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await expect(onboarding).toHaveScreenshot(
    "onboarding-recommendations-mobile.png",
    SNAPSHOT,
  );
});
