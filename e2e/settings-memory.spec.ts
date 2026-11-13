import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN } from "./fixture-session.ts";
import { openMemory, startMemorySession } from "./memory-settings.ts";
import { observeFrames, observeSent } from "./turn-observers";

const start = (page: Page, token = "memory-e2e-token") =>
  startMemorySession(page, token, "settings-memory");

test("ingest → search → detail survives a page refresh, and failures stay honest", async ({
  page,
}) => {
  const ingestCalls = observeSent(page, "memory/ingest");
  await start(page);
  const settings = await openMemory(page);

  // Results are labeled with the query that answered them.
  await settings.getByLabel("Search memories").fill("protocol");
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await expect(settings.getByText("Results for “protocol”")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /T0008 protocol probe/ }),
  ).toBeVisible();

  // A failed search keeps those labeled facts and says so.
  await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/memory/fail-next?method=memory/search`,
  );
  await settings.getByLabel("Search memories").fill("other");
  await settings.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    settings.getByRole("alert").getByText("memory backend unavailable"),
  ).toBeVisible();
  await expect(settings.getByText("Results for “protocol”")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /T0008 protocol probe/ }),
  ).toBeVisible();

  // Remember: one click chain submits exactly once, even double-clicked.
  await settings.getByLabel("Title").fill("Refresh proof");
  await settings.getByLabel("Summary").fill("survives a reload");
  await settings.getByLabel("Memory content").fill("refresh-kept body");
  await settings
    .getByRole("button", { name: "Remember this", exact: true })
    .evaluate((node: HTMLElement) => {
      node.click();
      node.click();
    });
  await expect(
    settings.getByText(/^Saved “Refresh proof” .* It's open in Detail;/),
  ).toBeVisible();
  await expect(settings.getByText("refresh-kept body")).toBeVisible();
  expect(ingestCalls()).toHaveLength(1);

  // A failed ingest says so and keeps the form.
  await settings.getByLabel("Title").fill("Will fail");
  await settings.getByLabel("Summary").fill("kept on failure");
  await settings.getByLabel("Memory content").fill("failure body kept");
  await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/memory/fail-next?method=memory/ingest`,
  );
  await settings
    .getByRole("button", { name: "Remember this", exact: true })
    .click();
  await expect(
    settings.getByRole("alert").getByText("memory backend unavailable"),
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
  await again.getByLabel("Search memories").fill("Refresh proof");
  await again.getByRole("button", { name: "Search", exact: true }).click();
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
  const control = (path: string) =>
    page.request.post(`${FIXTURE_ORIGIN}/__test__/memory/${path}`);
  await control("entries/reset");
  await start(page, "memory-main-e2e-token");
  const settings = await openMemory(page);
  const entry = (text: string) =>
    settings.getByRole("listitem").filter({ hasText: text });
  const editor = settings.getByLabel("Edit memory");
  await expect(settings.getByText(/not available in the current/)).toHaveCount(
    0,
  );

  // Requesting and promoting each say where the memory goes (F-005).
  const request = settings.getByRole("button", { name: "Request memory" });
  await expect(request).toHaveAccessibleDescription(/until Octos files it/);
  await settings.getByLabel("Memory content").fill("prefers tea");
  await request.click();
  const requested = settings.getByText(/^Octos will remember it\. .*Long-term/);
  await expect(requested).toBeVisible();
  await settings.getByRole("button", { name: "Promote to Knowledge" }).click();
  await expect(settings.getByText(/^Handed 1 document\(s\)/)).toBeVisible();
  await expect(requested).toHaveCount(0);

  // An edit sends the text verbatim against the version on screen; the list
  // then shows what the server stored, its own stamp included.
  await entry("dark roast").getByRole("button", { name: "Edit" }).click();
  await expect(editor).toHaveValue(
    "- prefers dark roast coffee (updated: 2026-11-01)",
  );
  await editor.fill("- prefers green tea");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByText(/^Saved\./)).toBeVisible();
  await expect(entry("green tea").locator("p")).toHaveText(
    "- prefers green tea (updated: 2026-11-10)",
  );
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
  await control(
    `entries/set?id=${encodeURIComponent("^mbbbbbb")}&text=${encodeURIComponent("- works on the ledger (updated: 2026-11-09) ^mbbbbbb")}`,
  );
  await entry("billing").getByRole("button", { name: "Edit" }).click();
  await editor.fill("- works on payments");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "changed on the server",
  );
  await expect(editor).toHaveValue("- works on payments");
  await expect(entry("ledger")).toContainText(
    "On the server: - works on the ledger (updated: 2026-11-09)",
  );
  await expect(settings.getByText("billing")).toHaveCount(0);
  // An unconfirmed save keeps the draft too.
  await control("fail-next?method=memory/edit");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("didn't confirm");
  await expect(editor).toHaveValue("- works on payments");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(entry("payments")).toBeVisible();

  // Delete asks first; keeping it changes nothing.
  await entry("green tea")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await settings.getByRole("button", { name: "Keep it" }).click();
  await entry("green tea")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await settings.getByRole("button", { name: "Delete memory" }).click();
  await expect(settings.getByText(/^Deleted\./)).toBeVisible();
  await expect(entry("green tea")).toHaveCount(0);

  // Gone from the server before the save: the text is offered back.
  await control(`entries/set?id=${encodeURIComponent("^mbbbbbb")}`);
  await entry("payments").getByRole("button", { name: "Edit" }).click();
  await editor.fill("- works on refunds");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
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
  const kept = await page.evaluate(
    () =>
      location.href + JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  for (const text of ["green tea", "payments", "refunds", "ledger"])
    expect(kept).not.toContain(text);
});
