import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * T-0424: the memory page exports what it has loaded, the current search's
 * results or the open detail, as JSON or Markdown made in the browser. The
 * export says what it covers and never claims to be a full backup.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "memory-e2e-token";

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/memory-export-${Date.now()}`);
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
  return settings;
}

async function remember(
  settings: Locator,
  title: string,
  summary: string,
  body: string,
) {
  await settings.getByLabel("Title").fill(title);
  await settings.getByLabel("Summary").fill(summary);
  await settings.getByLabel("Memory content").fill(body);
  await settings
    .getByRole("button", { name: "Remember this", exact: true })
    .click();
  await expect(settings.getByText("1 inserted")).toBeVisible();
}

async function search(settings: Locator, query: string) {
  await settings.getByLabel("Search memories").fill(query);
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await expect(settings.getByText(`Results for “${query}”`)).toBeVisible();
}

async function download(page: Page, group: Locator, format: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    group.getByRole("button", { name: format, exact: true }).click(),
  ]);
  const bytes = await readFile((await file.path())!);
  return {
    name: file.suggestedFilename(),
    bytes,
    text: bytes.toString("utf8"),
  };
}

const resultsExport = (settings: Locator) =>
  settings.getByRole("group", { name: /^Export these \d+ results$/ });
const detailExport = (settings: Locator) =>
  settings.getByRole("group", { name: "Export this detail" });

test("exports a search's results and an open record, as the server sent them", async ({
  page,
}) => {
  const mark = `exp${Date.now()}`;
  const body = `${mark} 旅行笔记 ✈️ <script>window.__ran = true</script>\n\`\`\`js\nboom()\n\`\`\``;
  const settings = await start(page);
  const storedBefore = await page.evaluate(() => Object.keys(localStorage));
  await remember(settings, `${mark} 京都 <b>行程</b>`, `${mark} 概要`, body);
  await search(settings, mark);

  const group = resultsExport(settings);
  await expect(group).toHaveAccessibleName("Export these 1 results");
  await expect(settings).toContainText(
    "Search results carry titles and summaries only. Not a backup of all memories.",
  );
  const json = await download(page, group, "JSON");
  expect(json.name).toMatch(
    new RegExp(`^octos-memory-search-${mark}-\\d{8}T\\d{6}\\.json$`),
  );
  const exported = JSON.parse(json.text);
  expect(exported.complete_backup).toBe(false);
  expect(exported.scope).toEqual({
    what: "search_results",
    profile_id: expect.any(String),
    query: mark,
    count: 1,
    requested_limit: 20,
    may_have_more: false,
  });
  expect(exported.records).toHaveLength(1);
  expect(exported.records[0]).toMatchObject({
    kind: "document",
    source: "octoscode-web",
    title: `${mark} 京都 <b>行程</b>`,
    abstract: `${mark} 概要`,
  });
  expect(Object.keys(exported.records[0]).sort()).toEqual(
    expect.arrayContaining(["id", "kind", "source", "title", "abstract"]),
  );
  expect(json.text).not.toContain(TOKEN);
  // Unicode comes out as UTF-8, not escapes.
  expect(json.bytes.includes(Buffer.from("京都", "utf8"))).toBe(true);

  const markdown = await download(page, group, "Markdown");
  expect(markdown.name).toMatch(/\.md$/);
  expect(markdown.text).toContain(`# Memory export: search “${mark}”`);
  expect(markdown.text).toContain(`## 1. ${mark} 京都 &lt;b&gt;行程&lt;/b&gt;`);
  expect(markdown.text).toContain("This is not a backup of all memories.");

  // The open record carries its content, fenced so nothing in it runs.
  await settings
    .getByRole("button", { name: new RegExp(`${mark} 京都`) })
    .click();
  await expect(
    settings.getByText("旅行笔记 ✈️", { exact: false }),
  ).toBeVisible();
  const detail = await download(page, detailExport(settings), "Markdown");
  expect(detail.text).toContain("````text\n" + body + "\n````");
  const detailJson = JSON.parse(
    (await download(page, detailExport(settings), "JSON")).text,
  );
  expect(detailJson.scope.what).toBe("memory_record");
  expect(detailJson.record.body).toBe(body);
  expect(detailJson.page_truncated).toBe(false);
  expect(await page.evaluate(() => "__ran" in window)).toBe(false);

  // Nothing new was kept by the browser.
  const storedAfter = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(storedAfter).not.toContain(mark);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(
    storedBefore,
  );
});

test("each export covers the search it shows: a new query, an empty one, a failed one", async ({
  page,
}) => {
  const a = `qa${Date.now()}`;
  const b = `qb${Date.now()}`;
  const settings = await start(page);
  await remember(settings, `${a} first`, "one", "first body");
  await remember(settings, `${b} second`, "two", "second body");

  await search(settings, a);
  const first = JSON.parse(
    (await download(page, resultsExport(settings), "JSON")).text,
  );
  expect(first.scope.query).toBe(a);
  expect(first.records.map((r: { title: string }) => r.title)).toEqual([
    `${a} first`,
  ]);

  await search(settings, b);
  const second = JSON.parse(
    (await download(page, resultsExport(settings), "JSON")).text,
  );
  expect(second.scope.query).toBe(b);
  expect(second.records.map((r: { title: string }) => r.title)).toEqual([
    `${b} second`,
  ]);

  // Typing a new query changes nothing until it is searched.
  await settings.getByLabel("Search memories").fill("not searched yet");
  expect(
    JSON.parse((await download(page, resultsExport(settings), "JSON")).text)
      .scope.query,
  ).toBe(b);

  // A failed search leaves the last results, and the export still says which.
  await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/memory/fail-next?method=memory/search`,
  );
  await settings.getByLabel("Search memories").fill(a);
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "memory backend unavailable",
  );
  await expect(settings.getByText(`Results for “${b}”`)).toBeVisible();
  expect(
    JSON.parse((await download(page, resultsExport(settings), "JSON")).text)
      .scope.query,
  ).toBe(b);

  // Nothing found, nothing offered.
  await search(settings, `none${Date.now()}`);
  await expect(settings.getByText("No matching memories.")).toBeVisible();
  await expect(resultsExport(settings)).toHaveCount(0);
});

test("exports an open entity with its size, and a failed download can be retried", async ({
  page,
}) => {
  const settings = await start(page);
  await settings.getByRole("button", { name: /t0008/ }).first().click();
  await expect(settings.getByText("Protocol entity detail.")).toBeVisible();

  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    let failures = 1;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (failures-- > 0) throw new Error("blob URLs are blocked");
      return original(blob);
    };
  });
  await detailExport(settings)
    .getByRole("button", { name: "JSON", exact: true })
    .click();
  await expect(
    detailExport(settings).locator("..").getByRole("alert"),
  ).toContainText(
    "Couldn't make the download: blob URLs are blocked. Try again.",
  );
  const entity = JSON.parse(
    (await download(page, detailExport(settings), "JSON")).text,
  );
  expect(entity.scope.what).toBe("memory_entity");
  expect(entity.entity).toEqual({
    name: "t0008",
    content: "# T0008\n\nProtocol entity detail.",
    content_truncated: false,
    content_total_bytes: 32,
  });
  await expect(settings.getByText("Couldn't make the download")).toHaveCount(0);
});
