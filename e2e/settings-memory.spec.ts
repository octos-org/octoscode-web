import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  doubleClick,
  expectNoStoredMemory,
  fillRememberForm,
  memoryControl,
  openMemory,
  searchMemory,
  setMemoryEntry,
  setNextMemoryRequestResult,
  startMemorySession,
} from "./memory-settings.ts";
import { observeFrames, observeSent } from "./turn-observers";

const start = (page: Page, token = "memory-e2e-token") =>
  startMemorySession(page, token, "settings-memory");

test("ingest → search → detail survives a page refresh, and failures stay honest", async ({
  page,
}) => {
  const ingestCalls = observeSent(page, "memory/ingest");
  const searchCalls = observeSent(page, "memory/search");
  await start(page);
  const settings = await openMemory(page);
  // This server sends no update time: it is unknown, not zero.
  await expect(
    settings.getByText("Long-term memory updated: unknown"),
  ).toBeVisible();
  const searchSection = settings.getByRole("region", { name: "Search" });
  const addSection = settings.getByRole("region", { name: "Add to memory" });
  const detail = settings.getByRole("complementary", { name: "Memory detail" });
  const rememberBtn = settings.getByRole("button", {
    name: "Remember this",
    exact: true,
  });

  // Default profile prose hides internal `_main` and discloses Core's 50-result search cap.
  await expect(settings).not.toContainText("_main");
  await expect(
    settings.getByText(/this server's default memory/),
  ).toBeVisible();
  await expect(
    searchSection.getByText(/up to 50 matching reference documents/),
  ).toBeVisible();

  // Results are labeled with the query that answered them, requesting limit 50.
  await searchMemory(settings, "protocol");
  expect(searchCalls()[0]).toMatchObject({ query: "protocol", limit: 50 });
  await expect(
    settings.getByRole("button", { name: /T0008 protocol probe/ }),
  ).toBeVisible();

  // A failed search keeps those labeled facts and shows its error in Search.
  await memoryControl(page, "fail-next?method=memory/search");
  await searchMemory(settings, "other", false);
  await expect(
    searchSection.getByRole("alert").getByText("memory backend unavailable"),
  ).toBeVisible();
  await expect(settings.getByText("Results for “protocol”")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /T0008 protocol probe/ }),
  ).toBeVisible();

  // Clear search restores empty search state with no stale results or error.
  const clearSearchBtn = searchSection.getByRole("button", {
    name: "Clear search",
  });
  await clearSearchBtn.click();
  await expect(searchSection.getByLabel("Search memories")).toHaveValue("");
  await expect(settings.getByText("Results for “protocol”")).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: /T0008 protocol probe/ }),
  ).toHaveCount(0);
  await expect(searchSection.getByRole("alert")).toHaveCount(0);
  await expect(clearSearchBtn).toBeDisabled();

  // Without request/promote, Add to memory states the limit honestly.
  await expect(
    addSection.getByText(/doesn't support requesting long-term memories/),
  ).toBeVisible();

  // Remember: one click chain submits exactly once, even double-clicked,
  // shows its receipt in place, and keeps Detail visible with read-only note.
  await fillRememberForm(settings, {
    title: "Refresh proof",
    summary: "survives a reload",
    body: "refresh-kept body",
  });
  await doubleClick(rememberBtn);
  await expect(
    addSection.getByText(/^Saved “Refresh proof” .* It's open in Detail;/),
  ).toBeVisible();
  await expect(detail.getByText("refresh-kept body")).toBeVisible();
  await expect(
    detail.getByText(
      "Reference documents and entities can't be edited or deleted here.",
    ),
  ).toBeVisible();
  await expect(detail).toBeInViewport();
  expect(ingestCalls()).toHaveLength(1);

  // A failed ingest says so inside Add to memory and keeps the form.
  await fillRememberForm(settings, {
    title: "Will fail",
    summary: "kept on failure",
    body: "failure body kept",
  });
  await memoryControl(page, "fail-next?method=memory/ingest");
  await rememberBtn.click();
  await expect(
    addSection.getByRole("alert").getByText("memory backend unavailable"),
  ).toBeVisible();
  await expect(settings.getByLabel("Title")).toHaveValue("Will fail");

  // Refresh the overview in place, then reload the page: the ingested record
  // is still searchable and opens.
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    settings.locator("summary").getByText("Long-term memory"),
  ).toBeVisible();
  await page.reload();
  const again = await openMemory(page);
  await searchMemory(again, "Refresh proof", false);
  await again.getByRole("button", { name: /Refresh proof/ }).click();
  await expect(again.getByText("refresh-kept body")).toBeVisible();
});

