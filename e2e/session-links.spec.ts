import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, FIXTURE_TOKEN, startSession } from "./fixture-session";
import { composer } from "./sessions";
import { observeFrames } from "./turn-observers";

const SAVED_REFERENCE = [
  "/workspace/saved-link",
  "_main",
  "_main:api:web-saved-link",
] as const;

interface ObservedRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Records what the page sends; every opened Session reports another workspace. */
async function openInWrongWorkspace(page: Page) {
  const requests: ObservedRequest[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const methods = new Map<string, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as ObservedRequest;
      requests.push(request);
      methods.set(request.id, request.method);
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (
        methods.get(response.id) === "session/open" &&
        response.result?.opened
      ) {
        response.result.opened.workspace_root = "/workspace/unrelated";
        socket.send(JSON.stringify(response));
      } else socket.send(message);
    });
  });
  return requests;
}

async function authenticate(page: Page) {
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
}

async function createConversation(page: Page) {
  await startSession(page, SAVED_REFERENCE[0]);
  // Upstream's fixture answered every session/hydrate with a canned Markdown
  // transcript, so a conversation had history the instant it was created. Our
  // Sessions are durable records: a brand-new one starts empty and earns its
  // transcript. Run one turn so the conversation this test bookmarks has a
  // genuinely persisted transcript to restore — the round trip below then
  // proves durable replay rather than a fixture constant every socket is
  // handed.
  await composer(page).fill("Show the Markdown transcript surface");
  await composer(page).press("Enter");
  await expect(page.locator(".markdown-body").first()).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("s"))
    .not.toBeNull();
}

function savedPath(reference: readonly string[] = SAVED_REFERENCE) {
  return `/?s=${encodeURIComponent(JSON.stringify(reference))}`;
}

test("opens a bookmarked conversation in a fresh browser only after an explicit choice", async ({
  page,
  browser,
}) => {
  await createConversation(page);
  await expect(
    page.getByRole("button", { name: "Copy code block" }),
  ).toBeVisible();
  const savedUrl = page.url();
  const key = new URL(savedUrl).searchParams.get("s")!;
  const reference = JSON.parse(key) as string[];
  const originalTranscript = await page
    .locator(".markdown-body")
    .allTextContents();
  const newContext = await browser.newContext();
  try {
    expect(await newContext.storageState()).toEqual({
      cookies: [],
      origins: [],
    });
    const freshPage = await newContext.newPage();
    const wire = observeFrames(freshPage);
    await freshPage.goto(savedUrl);
    expect(wire.sent).toHaveLength(0);
    await authenticate(freshPage);
    const panel = freshPage.getByRole("region", {
      name: "Open saved conversation",
    });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(reference[0]!);
    await expect(panel).toContainText(FIXTURE_ORIGIN);
    expect(wire.calls("session/open")).toHaveLength(0);
    expect(new URL(freshPage.url()).searchParams.get("s")).toBe(key);

    await panel
      .getByRole("button", { name: "Open conversation", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(freshPage.locator(".markdown-body").first()).toBeVisible();
    await expect(
      freshPage.getByRole("button", { name: "Copy code block" }),
    ).toBeVisible();
    expect(await freshPage.locator(".markdown-body").allTextContents()).toEqual(
      originalTranscript,
    );
    expect(wire.calls("session/open").map((call) => call.params)).toEqual([
      { session_id: reference[2], profile_id: reference[1], cwd: reference[0] },
    ]);
    expect(wire.calls("turn/start")).toHaveLength(0);
    expect(new URL(freshPage.url()).searchParams.get("s")).toBe(key);
  } finally {
    await newContext.close();
  }
});

test("refuses a saved-link candidate with a different workspace before requesting history", async ({
  page,
}) => {
  const requests = await openInWrongWorkspace(page);
  await page.goto(savedPath());
  await authenticate(page);
  const panel = page.getByRole("region", { name: "Open saved conversation" });
  await panel
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveCount(0);
  expect(
    requests.filter((request) => request.method === "session/open"),
  ).toHaveLength(1);
  expect(
    requests.filter((request) => request.method === "session/hydrate"),
  ).toHaveLength(0);
  expect(new URL(page.url()).searchParams.get("s")).toBe(
    JSON.stringify(SAVED_REFERENCE),
  );
});
