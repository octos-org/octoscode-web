import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chooseMemoryFile,
  doubleClick,
  dropIngestReply,
  openMemory,
  searchMemory,
  startMemorySession,
} from "./memory-settings.ts";
import { observeSent } from "./turn-observers";

/**
 * T-0425: a memory file is previewed in full and written through the
 * existing `memory/ingest` only after confirmation, in batches, with the
 * server's own counts. Every ingest the page sends is counted here.
 */
const TOKEN = "memory-e2e-token";

async function start(page: Page) {
  const ingests = observeSent(page, "memory/ingest");
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

const preview = (settings: Locator) =>
  settings.getByRole("region", { name: "Import preview" });

test("previews a file in full, writes nothing until confirmed, then reports the server's counts", async ({
  page,
}) => {
  const mark = `imp${Date.now()}`;
  const { settings, ingests } = await start(page);
  const storedBefore = await page.evaluate(() => Object.keys(localStorage));
  const file = (extra = {}) =>
    JSON.stringify([
      record(mark, 1, {
        body: `${mark} <img src=x onerror="window.__ran=true"> 京都 ✈️`,
        ...extra,
      }),
      record(mark, 2, { source: "mail", id: `doc:mail:${mark}-2` }),
    ]);
  const fields = { score: 3, visits: 9, trust: "trusted" };
  await chooseMemoryFile(settings, "notes.json", file(fields));
  const panel = preview(settings);
  await expect(panel).toContainText("notes.json");
  await expect(panel).toContainText("JSON record list");
  await expect(panel).toContainText(
    "2 records will be written to this server's default memory.",
  );
  await expect(panel).toContainText("Sources: octoscode-web (1), mail (1).");
  await expect(panel).toContainText("Not sent: score, trust, visits.");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByRole("listitem").first()).toContainText(
    `doc:octoscode-web:${mark}-1`,
  );
  expect(ingests()).toHaveLength(0);

  // Cancelling writes nothing either.
  await panel.getByRole("button", { name: "Cancel import" }).click();
  await expect(panel).toHaveCount(0);
  expect(ingests()).toHaveLength(0);

  await chooseMemoryFile(settings, "notes.json", file());
  // Two clicks, one import.
  await doubleClick(
    preview(settings).getByRole("button", { name: "Import 2 records" }),
  );
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported" }),
  ).toHaveText("Imported 2 records: 2 new · 0 updated · 0 unchanged.");
  expect(ingests()).toHaveLength(1);
  const sentRecords = ingests()[0]!.records as Record<string, unknown>[];
  expect(sentRecords.map(({ fingerprint, ...rest }) => rest)).toEqual([
    record(mark, 1, {
      body: `${mark} <img src=x onerror="window.__ran=true"> 京都 ✈️`,
    }),
    record(mark, 2, { source: "mail", id: `doc:mail:${mark}-2` }),
  ]);
  for (const sent of sentRecords)
    expect(sent.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  await expect(preview(settings)).toHaveCount(0);

  await searchMemory(settings, mark);
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

test("a reply lost after the server wrote the batch is not sure, is read back, and is never resent on its own", async ({
  page,
}) => {
  const mark = `lost${Date.now()}`;
  const sent = await dropIngestReply(page, 2);
  const { settings } = await start(page);
  await searchMemory(settings, mark);
  await expect(settings.getByText("No matching memories.")).toBeVisible();
  await chooseMemoryFile(
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

test("preview selection excludes unchecked records, discloses overwrite boundaries without preflight loads, and preserves preview on bad re-pick", async ({
  page,
}) => {
  const mark = `sel${Date.now()}`;
  const loads = observeSent(page, "memory/load");
  const { settings, ingests } = await start(page);
  const existing = record(mark, 1, { title: `${mark} existing` });
  await chooseMemoryFile(settings, "seed.json", JSON.stringify([existing]));
  await preview(settings)
    .getByRole("button", { name: "Import 1 records" })
    .click();
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported 1 records" }),
  ).toBeVisible();
  await searchMemory(settings, mark);
  await expect(
    settings.getByRole("button", { name: new RegExp(`${mark} existing`) }),
  ).toBeVisible();
  const loadsBeforePreview = loads().length;
  const ingestsBefore = ingests().length;

  const fresh = record(mark, 2, { title: `${mark} fresh` });
  const skipped = record(mark, 3, { title: `${mark} skipped` });
  await chooseMemoryFile(
    settings,
    "mixed.json",
    JSON.stringify([
      { ...existing, body: `${mark} updated body` },
      fresh,
      skipped,
    ]),
  );
  const panel = preview(settings);
  await expect(panel).toContainText("Will overwrite existing records:");
  await expect(panel).toContainText(existing.id);
  await expect(panel).toContainText(
    "2 selected records were not loaded on this page. The server doesn't support a side-effect-free preflight check, so any of them whose id already exists on the server will also be overwritten.",
  );
  await expect(panel.getByRole("listitem").first()).toContainText(
    "Will overwrite",
  );
  await expect(panel.getByRole("listitem").nth(1)).toContainText(
    "Not checked on server",
  );

  // Empty selection disables Import; Select all restores it.
  await panel.getByRole("button", { name: "Clear selection" }).click();
  await expect(panel).toContainText("Selected 0 of 3 records");
  await expect(
    panel.getByRole("button", { name: "Import 0 records" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Select all" }).click();
  await expect(
    panel.getByRole("button", { name: "Import 3 records" }),
  ).toBeEnabled();

  // Exclude the known-overwrite record and the third record.
  await panel
    .getByRole("checkbox", { name: new RegExp(`${mark} existing`) })
    .uncheck();
  await panel
    .getByRole("checkbox", { name: new RegExp(`${mark} skipped`) })
    .uncheck();
  await expect(panel).toContainText("Selected 1 of 3 records");
  await expect(panel).not.toContainText("Will overwrite existing records:");

  // A parse error on another file must not wipe the current preview/selection.
  await chooseMemoryFile(settings, "broken.json", "{not-json");
  await expect(
    settings
      .getByRole("alert")
      .filter({ hasText: "broken.json can't be imported:" }),
  ).toBeVisible();
  await expect(panel).toContainText("mixed.json");
  await expect(panel).toContainText("Selected 1 of 3 records");
  expect(loads()).toHaveLength(loadsBeforePreview);

  await panel.getByRole("button", { name: "Import 1 records" }).click();
  await expect(
    settings.getByRole("status").filter({ hasText: "Imported 1 records" }),
  ).toHaveText("Imported 1 records: 1 new · 0 updated · 0 unchanged.");
  expect(ingests()).toHaveLength(ingestsBefore + 1);
  const sent = ingests()[ingestsBefore]!.records as Record<string, unknown>[];
  expect(sent.map((entry) => entry.id)).toEqual([fresh.id]);
  expect(sent[0]!.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(loads()).toHaveLength(loadsBeforePreview);
});