test("fails closed when authenticated memory ownership differs from the Session profile", async ({
  page,
}) => {
  const frames = observeFrames(page);
  await start(page, "memory-host-e2e-token");
  const settings = await openMemory(page, false);
  await expect(
    settings.getByText(/memory ownership is not confirmed/i),
  ).toBeVisible();
  await expect(settings.getByLabel("Memory content")).toHaveCount(0);
  expect(
    frames.sent.filter((frame) => frame.method?.startsWith("memory/")),
  ).toEqual([]);
});

test("long-term entries edit and delete on the server, and a failed change keeps the text", async ({
  page,
}) => {
  const edits = observeSent(page, "memory/edit");
  const promotes = observeSent(page, "memory/promote");
  await memoryControl(page, "entries/reset");
  await start(page, "memory-main-e2e-token");
  const settings = await openMemory(page);
  const entry = (text: string) =>
    settings.getByRole("listitem").filter({ hasText: text });
  const editor = settings.getByLabel("Edit memory");
  const saveBtn = settings.getByRole("button", { name: "Save", exact: true });
  await expect(settings.getByText(/not available in the current/)).toHaveCount(
    0,
  );

  // Requesting surfaces failed reason / generic fallback while keeping draft;
  // acceptance clears the draft; promote sends explicit Core params.
  const addSection = settings.getByRole("region", { name: "Add to memory" });
  const request = addSection.getByRole("button", { name: "Request memory" });
  const promote = addSection.getByRole("button", {
    name: "Promote to Knowledge",
  });
  const contentInput = addSection.getByLabel("Memory content");
  await expect(request).toHaveAccessibleDescription(/until Octos files it/);
  await expect(promote).toHaveAccessibleDescription(
    /one unpromoted document.*at least once/,
  );
  await contentInput.fill("prefers tea");
  await setNextMemoryRequestResult(
    page,
    "failed",
    "the memory model did not save it in 3 attempts",
  );
  await request.click();
  await expect(addSection.getByRole("alert")).toContainText(
    "the memory model did not save it in 3 attempts",
  );
  await expect(contentInput).toHaveValue("prefers tea");
  await setNextMemoryRequestResult(page, "failed");
  await request.click();
  const genericAlert = addSection.getByRole("alert");
  await expect(genericAlert).toContainText("couldn't save this memory request");
  await expect(genericAlert).not.toContainText("memory-main-e2e-token");
  await expect(contentInput).toHaveValue("prefers tea");
  await request.click();
  const requested = addSection.getByText(
    /^Octos will remember it\. .*Long-term/,
  );
  await expect(requested).toBeVisible();
  await expect(contentInput).toHaveValue("");
  await promote.click();
  await expect(addSection.getByText(/^Handed 1 document\(s\)/)).toBeVisible();
  await expect(requested).toHaveCount(0);
  expect(promotes()[0]).toMatchObject({
    sources: ["octoscode-web"],
    min_visits: 1,
    limit: 1,
  });

  // Opening Edit with no changes does not block Refresh; unsaved edits guard
  // both Refresh and Close settings and keep the draft when cancelled.
  const refreshBtn = settings.getByRole("button", {
    name: "Refresh",
    exact: true,
  });
  const closeSettingsBtn = settings.getByRole("button", {
    name: "Close settings",
  });
  const leaveGuard = settings.getByRole("alertdialog", {
    name: "Unsaved memory edit",
  });
  await entry("dark roast").getByRole("button", { name: "Edit" }).click();
  await expect(editor).toHaveValue(
    "- prefers dark roast coffee (updated: 2026-11-01)",
  );
  await refreshBtn.click();
  await expect(leaveGuard).toHaveCount(0);
  await editor.fill("- prefers unsaved oolong");
  await refreshBtn.click();
  await expect(leaveGuard).toBeVisible();
  await leaveGuard.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor).toHaveValue("- prefers unsaved oolong");
  await closeSettingsBtn.click();
  await expect(leaveGuard).toBeVisible();
  await leaveGuard.getByRole("button", { name: "Keep editing" }).click();
  await expect(settings).toBeVisible();
  await expect(editor).toHaveValue("- prefers unsaved oolong");
  await refreshBtn.click();
  await leaveGuard.getByRole("button", { name: "Discard & refresh" }).click();
  await expect(editor).toHaveCount(0);

  // An edit sends the text verbatim against the version on screen; the list
  // then shows what the server stored, its own stamp included.
  await entry("dark roast").getByRole("button", { name: "Edit" }).click();
  await expect(editor).toHaveValue(
    "- prefers dark roast coffee (updated: 2026-11-01)",
  );
  await editor.fill("- prefers green tea");
  await saveBtn.click();
  await expect(settings.getByText(/^Saved\./)).toBeVisible();
  await expect(entry("green tea").locator("p")).toHaveText(
    "- prefers green tea (updated: 2026-11-10)",
  );
  // After a successful save, Refresh does not prompt.
  await refreshBtn.click();
  await expect(leaveGuard).toHaveCount(0);
  await expect(refreshBtn).toBeEnabled();
  await expect(settings.getByText("Waiting for the server…")).toHaveCount(0);
  const edit = edits()[0]!;
  expect(edit).toMatchObject({
    entry_id: "^maaaaaa",
    version: createHash("sha256")
      .update("- prefers dark roast coffee (updated: 2026-11-01) ^maaaaaa")
      .digest("hex"),
    content: "- prefers green tea",
  });
  expect(edit.session_id).toEqual(expect.any(String));

  // Changed by another writer since it was loaded: refused, the server's
  // text is shown, the draft stays, and saving again applies it.
  await setMemoryEntry(
    page,
    "^mbbbbbb",
    "- works on the ledger (updated: 2026-11-09) ^mbbbbbb",
  );
  await entry("billing").getByRole("button", { name: "Edit" }).click();
  await editor.fill("- works on payments");
  await saveBtn.click();
  await expect(settings.getByRole("alert")).toContainText(
    "changed on the server",
  );
  await expect(editor).toHaveValue("- works on payments");
  await expect(entry("ledger")).toContainText(
    "On the server: - works on the ledger (updated: 2026-11-09)",
  );
  await expect(settings.getByText("billing")).toHaveCount(0);
  // An unconfirmed save keeps the draft too.
  await memoryControl(page, "fail-next?method=memory/edit");
  await saveBtn.click();
  await expect(settings.getByRole("alert")).toContainText("didn't confirm");
  await expect(editor).toHaveValue("- works on payments");
  await saveBtn.click();
  await expect(entry("payments")).toBeVisible();

  // Delete asks first; keeping it changes nothing.
  const delGreen = entry("green tea").getByRole("button", {
    name: "Delete",
    exact: true,
  });
  await delGreen.click();
  await settings.getByRole("button", { name: "Keep it" }).click();
  await delGreen.click();
  await settings.getByRole("button", { name: "Delete memory" }).click();
  await expect(settings.getByText(/^Deleted\./)).toBeVisible();
  await expect(entry("green tea")).toHaveCount(0);
  // Completed delete does not block closing Settings.
  await closeSettingsBtn.click();
  await expect(settings).toHaveCount(0);
  await openMemory(page);

  // Gone from the server before the save: the text is offered back.
  await setMemoryEntry(page, "^mbbbbbb");
  await entry("payments").getByRole("button", { name: "Edit" }).click();
  await editor.fill("- works on refunds");
  await saveBtn.click();
  await expect(settings.getByRole("alert")).toContainText(
    "no longer on the server",
  );
  await expect(settings.getByLabel("Your unsaved text")).toHaveValue(
    "- works on refunds",
  );
  await expect(settings.getByText("No long-term memories yet.")).toBeVisible();

  // After a reload the page shows the server's list, and no memory text was
  // kept in the URL or browser storage.
  await page.reload();
  await expect(
    (await openMemory(page)).getByText("No long-term memories yet."),
  ).toBeVisible();
  await expectNoStoredMemory(page, [
    "green tea",
    "oolong",
    "payments",
    "refunds",
    "ledger",
  ]);
});

