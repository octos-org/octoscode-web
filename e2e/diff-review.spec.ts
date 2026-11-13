import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session";

type PreviewLine = {
  kind: string;
  content: string;
  old_line?: number;
  new_line?: number;
};

async function openReview(page: Page, lines: PreviewLine[]) {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const requests = new Map<string | number, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      requests.set(request.id, request.method);
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (requests.get(response.id) === "diff/preview/get") {
        response.result.preview.title = "Review precise code changes";
        response.result.preview.files = [
          {
            path: "src/settings.ts",
            status: "modified",
            hunks: [{ header: "@@ -1,3 +1,3 @@", lines }],
          },
        ];
      }
      socket.send(JSON.stringify(response));
    });
  });
  await startSession(page, "/workspace/diff-review");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");
  // The turn's file mutation counts on the toggle before anything opens.
  await expect(panelToggle(page)).toHaveAccessibleName(
    "Session panel, 1 changed",
  );
  return openChanges(page);
}

const panelToggle = (page: Page) =>
  page.getByRole("button", { name: /^Session panel/ });

/** Opens the session panel on its Changes tab: the diff sits beside the chat. */
async function openChanges(page: Page) {
  await panelToggle(page).click();
  await page.getByRole("tab", { name: /^Changes/ }).click();
  const changes = page.getByRole("tabpanel", { name: /^Changes/ });
  await expect(changes).toBeVisible();
  return changes;
}

const replacement: PreviewLine[] = [
  {
    kind: "context",
    content: "// Preserve every character of the proposed edit",
    old_line: 1,
    new_line: 1,
  },
  {
    kind: "removed",
    content: '\tconst 名称 = "旧值😀"; return false;  ',
    old_line: 2,
  },
  {
    kind: "added",
    content: '\tconst 名称 = "新值🌏"; return true;  ',
    new_line: 2,
  },
  {
    kind: "context",
    content: 'const html = "<img src=x onerror=alert(1)>";',
    old_line: 3,
    new_line: 3,
  },
];

test("diff syntax and word marks keep inert, selectable text beside the chat and on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openReview(page, replacement);
  const codes = dialog.locator(".diff-line > code");
  await expect(dialog.locator(".shiki-color-keyword").first()).toBeVisible();
  expect(await codes.allTextContents()).toEqual(
    replacement.map((line) => line.content),
  );
  expect(await dialog.locator("img, script").count()).toBe(0);
  expect(
    (
      await dialog
        .locator('.diff-removed [class*="changedWord"]')
        .allTextContents()
    ).join(""),
  ).toBe("旧值😀false");
  expect(
    (
      await dialog
        .locator('.diff-added [class*="changedWord"]')
        .allTextContents()
    ).join(""),
  ).toBe("新值🌏true");
  // The conversation stays readable beside the open diff.
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeInViewport();
  const selected = await codes.nth(2).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toBe(replacement[2]!.content);
  const hunk = dialog.locator(".diff-hunk");
  await hunk.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await hunk.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
    0,
  );
  await page.getByRole("button", { name: "Close session panel" }).click();
  await expect(dialog).toBeHidden();
  // On a phone the same tab opens as a drawer that fits the screen.
  await page.setViewportSize({ width: 320, height: 480 });
  await panelToggle(page).click();
  const drawer = page.getByRole("dialog", { name: "Session panel" });
  await expect(drawer.getByRole("tab", { name: /^Changes/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const close = await drawer
    .getByRole("button", { name: "Close session panel" })
    .boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(panelToggle(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test("Changes works before a turn and ignores a late workspace reply after changing scope", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let reads = 0;
  let openedProfile = "";
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const workspaceRequests = new Set<string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "diff/workspace/get") {
        expect(Object.keys(request.params).sort()).toEqual([
          "profile_id",
          "session_id",
        ]);
        expect(openedProfile).not.toBe("");
        expect(request.params.profile_id).toBe(openedProfile);
        workspaceRequests.add(request.id);
        reads++;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (response.result?.opened?.active_profile_id) {
        openedProfile = response.result.opened.active_profile_id;
      }
      if (workspaceRequests.has(response.id) && reads > 1) {
        release = () => socket.send(message);
      } else socket.send(message);
    });
  });
  await startSession(page, "/workspace/diff-review");
  const dialog = await openChanges(page);
  await expect(
    dialog.getByRole("heading", { name: "Workspace uncommitted changes" }),
  ).toBeVisible();
  await expect(dialog.locator(".diff-file").first()).toBeVisible();
  await expect(
    dialog.getByText(
      "Includes staged, unstaged and untracked files. Changes may come from other sessions.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await dialog
    .getByRole("button", { name: "This session", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "No session change preview yet. You can also inspect uncommitted Git changes.",
    ),
  ).toBeVisible();
  release!();
  await expect(dialog.locator(".diff-file")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "This session", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close session panel" }).click();
  await expect(dialog).toHaveCount(0);
});
