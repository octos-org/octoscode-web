import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
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

async function observeRequests(
  page: Page,
  mode: "pass" | "reject-once" | "wrong-workspace" = "pass",
) {
  const requests: ObservedRequest[] = [];
  let rejected = false;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const methods = new Map<string, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as ObservedRequest;
      requests.push(request);
      methods.set(request.id, request.method);
      if (
        mode === "reject-once" &&
        !rejected &&
        request.method === "session/open"
      ) {
        rejected = true;
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32041, message: "Saved conversation unavailable" },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (
        mode === "wrong-workspace" &&
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
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
}

async function createConversation(page: Page) {
  await page.goto("/");
  await authenticate(page);
  await page.getByLabel("Server workspace path").fill(SAVED_REFERENCE[0]);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(page.locator(".markdown-body").first()).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("s"))
    .not.toBeNull();
}

async function openGeneralSettings(page: Page) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "General", exact: true }).click();
  return settings;
}

function savedPath(reference: readonly string[] = SAVED_REFERENCE) {
  return `/?s=${encodeURIComponent(JSON.stringify(reference))}`;
}

test("a different saved link takes precedence over the tab's remembered conversation", async ({
  page,
}) => {
  await createConversation(page);
  const reference = ["/workspace/another-link", "_main", "_main:api:other"];
  const requests = await observeRequests(page);
  await page.goto(savedPath(reference));
  const panel = page.getByRole("region", { name: "Open saved conversation" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(reference[0]!);
  expect(
    requests.filter((request) => request.method === "session/open"),
  ).toHaveLength(0);
  expect(new URL(page.url()).searchParams.get("s")).toBe(
    JSON.stringify(reference),
  );
  await panel
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Message Octos", exact: true }),
  ).toBeVisible();
  const opens = requests.filter((request) => request.method === "session/open");
  expect(opens).toHaveLength(1);
  expect(opens[0]?.params).toMatchObject({
    cwd: reference[0],
    profile_id: reference[1],
    session_id: reference[2],
  });
  expect(
    requests.filter((request) => request.method === "turn/start"),
  ).toHaveLength(0);
});

test("opens a bookmarked conversation in a fresh browser only after an explicit choice", async ({
  page,
  browser,
}, testInfo) => {
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
    const requests = await observeRequests(freshPage);
    await freshPage.goto(savedUrl);
    expect(requests).toHaveLength(0);
    await authenticate(freshPage);
    const panel = freshPage.getByRole("region", {
      name: "Open saved conversation",
    });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(reference[0]!);
    await expect(panel).toContainText(FIXTURE_ORIGIN);
    expect(
      requests.filter((request) => request.method === "session/open"),
    ).toHaveLength(0);
    expect(new URL(freshPage.url()).searchParams.get("s")).toBe(key);
    await panel.screenshot({
      path: testInfo.outputPath("saved-conversation-preview.png"),
    });

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
    expect(
      requests
        .filter((request) => request.method === "session/open")
        .map((request) => request.params),
    ).toEqual([
      { session_id: reference[2], profile_id: reference[1], cwd: reference[0] },
    ]);
    expect(
      requests.filter((request) => request.method === "turn/start"),
    ).toHaveLength(0);
    expect(new URL(freshPage.url()).searchParams.get("s")).toBe(key);
  } finally {
    await newContext.close();
  }
});

test("keeps a failed saved link visible and retries only when requested", async ({
  page,
}) => {
  const requests = await observeRequests(page, "reject-once");
  await page.goto(savedPath());
  await authenticate(page);
  const panel = page.getByRole("region", { name: "Open saved conversation" });
  await panel
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("could not be opened");
  await expect(
    panel.getByRole("button", { name: "Open conversation", exact: true }),
  ).toBeEnabled();
  expect(
    requests.filter((request) => request.method === "session/open"),
  ).toHaveLength(1);
  expect(new URL(page.url()).searchParams.get("s")).toBe(
    JSON.stringify(SAVED_REFERENCE),
  );
  await panel
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".markdown-body").first()).toBeVisible();
  expect(
    requests.filter((request) => request.method === "session/open"),
  ).toHaveLength(2);
});

test("rejects invalid links without opening a session and allows normal entry after dismissal", async ({
  page,
}) => {
  const requests = await observeRequests(page);
  await page.goto(
    savedPath(["/workspace", "profile", "session", "unexpected"]),
  );
  await authenticate(page);
  await expect(page.getByRole("alert")).toContainText(
    "conversation link is invalid",
  );
  expect(
    requests.filter((request) => request.method === "session/open"),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Dismiss link" }).click();
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("s")).toBeNull();
});

test("refuses a saved-link candidate with a different workspace before requesting history", async ({
  page,
}) => {
  const requests = await observeRequests(page, "wrong-workspace");
  await page.goto(savedPath());
  await authenticate(page);
  const panel = page.getByRole("region", { name: "Open saved conversation" });
  await panel
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Message Octos" }),
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

test("reports a copied link only after the clipboard operation succeeds", async ({
  page,
}) => {
  await createConversation(page);
  await page.evaluate(() => {
    const runtime = window as unknown as {
      releaseCopy?: () => void;
      copiedText?: string;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          runtime.copiedText = text;
          return new Promise<void>((resolve) => {
            runtime.releaseCopy = resolve;
          });
        },
      },
    });
  });
  const settings = await openGeneralSettings(page);
  await settings
    .getByRole("button", { name: "Copy conversation link" })
    .click();
  await expect(
    settings.getByRole("button", { name: "Copying…" }),
  ).toBeDisabled();
  await expect(
    settings.getByRole("button", { name: "Copied", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { releaseCopy: () => void }).releaseCopy(),
  );
  await expect(
    settings.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  const copied = await page.evaluate(
    () => (window as unknown as { copiedText: string }).copiedText,
  );
  expect(new URL(copied).searchParams.get("s")).toBe(
    new URL(page.url()).searchParams.get("s"),
  );
  expect(copied).not.toContain("tab-scoped-e2e-token");
});

test("provides a selected readonly link when clipboard access is denied", async ({
  page,
}) => {
  await createConversation(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    });
  });
  const settings = await openGeneralSettings(page);
  await settings
    .getByRole("button", { name: "Copy conversation link" })
    .click();
  const fallback = settings.getByRole("textbox", {
    name: "Conversation link",
    exact: true,
  });
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("readonly", "");
  await expect(fallback).toBeFocused();
  expect(
    await fallback.evaluate(
      (node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart,
    ),
  ).toBe((await fallback.inputValue()).length);
  await expect(
    settings.getByRole("button", { name: "Copied", exact: true }),
  ).toHaveCount(0);
  expect(new URL(await fallback.inputValue()).searchParams.get("s")).toBe(
    new URL(page.url()).searchParams.get("s"),
  );
});

test("does not claim diagnostics were copied after clipboard rejection and allows retry", async ({
  page,
}) => {
  await createConversation(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    });
  });
  const settings = await openGeneralSettings(page);
  await settings.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(settings.getByRole("alert")).toContainText("clipboard");
  await expect(
    settings.getByRole("button", { name: "Copied", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Copy diagnostics" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await settings.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(
    settings.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(0);
});