test("long-term memory and daily notes export as the page shows them, with the server's update time", async ({
  page,
}) => {
  await memoryControl(page, "entries/reset");
  const chinese = "- 偏好中文回复 (updated: 2026-11-03)";
  await setMemoryEntry(page, "^mzh0001", `${chinese} ^mzh0001`);
  await start(page, "memory-main-e2e-token");
  const settings = await openMemory(page);
  await expect(settings.locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-28T00:00:00Z",
  );
  const bodies = [
    "- prefers dark roast coffee (updated: 2026-11-01)",
    "- works on the billing service (updated: 2026-11-02)",
    chinese,
  ];
  for (const body of bodies)
    await expect(settings.getByText(body)).toBeVisible();
  const save = async (group: string, format: string) => {
    const download = page.waitForEvent("download");
    await settings
      .getByRole("group", { name: group })
      .getByRole("button", { name: format, exact: true })
      .click();
    const file = await download;
    const bytes = await readFile((await file.path())!);
    return { name: file.suggestedFilename(), text: bytes.toString("utf8") };
  };
  const longJson = await save("Export long-term memory", "JSON");
  expect(longJson.name).toMatch(/^octos-memory-long-term-.+\.json$/);
  const long = JSON.parse(longJson.text);
  expect(long.scope).toMatchObject({
    what: "long_term_memory",
    updated_at: "2026-10-28T00:00:00Z",
    source: "entries",
  });
  expect(long.entries.map((entry: { text: string }) => entry.text)).toEqual(
    bodies.map(
      (body, index) => `${body} ${["^maaaaaa", "^mbbbbbb", "^mzh0001"][index]}`,
    ),
  );
  const longMd = await save("Export long-term memory", "Markdown");
  expect(longMd.name).toMatch(/\.md$/);
  for (const body of bodies)
    expect(longMd.text).toContain(`\`\`\`text\n${body}\n\`\`\``);
  const daily = JSON.parse((await save("Export daily notes", "JSON")).text);
  expect(daily).toMatchObject({
    scope: { what: "daily_notes" },
    today: { content: "Today’s memory note." },
    recent: [{ date: "2026-10-28", content: "Recent memory note." }],
  });
  const dailyMd = (await save("Export daily notes", "Markdown")).text;
  expect(dailyMd).toContain("## Today\n\n```text\nToday’s memory note.\n```");
  expect(dailyMd).toContain(
    "## 2026-10-28\n\n```text\nRecent memory note.\n```",
  );

  // With nothing to export, the page says so instead of making an empty file.
  for (const id of ["^maaaaaa", "^mbbbbbb", "^mzh0001"])
    await setMemoryEntry(page, id);
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  const longTerm = settings.getByRole("group", {
    name: "Export long-term memory",
  });
  await expect(longTerm.getByRole("button", { name: "JSON" })).toBeDisabled();
  await expect(
    settings.getByText("There is no long-term memory to export yet."),
  ).toBeVisible();
});
