import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * T-0425: a memory file is previewed in full and written through the
 * existing `memory/ingest` only after confirmation, in batches, with the
 * server's own counts. Every ingest the page sends is counted here.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
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
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/memory-import-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    settings.locator("summary").getByText("Long-term memory"),
  ).toBeVisible();
  return { settings, ingests };
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

test("shows repeats inside the file and ids the page knows, and the server's update counts", async ({
  page,
}) => {
  const mark = `dup${Date.now()}`;
  const { settings, ingests } = await start(page);
  await choose(settings, "first.json", JSON.stringify([record(mark, 1)]));
  await preview(settings)
    .getByRole("button", { name: "Import 1 records" })
    .click();
  await expect(settings.getByText("Imported 1 records")).toBeVisible();
  await search(settings, mark);

  await choose(
    settings,
    "second.json",
    JSON.stringify({
      records: [
        record(mark, 1, { body: `${mark} body 1, edited` }),
        record(mark, 2),
        record(mark, 2, { title: "a later copy" }),
      ],
    }),
  );
  const panel = preview(settings);
  await expect(panel).toContainText(
    `1 later records repeat an id already in this file and are skipped: doc:octoscode-web:${mark}-2.`,
  );
  await expect(panel).toContainText(
    `1 of these ids were loaded on this page, so they are on the server and will be replaced: doc:octoscode-web:${mark}-1.`,
  );
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel).not.toContainText("a later copy");
  await panel.getByRole("button", { name: "Import 2 records" }).click();
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported" }),
  ).toHaveText("Imported 2 records: 1 new · 1 updated · 0 unchanged.");
  expect(ingests.at(-1)!.params!.records!.map((r) => r.id)).toEqual([
    `doc:octoscode-web:${mark}-1`,
    `doc:octoscode-web:${mark}-2`,
  ]);
});

test("refuses wrong, broken and mixed files before writing anything", async ({
  page,
}) => {
  const mark = `bad${Date.now()}`;
  const { settings, ingests } = await start(page);
  const alert = settings.getByRole("alert");

  await settings.getByLabel("Choose a JSON or Markdown file").setInputFiles({
    name: "run.sh",
    mimeType: "application/x-sh",
    buffer: Buffer.from("rm -rf /"),
  });
  await expect(alert).toContainText("Only .json and .md files");
  await choose(settings, "broken.json", "{ not json");
  await expect(alert).toContainText("The file isn't valid JSON.");
  await choose(
    settings,
    "mixed.json",
    JSON.stringify([
      record(mark, 1),
      record(mark, 2, { id: "doc:elsewhere:2" }),
      record(mark, 3, { body: undefined }),
      { ...record(mark, 4), kind: "knowledge" },
    ]),
  );
  await expect(alert).toContainText("mixed.json can't be imported:");
  await expect(alert).toContainText(
    "Record 2: id “doc:elsewhere:2” must start with doc:octoscode-web:.",
  );
  await expect(alert).toContainText("Record 3 has no body.");
  await expect(alert).toContainText(
    "Record 4: kind “knowledge” can't be imported",
  );
  await expect(alert).toContainText("Nothing was written.");
  await choose(
    settings,
    "search.json",
    JSON.stringify({
      format: "octoscode-web.memory-export/1",
      scope: { what: "search_results" },
      records: [record(mark, 1)],
    }),
  );
  await expect(alert).toContainText("This is a search export");
  await expect(preview(settings)).toHaveCount(0);
  expect(ingests).toHaveLength(0);
});

test("a batch that fails stops the import and says how far it got", async ({
  page,
}) => {
  const mark = `part${Date.now()}`;
  let ingestCalls = 0;
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame.method === "memory/ingest" && ++ingestCalls === 2) {
          route.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: {
                code: -32602,
                message: "records[3]: rejected by server",
              },
            }),
          );
          return;
        }
        server.send(message);
      });
    },
  );
  const { settings, ingests } = await start(page);
  await choose(
    settings,
    "many.json",
    JSON.stringify(Array.from({ length: 250 }, (_, i) => record(mark, i))),
  );
  await preview(settings)
    .getByRole("button", { name: "Import 250 records" })
    .click();
  const alert = settings.getByRole("alert");
  await expect(alert).toContainText(
    "Stopped after 100 of 250 records. Written so far: 100 new · 0 updated · 0 unchanged.",
  );
  // Invalid params are answered before Core writes anything.
  await expect(alert).toContainText(
    "The server refused batch 2 (records 101–200): records[3]: rejected by server. It wrote nothing for that batch.",
  );
  await expect(alert).toContainText("The 50 records after it were not sent.");
  await expect(settings.getByText(/^Imported/)).toHaveCount(0);
  // Sending the same refused batch again would only be refused again.
  await expect(alert.getByRole("button")).toHaveCount(0);
  // The routed socket answers the second batch itself; there is no third.
  expect(ingestCalls).toBe(2);
  expect(ingests[0]!.params!.records).toHaveLength(100);
});

