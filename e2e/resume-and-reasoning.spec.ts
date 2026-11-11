import { expect, test, type Page } from "@playwright/test";
import {
  holdTerminals,
  releaseTerminal,
  terminalHeld,
} from "./fixture-controls";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import {
  composer,
  newSessionIn,
  productNavigation,
  selectedSessionId,
  sessionRow,
} from "./sessions";
import { observeFrames } from "./turn-observers";

const historyDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Resume historical conversation" });
/**
 * The transcript's reasoning entry. v0.10.0's Timeline replaced the old
 * `.entry-reasoning` row with a native <details> whose <summary> reads
 * "Thinking…" while the turn runs and "Thought process" once it ends
 * (Timeline.tsx ReasoningBlock). Matching the summary copy keeps the old
 * hook's meaning — "a reasoning entry is rendered" — instead of a dead class
 * name that would make every `toHaveCount(0)` below vacuously true.
 */
const reasoningEntries = (page: Page) =>
  page.locator("details").filter({
    has: page.locator("summary", { hasText: /Thought process|Thinking…/ }),
  });
/** The reasoning entry's own disclosure control (the collapsed default). */
const reasoningFold = (page: Page) => reasoningEntries(page).locator("summary");
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send prompt" }).click();
}
async function newSession(page: Page, name: string) {
  const sessionId = await newSessionIn(productNavigation(page), name);
  await expect(composer(page)).toBeEnabled();
  return sessionId;
}
const title = (page: Page) => selectedSessionId(productNavigation(page));
const row = (page: Page, sessionId: string) =>
  sessionRow(productNavigation(page), sessionId);
const control = (name: string, sessionId: string, method?: string) =>
  `${FIXTURE_ORIGIN}/__test__/native/${name}?${new URLSearchParams({ session_id: sessionId, ...(method ? { method } : {}) })}`;

test("resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history", async ({
  page,
  request,
}) => {
  const rpc = observeFrames(page).calls;
  await connectAndStartWorkspace(page, "/srv/work/native-workflows-resume");
  const owner = rpc("session/open").at(-1)!.params!.session_id;
  const seed = await request.post(control("seed-history", owner));
  expect(seed.status()).toBe(200);
  const { sessions } = (await seed.json()) as {
    sessions: { id: string; title: string }[];
  };
  const target = sessions.find(
    (item) => item.title === "Native historical Session A",
  )!;
  expect(target).toBeDefined();
  const opens = rpc("session/open").length;
  const hydrates = rpc("session/hydrate").length;
  await send(page, "/resume Native");
  const dialog = historyDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Unscoped native history (not resumable)",
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: target.title, exact: true }).click();
  const verify = dialog.getByRole("button", {
    name: "Verify history and resume",
  });
  await expect(verify).toBeDisabled();
  expect(rpc("session/open")).toHaveLength(opens);
  expect(rpc("session/hydrate")).toHaveLength(hydrates);
  await dialog
    .getByRole("checkbox", {
      name: /I confirm this Session should open in Profile/,
    })
    .check();
  await verify.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Historical native answer A", { exact: true }),
  ).toBeVisible();
  expect(
    rpc("session/open")
      .slice(opens)
      .map((call) => call.params!.session_id),
  ).toEqual([target.id]);
  expect(
    rpc("session/hydrate")
      .slice(hydrates)
      .map((call) => call.params!.session_id),
  ).toEqual([target.id]);
  expect(rpc("turn/start")).toHaveLength(0);
  await expect(
    productNavigation(page).getByText(
      "Unscoped native history (not resumable)",
    ),
  ).toHaveCount(0);
});

