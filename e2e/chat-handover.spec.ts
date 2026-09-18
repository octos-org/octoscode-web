import { expect, test, type Page } from "@playwright/test";

// Contract fixture coverage: the current Core does not advertise external_driver_v1.
// The handover workspace starts idle with a parked external binding, so a
// refused send reaches admission and an explicit acquire can resume chat.
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "tab-scoped-e2e-token";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const CWD = "/srv/work/peer-control-";
/** §6 row 1 copy. */
const FOREIGN_HOLDER = "Another app is using this session";
const RELEASE_METHOD = "session/driver/release";
const START_METHOD = "turn/start";

const productNavigation = (page: Page) => page.locator("aside");
const composer = (page: Page) => page.getByPlaceholder(COMPOSER_PLACEHOLDER);
const strip = (page: Page) =>
  page.getByRole("button", { name: "Session settings", exact: true });

interface SentFrame {
  readonly method: string | null;
  readonly releaseNext: string | null;
  readonly prompt: string | null;
}
function wire(page: Page) {
  const sent: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload)) as {
          method?: string;
          params?: { next?: string; input?: Array<{ text?: string }> };
        };
        if (frame.method)
          sent.push({
            method: frame.method,
            releaseNext: frame.params?.next ?? null,
            prompt: frame.params?.input?.[0]?.text ?? null,
          });
      } catch {
        // Non-JSON frames are not this surface's; ignore.
      }
    });
  });
  return {
    sent,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
  };
}

async function connectAndStartWorkspace(page: Page, variant: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(`${CWD}${variant}`);
  await add
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .click();
  await expect(composer(page)).toBeEnabled();
}

/** Open the pane's Advanced section (the seat's only product home, §4.2). */
async function openAdvanced(page: Page) {
  await strip(page).click();
  const pane = page.getByRole("dialog", {
    name: "Session settings",
    exact: true,
  });
  await expect(pane).toBeVisible();
  const advanced = pane.locator("details.session-config-advanced");
  if ((await advanced.getAttribute("open")) === null) {
    await advanced.locator(":scope > summary").click();
  }
  return pane;
}

async function sendPrompt(page: Page, text: string) {
  await composer(page).fill(text);
  await page
    .getByRole("button", { name: /^(Send|Queue) prompt$/, exact: false })
    .click();
}

test.describe("§5.2 composer handover (external-held session)", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${FIXTURE_ORIGIN}/__test__/driver/reset-all`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reset`);
  });

  test("an external-held session refuses chat and keeps the draft", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, "handover-refused");
    const pane = await openAdvanced(page);
    await expect(pane).toContainText(FOREIGN_HOLDER);
    await pane.getByRole("button", { name: "Close", exact: true }).click();

    await sendPrompt(page, "keep this draft");
    await expect(
      page.getByText("Turn not sent", { exact: true }),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("keep this draft");
    expect(w.calls(START_METHOD)).toHaveLength(0);
    expect(w.calls(RELEASE_METHOD)).toHaveLength(0);
  });

  test("Resume chat and an owned seat release control before sending once", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, "handover-resume");
    await sendPrompt(page, "hand back and send once");
    await expect(composer(page)).toHaveValue("hand back and send once");
    const pane = await openAdvanced(page);
    const resume = pane
      .locator('[data-session-config-action="resume-chat"]')
      .first();
    await expect(resume).toBeEnabled();
    await resume.click();

    await expect.poll(() => w.calls(START_METHOD).length).toBe(1);
    expect(
      w.sent
        .filter((frame) =>
          ["session/driver/acquire", RELEASE_METHOD, START_METHOD].includes(
            frame.method ?? "",
          ),
        )
        .map((frame) => frame.method),
    ).toEqual(["session/driver/acquire", RELEASE_METHOD, START_METHOD]);
    expect(w.calls(RELEASE_METHOD)[0]?.releaseNext).toBe("internal");
    expect(w.calls(START_METHOD)[0]?.prompt).toBe("hand back and send once");
    await expect(composer(page)).toHaveValue("");

    // Acquiring our own seat is a separate path: the next ordinary send must
    // release that proof, without another acquire or an admission refusal.
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await pane
      .getByRole("button", { name: "Acquire seat", exact: true })
      .click();
    await expect(
      pane.getByRole("button", { name: "Release seat", exact: true }),
    ).toBeEnabled();
    await pane.getByRole("button", { name: "Close", exact: true }).click();
    const before = w.sent.length;
    await sendPrompt(page, "send from my seat");
    await expect.poll(() => w.calls(START_METHOD).length).toBe(2);
    expect(
      w.sent
        .slice(before)
        .filter((frame) =>
          ["session/driver/acquire", RELEASE_METHOD, START_METHOD].includes(
            frame.method ?? "",
          ),
        )
        .map((frame) => [frame.method, frame.releaseNext]),
    ).toEqual([
      [RELEASE_METHOD, "internal"],
      [START_METHOD, null],
    ]);
    expect(w.calls(START_METHOD)[1]?.prompt).toBe("send from my seat");
    await expect(composer(page)).toHaveValue("");
  });
});
