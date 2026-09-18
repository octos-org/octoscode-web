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
  readonly media: unknown;
  readonly reasoning: string | undefined;
}
function wire(page: Page) {
  const sent: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload)) as {
          method?: string;
          params?: {
            next?: string;
            input?: Array<{ text?: string }>;
            media?: unknown;
            reasoning_effort?: string;
          };
        };
        if (frame.method)
          sent.push({
            method: frame.method,
            releaseNext: frame.params?.next ?? null,
            prompt: frame.params?.input?.[0]?.text ?? null,
            media: frame.params?.media,
            reasoning: frame.params?.reasoning_effort,
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

async function connectAndStartWorkspace(page: Page, workspace: string) {
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
  await add.getByLabel("Server workspace path").fill(workspace);
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

async function uploadedDraft(page: Page) {
  let uploads = 0;
  let handle = "";
  const buffer = Buffer.from("fixture image bytes");
  await page.route("**/api/upload", async (route) => {
    uploads++;
    const profile = route.request().headers()["x-profile-id"];
    expect(profile).toBeTruthy();
    handle = `up/${Buffer.from(`${profile}/fixture-image`).toString("base64url")}/original.png`;
    await route.fulfill({ json: [handle] });
  });
  await sendPrompt(page, "/thinking high");
  await sendPrompt(page, "/images");
  const images = page.getByRole("dialog", { name: "Turn images" });
  await images.getByLabel("Choose image files").setInputFiles({
    name: "original.png",
    mimeType: "image/png",
    buffer,
  });
  await images.getByRole("button", { name: "Upload selected images" }).click();
  await expect(
    images.getByText("Uploaded; ready for this turn", { exact: true }),
  ).toBeVisible();
  await images
    .getByRole("button", { name: "Close images", exact: true })
    .click();
  return {
    uploads: () => uploads,
    media: () => [
      { path: handle, mime: "image/png", size_bytes: buffer.length },
    ],
  };
}

test.describe("§5.2 composer handover (external-held session)", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${FIXTURE_ORIGIN}/__test__/driver/reset-all`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reset`);
  });

  test("an external-held session restores uploaded media and reasoning for an explicit retry", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, `${CWD}handover-refused`);
    const pane = await openAdvanced(page);
    await expect(pane).toContainText(FOREIGN_HOLDER);
    await pane.getByRole("button", { name: "Close", exact: true }).click();

    const upload = await uploadedDraft(page);
    await sendPrompt(page, "keep this draft");
    await expect(
      page.getByText("Turn not sent", { exact: true }),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("keep this draft");
    expect(w.calls(START_METHOD)).toHaveLength(0);
    expect(w.calls(RELEASE_METHOD)).toHaveLength(0);
    await page
      .getByRole("button", {
        name: "1 image(s) attached · inspect",
        exact: true,
      })
      .click();
    const images = page.getByRole("dialog", { name: "Turn images" });
    await expect(
      images.getByText("original.png", { exact: true }),
    ).toBeVisible();
    await expect(
      images.getByText("Uploaded; ready for this turn", { exact: true }),
    ).toBeVisible();
    await images
      .getByRole("button", { name: "Close images", exact: true })
      .click();
    const retryPane = await openAdvanced(page);
    await retryPane
      .locator('[data-session-config-action="resume-chat"]')
      .first()
      .click();
    await expect.poll(() => w.calls(START_METHOD).length).toBe(1);
    expect(w.calls(START_METHOD)[0]).toMatchObject({
      prompt: "keep this draft",
      media: upload.media(),
      reasoning: "high",
    });
    expect(upload.uploads()).toBe(1);
    await expect(composer(page)).toHaveValue("");
    await expect(
      page.getByRole("button", { name: /image\(s\) attached/ }),
    ).toHaveCount(0);
  });

  test("Resume chat and an owned seat release control before sending once", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, `${CWD}handover-resume`);
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

test("a late collision cannot replace newer text or images, then restores the complete draft", async ({
  page,
}, testInfo) => {
  let refuse: (() => void) | undefined;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === START_METHOD && !refuse) {
        refuse = () =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32600,
                message: "Session occupied",
                data: {
                  kind: "turn_in_progress",
                  turn_id: "3f1a9c52-4d1b-4c2e-8f6a-0b7d21e9c4aa",
                },
              },
            }),
          );
      } else server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await connectAndStartWorkspace(page, "/srv/work/collision-draft");
  const upload = await uploadedDraft(page);
  await sendPrompt(page, "return this complete draft");
  await expect.poll(() => Boolean(refuse)).toBe(true);
  await expect(composer(page)).toHaveValue("");
  await sendPrompt(page, "/thinking low");
  await sendPrompt(page, "/images");
  const images = page.getByRole("dialog", { name: "Turn images" });
  await images.getByLabel("Choose image files").setInputFiles({
    name: "new.png",
    mimeType: "image/png",
    buffer: Buffer.from("new selection"),
  });
  await images
    .getByRole("button", { name: "Close images", exact: true })
    .click();
  await composer(page).fill("newer text stays");
  refuse!();
  await expect(page.getByText("Session busy", { exact: true })).toBeVisible();
  await expect(strip(page)).toContainText(
    "Another client is working in this session",
  );
  await expect(composer(page)).toHaveValue("newer text stays");
  await composer(page).fill("");
  await page
    .getByRole("button", { name: "1 image(s) attached · inspect", exact: true })
    .click();
  await expect(images.getByText("new.png", { exact: true })).toBeVisible();
  await expect(
    images.getByText("Selected; not uploaded", { exact: true }),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  await images
    .getByRole("button", { name: "Remove image new.png", exact: true })
    .click();
  await expect(images.getByText("original.png", { exact: true })).toBeVisible();
  await expect(
    images.getByText("Uploaded; ready for this turn", { exact: true }),
  ).toBeVisible();
  await images
    .getByRole("button", { name: "Close images", exact: true })
    .click();
  await expect(composer(page)).toHaveValue("return this complete draft");
  expect(upload.uploads()).toBe(1);
  await testInfo.attach("returned-media-draft", {
    body: await page.screenshot({
      path: testInfo.outputPath("returned-media-draft.png"),
    }),
    contentType: "image/png",
  });
  // Opening a local command does not send the returned prompt.
  await sendPrompt(page, "/thinking");
  await expect(page.getByLabel("Effort for new prompts")).toHaveValue("high");
});