test("canceling a held historical open cannot install a late transcript or steal a new selection", async ({
  page,
  request,
}) => {
  const frames = observeFrames(page);
  const rpc = frames.calls;
  const workspace = "native-workflows-resume-cancel";
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  const owner = rpc("session/open").at(-1)!.params!.session_id;
  const original = await title(page);
  const seed = await request.post(control("seed-history", owner));
  expect(seed.status()).toBe(200);
  const { sessions } = (await seed.json()) as {
    sessions: { id: string; title: string }[];
  };
  const target = sessions.find(
    (item) => item.title === "Native historical Session B",
  )!;
  expect(
    (
      await request.post(control("hold", target.id, "session/hydrate"))
    ).status(),
  ).toBe(204);
  try {
    await send(page, "/resume");
    const dialog = historyDialog(page);
    await dialog
      .getByRole("button", { name: target.title, exact: true })
      .click();
    await dialog
      .getByRole("checkbox", {
        name: /I confirm this Session should open in Profile/,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Verify history and resume" })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get(control("state", target.id))).json()).held,
      )
      .toContain("session/hydrate");
    await dialog.getByRole("button", { name: "Close history picker" }).click();
    const next = await newSession(page, workspace);
    expect(next).not.toBe(original);
    await composer(page).fill("Preserve B draft after late history");
    expect(
      (
        await request.post(control("release", target.id, "session/hydrate"))
      ).status(),
    ).toBe(204);
    await expect
      .poll(
        async () =>
          (await (await request.get(control("state", target.id))).json()).held,
      )
      .toEqual([]);
    // The late transcript reached the page; before any click of ours, the
    // new Session is still selected with its draft.
    await frames.settled(
      rpc("session/hydrate").find(
        (frame) => frame.params?.session_id === target.id,
      )!,
    );
    await expect(row(page, next)).toHaveAttribute("aria-current", "page");
    await expect(composer(page)).toHaveValue(
      "Preserve B draft after late history",
    );
    for (let index = 0; index < 3; index += 1) {
      await row(page, original).click();
      await row(page, next).click();
      await expect(row(page, next)).toHaveAttribute("aria-current", "page");
      await expect(composer(page)).toHaveValue(
        "Preserve B draft after late history",
      );
      await expect(
        page.getByText("Historical native answer B", { exact: true }),
      ).toHaveCount(0);
    }
    expect(rpc("turn/start")).toHaveLength(0);
  } finally {
    await request.post(control("release", target.id, "session/hydrate"));
  }
});

test("resuming an already retained busy historical Session never reopens or resets its turn", async ({
  page,
  request,
}) => {
  const rpc = observeFrames(page).calls;
  const workspace = "native-workflows-resume-busy";
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  const owner = rpc("session/open").at(-1)!.params!.session_id;
  const seed = await request.post(control("seed-history", owner));
  expect(seed.status()).toBe(200);
  const { sessions } = (await seed.json()) as {
    sessions: { id: string; title: string }[];
  };
  const target = sessions.find(
    (item) => item.title === "Native historical Session A",
  )!;
  const resumeTarget = async () => {
    await send(page, "/resume Native historical Session A");
    const dialog = historyDialog(page);
    await dialog
      .getByRole("button", { name: target.title, exact: true })
      .click();
    await dialog
      .getByRole("checkbox", {
        name: /I confirm this Session should open in Profile/,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Verify history and resume" })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  await resumeTarget();
  await holdTerminals(request);
  try {
    await send(page, "Historical A must remain busy across resume");
    await terminalHeld(request, target.id);
    await newSession(page, workspace);
    const opens = rpc("session/open").length;
    await resumeTarget();
    expect(rpc("session/open")).toHaveLength(opens);
    expect(rpc("turn/start")).toHaveLength(1);
    expect(rpc("turn/start")[0]!.params!.session_id).toBe(target.id);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await releaseTerminal(request, target.id);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Historical A must remain busy across resume", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Completed with pnpm check and all tests passing."),
    ).toHaveCount(1);
    expect(rpc("turn/start")).toHaveLength(1);
    expect(rpc("turn/interrupt")).toHaveLength(0);
  } finally {
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  }
});

test("reasoning visibility is retained per Session and does not change captured model effort", async ({
  page,
}) => {
  const rpc = observeFrames(page).calls;
  const workspace = "native-workflows-reasoning";
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  const a = await title(page);
  await send(page, "/thinking");
  let dialog = page.getByRole("dialog", { name: "Thinking effort" });
  await dialog.getByLabel("Effort for new prompts").selectOption("high");
  await dialog
    .getByRole("checkbox", {
      name: "Show reasoning in this Session’s transcript",
    })
    .uncheck();
  await dialog.getByRole("button", { name: "Close thinking effort" }).click();
  const b = await newSession(page, workspace);
  await send(page, "/thinking");
  dialog = page.getByRole("dialog", { name: "Thinking effort" });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Show reasoning in this Session’s transcript",
    }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Effort for new prompts")).toHaveValue("");
  await dialog.getByRole("button", { name: "Close thinking effort" }).click();
  await row(page, a).click();
  await send(page, "/thinking");
  dialog = page.getByRole("dialog", { name: "Thinking effort" });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Show reasoning in this Session’s transcript",
    }),
  ).not.toBeChecked();
  await expect(dialog.getByLabel("Effort for new prompts")).toHaveValue("high");
  await dialog.getByRole("button", { name: "Close thinking effort" }).click();
  expect(rpc("turn/start")).toHaveLength(0);
  await send(page, "Verify native reasoning effort A");
  await expect.poll(() => rpc("turn/start").length).toBe(1);
  expect(rpc("turn/start")[0]!.params!.reasoning_effort).toBe("high");
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toBeVisible();
  await expect(reasoningEntries(page)).toHaveCount(0);
  await row(page, b).click();
  await send(page, "Verify native reasoning effort B");
  await expect.poll(() => rpc("turn/start").length).toBe(2);
  expect(rpc("turn/start")[1]!.params).not.toHaveProperty("reasoning_effort");
  // UX5 folds: the reasoning entry renders COLLAPSED by default as a
  // thinking fold button whose summary is "Thinking · N s · N words"
  // (Timeline.tsx). Expand it to read the fixture's reasoning body.
  const reasoningB = reasoningEntries(page);
  await expect(reasoningB).toHaveCount(1);
  await expect(reasoningFold(page)).toBeVisible();
  await reasoningFold(page).click();
  await expect(reasoningB).toContainText("Native workflow reasoning for");
  await row(page, a).click();
  await expect(reasoningEntries(page)).toHaveCount(0);
  await send(page, "/thinking");
  dialog = page.getByRole("dialog", { name: "Thinking effort" });
  await dialog
    .getByRole("checkbox", {
      name: "Show reasoning in this Session’s transcript",
    })
    .check();
  await dialog.getByRole("button", { name: "Close thinking effort" }).click();
  // The re-enabled entry stays EXPANDED for this session (folds state), or
  // re-expands per the show-reasoning pref; either way the body is one click
  // away behind the same disclosure.
  const foldA = reasoningFold(page);
  await expect(reasoningEntries(page)).toHaveCount(1);
  if (
    !(await reasoningEntries(page)
      .first()
      .evaluate((node) => (node as HTMLDetailsElement).open))
  )
    await foldA.click();
  await expect(reasoningEntries(page)).toContainText(
    "Native workflow reasoning for",
  );
  expect(rpc("turn/start")).toHaveLength(2);
});
