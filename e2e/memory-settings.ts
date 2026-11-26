import { expect, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session.ts";

/** Connects with one of the fixture's memory tokens and starts a Session. */
export const startMemorySession = (page: Page, token: string, name: string) =>
  startSession(page, `/workspace/${name}-${Date.now()}`, token);

/** Opens Settings › Memory; by default waits for the overview to load. */
export async function openMemory(page: Page, expectOverview = true) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  if (expectOverview) {
    await expect(
      settings.locator("summary").getByText("Long-term memory"),
    ).toBeVisible();
  }
  return settings;
}

/** Triggers a mock-server memory test control endpoint. */
export const memoryControl = (page: Page, path: string) =>
  page.request.post(`${FIXTURE_ORIGIN}/__test__/memory/${path}`);

/** Sets or removes one long-term entry on the mock fixture. */
export const setMemoryEntry = (page: Page, id: string, text?: string) =>
  memoryControl(
    page,
    text === undefined
      ? `entries/set?id=${encodeURIComponent(id)}`
      : `entries/set?id=${encodeURIComponent(id)}&text=${encodeURIComponent(text)}`,
  );

/** Configures the next `memory/request` response on the mock fixture. */
export const setNextMemoryRequestResult = (
  page: Page,
  status: string,
  reason?: string,
) => {
  const params = new URLSearchParams({ status });
  if (reason !== undefined) params.set("reason", reason);
  return memoryControl(page, `request/next-result?${params.toString()}`);
};

/** Verifies none of `forbidden` appear in the URL or browser storage. */
export async function expectNoStoredMemory(page: Page, forbidden: string[]) {
  const kept = await page.evaluate(
    () =>
      location.href + JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  for (const value of forbidden) expect(kept).not.toContain(value);
}

/** Runs a search in Settings › Memory; optionally waits for the labeled results. */
export async function searchMemory(
  settings: Locator,
  query: string,
  expectResults = true,
) {
  await settings.getByLabel("Search memories").fill(query);
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  if (expectResults) {
    await expect(settings.getByText(`Results for “${query}”`)).toBeVisible();
  }
}

/** Fills the three "Remember this" fields in Add to memory. */
export async function fillRememberForm(
  settings: Locator,
  fields: { title: string; summary: string; body: string },
) {
  await settings.getByLabel("Title").fill(fields.title);
  await settings.getByLabel("Summary").fill(fields.summary);
  await settings.getByLabel("Memory content").fill(fields.body);
}

/** Fires two synchronous DOM clicks in the same turn to verify single-flight guards. */
export async function doubleClick(button: Locator) {
  await button.evaluate((node: HTMLElement) => {
    node.click();
    node.click();
  });
}

/** Selects a synthetic JSON or Markdown memory file in the import picker. */
export async function chooseMemoryFile(
  settings: Locator,
  name: string,
  content: string,
) {
  await settings.getByLabel("Choose a JSON or Markdown file").setInputFiles({
    name,
    mimeType: name.endsWith(".json") ? "application/json" : "text/markdown",
    buffer: Buffer.from(content, "utf8"),
  });
}

export type MemoryIngestFrame = {
  method?: string;
  params?: { records?: { id: string }[] };
};

/**
 * Passes every frame through, except that the reply to the `drop`-th
 * `memory/ingest` never arrives: the socket closes after Core committed it.
 */
export async function dropIngestReply(page: Page, drop: number) {
  const sent: MemoryIngestFrame[] = [];
  const held = new Set<string>();
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame.method === "memory/ingest") {
          sent.push(frame);
          if (sent.length === drop) held.add(frame.id);
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame.id !== undefined && held.delete(frame.id)) {
          void route.close();
          return;
        }
        route.send(message);
      });
    },
  );
  return sent;
}
