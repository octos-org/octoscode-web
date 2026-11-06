import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  COMPOSER_PLACEHOLDER,
  FIXTURE_ORIGIN,
  connectAndStartWorkspace,
  runFolder,
} from "./fixture-session.ts";

/**
 * A native peer keeps its identity across a full page reload (T-0082, dogfood
 * F-15). Before, a reload emptied the roster: the finished peer fell into the
 * ordinary Session list titled by its kickoff text, opened as an editable
 * Session with no way back to its master, and while it still sat on the roster
 * the strip kept saying "Peers running (1)" after it had finished.
 *
 * After a reload the page only knows the peer as a `session/list` row. The
 * coordinator asks `peer/gather` about the listed peer-shaped Sessions and puts
 * each one back under the master its gather row names (`originator`, which
 * the fixture sends as T-0454 asks Core to).
 */
const PEER_BRIEF = "Reply OK without reading or writing any files.";

const composer = (page: Page): Locator =>
  page.getByPlaceholder(COMPOSER_PLACEHOLDER);
const navigation = (page: Page): Locator => page.locator("aside");
const peerDock = (page: Page): Locator =>
  navigation(page).locator('section[role="region"][aria-label="Peers"]');
const dockRow = (page: Page, slug: string): Locator =>
  peerDock(page).locator(`button[data-peer-slug="${slug}"]`);
const dockActivity = (page: Page, slug: string): Locator =>
  dockRow(page, slug).locator("[data-activity]");
const sessionRow = (page: Page, sessionId: string): Locator =>
  navigation(page).locator(
    `[role="treeitem"][data-session-id*=${JSON.stringify(sessionId)}]`,
  );
const selectedSession = (page: Page): Locator =>
  navigation(page).locator('[role="treeitem"][aria-current="page"]');
const strip = (page: Page): Locator => page.getByTestId("session-status-strip");

async function sendPrompt(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page
    .getByRole("button", { name: /^(Send|Queue) prompt$/, exact: false })
    .click();
}

test("a finished peer keeps its place, read-only view and way back after a reload", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = runFolder("peer-reload");
  const staged: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: { slug?: unknown };
      };
      if (
        frame.method === "peer/staged" &&
        typeof frame.params?.slug === "string"
      )
        staged.push(frame.params.slug);
    }),
  );
  try {
    await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
    // List this workspace's Sessions the way Core does: scoped to the folder.
    await request.post(
      `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(cwd)}`,
    );
    await connectAndStartWorkspace(page, cwd);
    const masterId =
      await selectedSession(page).getAttribute("data-session-id");
    expect(masterId).toBeTruthy();

    // Stage one peer through the product's own `/peer` dialog.
    await sendPrompt(page, "/peer");
    const dialog = page.getByRole("dialog", {
      name: "Session peers",
      exact: true,
    });
    await dialog.getByLabel("Peer brief", { exact: true }).fill(PEER_BRIEF);
    await dialog
      .getByRole("spinbutton", { name: "Peers", exact: true })
      .fill("1");
    await dialog
      .getByRole("button", { name: "Start peers", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Close peers", exact: true })
      .click();
    await expect.poll(() => new Set(staged).size).toBe(1);
    const slug = staged[0]!;
    await expect(dockRow(page, slug)).toBeVisible();

    // Its turn runs, then lands: while it runs it counts, once done it does not.
    await sendPrompt(page, `Peer turn fixture ${slug}`);
    await expect(dockActivity(page, slug)).toHaveAttribute(
      "data-activity",
      "live",
    );
    await expect(strip(page)).toHaveAttribute(
      "aria-label",
      /Peers running \(1\)/,
    );
    await sendPrompt(page, `Peer complete fixture ${slug}`);
    await expect(dockActivity(page, slug)).toHaveAttribute(
      "data-activity",
      "done",
    );
    // Once the root turn that carried the fixture trigger settles, nothing is
    // running: the strip must reach Ready, not stay on "Peers running (1)".
    await expect(strip(page)).toHaveAttribute("aria-label", /· Ready$/);

    await page.reload();
    await expect(composer(page)).toBeEnabled();

    // The peer is back in the dock under its master, still done, and not in
    // the ordinary Session list.
    await expect(dockActivity(page, slug)).toHaveAttribute(
      "data-activity",
      "done",
      { timeout: 15_000 },
    );
    await expect(sessionRow(page, `#peer-${slug}`)).toHaveCount(0);
    await expect(strip(page)).toHaveAttribute("aria-label", /· Ready$/);

    // Opening it gives the read-only peer view and the way back.
    await dockRow(page, slug).click();
    await expect(
      page.getByText(
        `Peer ${slug} is read-only. Return to the master to make changes.`,
      ),
    ).toBeVisible();
    // The read-only view replaces the editable composer entirely.
    await expect(page.locator(".composer textarea")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Return to master", exact: true })
      .click();
    await expect(selectedSession(page)).toHaveAttribute(
      "data-session-id",
      masterId!,
    );
    await expect(composer(page)).toBeEnabled();
  } finally {
    await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  }
});