test("a Markdown record export goes back in unchanged", async ({ page }) => {
  const mark = `md${Date.now()}`;
  const { settings } = await start(page);
  await choose(settings, "one.json", JSON.stringify([record(mark, 1)]));
  await preview(settings)
    .getByRole("button", { name: "Import 1 records" })
    .click();
  await search(settings, mark);
  await settings
    .getByRole("button", { name: new RegExp(`${mark} record 1`) })
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    settings
      .getByRole("group", { name: "Export this detail" })
      .getByRole("button", { name: "Markdown", exact: true })
      .click(),
  ]);
  const markdown = await readFile((await download.path())!, "utf8");
  await choose(settings, download.suggestedFilename(), markdown);
  await expect(preview(settings)).toContainText("Markdown export");
  await preview(settings)
    .getByRole("button", { name: "Import 1 records" })
    .click();
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported" }),
  ).toHaveText("Imported 1 records: 0 new · 0 updated · 1 unchanged.");
});

test("without ingest the import is off and says why", async ({ page }) => {
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      const strip = (value: unknown): unknown => {
        if (Array.isArray(value))
          return value.filter((entry) => entry !== "memory/ingest").map(strip);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, strip(entry)]),
        );
      };
      server.onMessage((message) =>
        route.send(JSON.stringify(strip(JSON.parse(String(message))))),
      );
    },
  );
  const { settings } = await start(page);
  await expect(
    settings.getByLabel("Choose a JSON or Markdown file"),
  ).toBeDisabled();
  await expect(settings).toContainText(
    "This server doesn't take memory writes, so files can't be imported.",
  );
});

/** Passes every frame through, except what `fault` takes over. */
async function faultProxy(
  page: Page,
  fault: (
    frame: { id?: string; method?: string },
    call: number,
  ) =>
    | { reply: unknown }
    | { dropReplyAndClose: true }
    | { replaceResult: unknown }
    | null,
) {
  const sent: Frame[] = [];
  const held = new Map<string, "close" | { result: unknown }>();
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame.method === "memory/ingest") sent.push(frame);
        const plan =
          frame.method === "memory/ingest" ? fault(frame, sent.length) : null;
        if (plan && "reply" in plan) {
          route.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              ...(plan.reply as object),
            }),
          );
          return;
        }
        if (plan && "dropReplyAndClose" in plan) held.set(frame.id, "close");
        if (plan && "replaceResult" in plan)
          held.set(frame.id, { result: plan.replaceResult });
        server.send(message);
      });
      server.onMessage((message) => {
        const frame = JSON.parse(String(message));
        const plan = frame.id !== undefined ? held.get(frame.id) : undefined;
        if (plan === "close") {
          // Core has committed; the reply never arrives.
          held.delete(frame.id);
          void route.close();
          return;
        }
        if (plan) {
          held.delete(frame.id);
          route.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              result: plan.result,
            }),
          );
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
  const sent = await faultProxy(page, (_frame, call) =>
    call === 2 ? { dropReplyAndClose: true } : null,
  );
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

  // Back on a connection, a read by hand finds what the server holds.
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

test("a reply the page can't read is not sure; a read-back that finds the batch settles it", async ({
  page,
}) => {
  const mark = `odd${Date.now()}`;
  await faultProxy(page, () => ({ replaceResult: { inserted: "many" } }));
  const { settings } = await start(page);
  await search(settings, mark);
  await expect(settings.getByText("No matching memories.")).toBeVisible();
  await choose(
    settings,
    "odd.json",
    JSON.stringify(Array.from({ length: 3 }, (_, i) => record(mark, i))),
  );
  await preview(settings)
    .getByRole("button", { name: "Import 3 records" })
    .click();
  const status = settings
    .getByRole("status")
    .filter({ hasText: "records are on the server" });
  await expect(status).toContainText(
    "3 records are on the server as sent: their reply was lost, and reading them back found them. The server's counts for them are unknown.",
  );
  await expect(status.getByRole("button")).toHaveCount(0);
  // The search on screen is read again: the imported records are listed.
  await expect(
    settings.getByRole("button", { name: new RegExp(`^${mark} record 0`) }),
  ).toBeVisible();
  await expect(settings.getByText("No matching memories.")).toHaveCount(0);
});

test("an internal error is not sure; a read-back that finds nothing offers to send the batch again", async ({
  page,
}) => {
  const mark = `fail${Date.now()}`;
  const sent = await faultProxy(page, (_frame, call) =>
    call === 2
      ? { reply: { error: { code: -32603, message: "recall upsert failed" } } }
      : null,
  );
  const { settings } = await start(page);
  await choose(
    settings,
    "fail.json",
    JSON.stringify(Array.from({ length: 150 }, (_, i) => record(mark, i))),
  );
  await preview(settings)
    .getByRole("button", { name: "Import 150 records" })
    .click();
  const alert = settings.getByRole("alert").filter({ hasText: "batch 2" });
  await expect(alert).toContainText(
    "Batch 2 (records 101–150) was not written: recall upsert failed.",
  );
  await expect(alert).toContainText(
    "Read back: none of its 50 records are on the server as sent, so it was not written.",
  );
  await expect(
    alert.getByRole("button", { name: "Read batch 2 back again" }),
  ).toHaveCount(0);
  expect(sent).toHaveLength(2);
  await alert
    .getByRole("button", { name: "Send from batch 2 again (50 records)" })
    .click();
  const status = settings.getByRole("status").filter({ hasText: "Imported" });
  await expect(status).toContainText(
    "Imported 150 records: 150 new · 0 updated · 0 unchanged.",
  );
  expect(sent).toHaveLength(3);
  // The retry sent the very records and fingerprints of the first try.
  expect(sent[2]!.params!.records).toEqual(sent[1]!.params!.records);
  await search(settings, mark);
  await expect(
    settings.getByRole("button", { name: new RegExp(`^${mark} record 149`) }),
  ).toBeVisible();
});
