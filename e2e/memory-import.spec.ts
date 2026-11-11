import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN } from "./fixture-session.ts";
import { openMemory, startMemorySession } from "./memory-settings.ts";

/**
 * T-0425: a memory file is previewed in full and written through the
 * existing `memory/ingest` only after confirmation, in batches, with the
 * server's own counts. Every ingest the page sends is counted here.
 */
const TOKEN = "memory-e2e-token";

type Frame = { method?: string; params?: { records?: { id: string }[] } };

async function start(page: Page) {
  const ingests: Frame[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      const sent = JSON.parse(String(frame.payload)) as Frame;
      if (sent.method === "memory/ingest") ingests.push(sent);
    }),
  );
  await startMemorySession(page, TOKEN, "memory-import");
  return { settings: await openMemory(page), ingests };
}

const record = (mark: string, n: number, overrides = {}) => ({
  id: `doc:octoscode-web:${mark}-${n}`,
  kind: "document",
  source: "octoscode-web",
  timestamp: "2026-11-05T21:00:00Z",
  title: `${mark} record ${n}`,
  abstract: `${mark} summary ${n}`,
  body: `${mark} body ${n}`,
  ...overrides,
});

async function choose(settings: Locator, name: string, content: string) {
  await settings.getByLabel("Choose a JSON or Markdown file").setInputFiles({
    name,
    mimeType: name.endsWith(".json") ? "application/json" : "text/markdown",
    buffer: Buffer.from(content, "utf8"),
  });
}

const preview = (settings: Locator) =>
  settings.getByRole("region", { name: "Import preview" });

async function search(settings: Locator, query: string) {
  await settings.getByLabel("Search memories").fill(query);
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await expect(settings.getByText(`Results for “${query}”`)).toBeVisible();
}

test("previews a file in full, writes nothing until confirmed, then reports the server's counts", async ({
  page,
}) => {
  const mark = `imp${Date.now()}`;
  const { settings, ingests } = await start(page);
  const storedBefore = await page.evaluate(() => Object.keys(localStorage));
  await choose(
    settings,
    "notes.json",
    JSON.stringify([
      record(mark, 1, {
        body: `${mark} <img src=x onerror="window.__ran=true"> 京都 ✈️`,
        score: 3,
        visits: 9,
        trust: "trusted",
      }),
      record(mark, 2, { source: "mail", id: `doc:mail:${mark}-2` }),
    ]),
  );
  const panel = preview(settings);
  await expect(panel).toContainText("notes.json");
  await expect(panel).toContainText("JSON record list");
  await expect(panel).toContainText("2 records will be written to Profile");
  await expect(panel).toContainText("Sources: octoscode-web (1), mail (1).");
  await expect(panel).toContainText("Not sent: score, trust, visits.");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByRole("listitem").first()).toContainText(
    `doc:octoscode-web:${mark}-1`,
  );
  expect(ingests).toHaveLength(0);

  // Cancelling writes nothing either.
  await panel.getByRole("button", { name: "Cancel import" }).click();
  await expect(panel).toHaveCount(0);
  expect(ingests).toHaveLength(0);

  await choose(
    settings,
    "notes.json",
    JSON.stringify([
      record(mark, 1, {
        body: `${mark} <img src=x onerror="window.__ran=true"> 京都 ✈️`,
      }),
      record(mark, 2, { source: "mail", id: `doc:mail:${mark}-2` }),
    ]),
  );
  // Two clicks, one import.
  await preview(settings)
    .getByRole("button", { name: "Import 2 records" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported" }),
  ).toHaveText("Imported 2 records: 2 new · 0 updated · 0 unchanged.");
  expect(ingests).toHaveLength(1);
  const sentRecords = ingests[0]!.params!.records as Record<string, unknown>[];
  expect(sentRecords.map(({ fingerprint, ...rest }) => rest)).toEqual([
    record(mark, 1, {
      body: `${mark} <img src=x onerror="window.__ran=true"> 京都 ✈️`,
    }),
    record(mark, 2, { source: "mail", id: `doc:mail:${mark}-2` }),
  ]);
  for (const sent of sentRecords)
    expect(sent.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  await expect(preview(settings)).toHaveCount(0);

  await search(settings, mark);
  await settings
    .getByRole("button", { name: new RegExp(`${mark} record 1`) })
    .click();
  await expect(settings.getByText("京都 ✈️", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => "__ran" in window)).toBe(false);
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain(mark);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(
    storedBefore,
  );
});

/**
 * Passes every frame through, except that the reply to the `drop`-th
 * `memory/ingest` never arrives: the socket closes after Core committed it.
 */
async function dropIngestReply(page: Page, drop: number) {
  const sent: Frame[] = [];
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

test("a reply lost after the server wrote the batch is not sure, is read back, and is never resent on its own", async ({
  page,
}) => {
  const mark = `lost${Date.now()}`;
  const sent = await dropIngestReply(page, 2);
  const { settings } = await start(page);
  await search(settings, mark);
  await expect(settings.getByText("No matching memories.")).toBeVisible();
  await choose(
    settings,
    "lost.json",
    JSON.stringify(Array.from({ length: 250 }, (_, i) => record(mark, i))),
  );
  await preview(settings)
    .getByRole("button", { name: "Import 250 records" })
    .click();
  const alert = settings.getByRole("alert").filter({ hasText: "batch 2" });
  await expect(alert).toContainText(
    "Not sure whether batch 2 (records 101–200) was written",
  );
  await expect(alert).toContainText(
    "The server may have written it before the reply was lost, so the page doesn't send it again on its own.",
  );
  // The connection was gone for the one automatic read-back.
  await expect(alert).toContainText("couldn't be read. Still not sure.");
  expect(sent).toHaveLength(2);

  // Back on a connection, a read by hand finds what the server holds. The
  // Session stays on screen while it reconnects, so wait for that to end.
  await expect(page.getByText("Reconnecting to Octos")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(
    alert.getByRole("button", { name: "Read batch 2 back again" }),
  ).toBeEnabled({ timeout: 15_000 });
  await alert.getByRole("button", { name: "Read batch 2 back again" }).click();
  const status = settings
    .getByRole("status")
    .filter({ hasText: "Batch 2 (records 101–200)" });
  await expect(status).toContainText(
    "Reading it back found all its records on the server as sent.",
  );
  expect(sent).toHaveLength(2);
  await status
    .getByRole("button", { name: "Send the remaining 50 records" })
    .click();
  const done = settings.getByRole("status").filter({ hasText: "Imported" });
  await expect(done).toContainText(
    "Imported 150 records: 150 new · 0 updated · 0 unchanged.",
  );
  await expect(done).toContainText(
    "100 records are on the server as sent: their reply was lost",
  );
  // Batch 2 went once; the rest went after it, by hand.
  expect(sent).toHaveLength(3);
  expect(sent.map((frame) => frame.params!.records![0]!.id)).toEqual([
    `doc:octoscode-web:${mark}-0`,
    `doc:octoscode-web:${mark}-100`,
    `doc:octoscode-web:${mark}-200`,
  ]);
});
