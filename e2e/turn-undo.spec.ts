import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { composer } from "./sessions";
import { observeFrames } from "./turn-observers";
import { axeViolations } from "./axe";

// T-0433: "Undo this turn" in the latest turn's summary, wired to Core's
// `pre-turn <turn_id>` snapshot, with redo through the `pre-restore` point.
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

const timeline = (page: Page) =>
  page.getByRole("log", { name: "Conversation timeline" });
const summary = (page: Page) =>
  page.getByRole("region", { name: "Turn summary" }).last();

async function runTurn(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
}

async function snapshots(request: APIRequestContext, sessionId: string) {
  return (await (
    await request.get(
      `${FIXTURE_ORIGIN}/__test__/snapshots/state?session_id=${encodeURIComponent(sessionId)}`,
    )
  ).json()) as {
    snapshots: { id: string; label: string; turn_id?: string }[];
    restores: string[];
  };
}

async function confirm(
  scope: Locator,
  action: "undo" | "redo",
): Promise<Locator> {
  await scope
    .getByRole("button", {
      name: action === "undo" ? "Undo this turn" : "Redo this turn",
    })
    .click();
  const group = scope.getByRole("group", {
    name: action === "undo" ? "Confirm undo" : "Confirm redo",
  });
  await expect(group).toBeVisible();
  return group;
}

test("undo puts the turn's files back, keeps the conversation and draft, redo survives a reload", async ({
  page,
  request,
}) => {
  const protocol = observeFrames(page);
  await connectAndStartWorkspace(page, "/srv/work/turn-undo-walk");
  const prompt = "Change the app and then let me undo it";
  await runTurn(page, prompt);
  const sessionId = String(
    protocol.calls("session/open")[0]!.params!.session_id,
  );
  const turnId = String(protocol.calls("turn/start")[0]!.params!.turn_id);
  const preTurn = (await snapshots(request, sessionId)).snapshots.find(
    (snapshot) => snapshot.turn_id === turnId,
  )!;
  expect(preTurn).toBeTruthy();

  await composer(page).fill("an unsent draft");
  // A double click on the entry opens one confirmation and sends nothing.
  await summary(page)
    .getByRole("button", { name: "Undo this turn" })
    .dblclick();
  const group = summary(page).getByRole("group", { name: "Confirm undo" });
  await expect(group).toHaveCount(1);
  await expect(group).toContainText(
    "Changes made by commands are undone too, including ones not counted above.",
  );
  const shown = await group.innerText();
  for (const id of [sessionId, turnId, preTurn.id])
    expect(shown).not.toContain(id);
  expect(protocol.calls("snapshot/restore")).toHaveLength(0);
  expect(await axeViolations(page, "main", ["wcag2a", "wcag2aa"])).toEqual([]);

  const hydratesBefore = protocol.calls("session/hydrate").length;
  await group.getByRole("button", { name: "Undo file changes" }).dblclick();
  await expect(
    summary(page).getByText(
      "Undone. The files are back to how they were before this turn.",
    ),
  ).toBeVisible();
  expect(
    protocol.calls("snapshot/restore").map((frame) => frame.params),
  ).toEqual([{ session_id: sessionId, snapshot_id: preTurn.id }]);
  expect(protocol.calls("session/hydrate").length).toBeGreaterThan(
    hydratesBefore,
  );
  expect(protocol.calls("session/rollback")).toHaveLength(0);
  await expect(timeline(page).getByText(prompt, { exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(composer(page)).toHaveValue("an unsent draft");
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();

  const preRestore = (await snapshots(request, sessionId)).snapshots[0]!;
  expect(preRestore.label).toBe("pre-restore");

  await page.reload();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    summary(page).getByText(
      "This turn's file changes were undone. The conversation is kept.",
    ),
  ).toBeVisible();
  const redo = await confirm(summary(page), "redo");
  await redo.getByRole("button", { name: "Bring changes back" }).click();
  await expect(
    summary(page).getByText("Done. This turn's file changes are back."),
  ).toBeVisible();
  expect(
    protocol.calls("snapshot/restore").map((frame) => frame.params),
  ).toEqual([
    { session_id: sessionId, snapshot_id: preTurn.id },
    { session_id: sessionId, snapshot_id: preRestore.id },
  ]);

  await page.reload();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    summary(page).getByRole("button", { name: "Undo this turn" }),
  ).toBeVisible();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toHaveCount(0);
  expect(protocol.calls("snapshot/restore")).toHaveLength(2);

  // A redo Core refuses is reported in Core's own words and never retried.
  const undo = await confirm(summary(page), "undo");
  await undo.getByRole("button", { name: "Undo file changes" }).click();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();
  const conflict = await request.post(
    `${FIXTURE_ORIGIN}/__test__/snapshots/next-restore?session_id=${encodeURIComponent(sessionId)}&mode=conflict`,
  );
  expect(conflict.status()).toBe(204);
  const refused = await confirm(summary(page), "redo");
  await refused.getByRole("button", { name: "Bring changes back" }).click();
  const alert = summary(page).getByRole("alert");
  await expect(alert).toContainText(
    "Core did not bring this turn back. Check the files in Changes.",
  );
  await expect(alert).toContainText(
    "Core said: restore failed: restore refused: files were edited after the snapshot was taken",
  );
  await page.waitForTimeout(500);
  expect(protocol.calls("snapshot/restore")).toHaveLength(4);

  // A later turn closes the way back: the undone turn offers no redo, and
  // the new turn has its own undo.
  await composer(page).fill("A second change after the undo");
  await composer(page).press("Enter");
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  const summaries = page.getByRole("region", { name: "Turn summary" });
  await expect(summaries).toHaveCount(2);
  await expect(
    summaries.first().getByText("This turn's file changes were undone."),
  ).toBeVisible();
  await expect(
    summaries.first().getByRole("button", { name: "Redo this turn" }),
  ).toHaveCount(0);
  await expect(
    summaries.last().getByRole("button", { name: "Undo this turn" }),
  ).toBeVisible();
  expect(protocol.calls("snapshot/restore")).toHaveLength(4);
});
