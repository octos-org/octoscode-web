import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const composer = (page: Page) =>
  page.getByPlaceholder("Ask Octos to change, explain, or review code…");
const sidebar = (page: Page) =>
  page.locator("aside");
const selectedRow = (page: Page) =>
  sidebar(page).locator('button[role="treeitem"][aria-current="page"]');
const historyDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Resume historical conversation" });
type Rpc = {
  id: string;
  method: string;
  params: {
    session_id?: string;
    input?: { kind: string; text?: string }[];
    reasoning_effort?: string;
  };
};
function observe(page: Page) {
  const requests: Rpc[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Rpc;
      if (frame.method) requests.push(frame);
    }),
  );
  return (method: string) =>
    requests.filter((request) => request.method === method);
}
async function connect(page: Page, cwd: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible()) {
    await expect(chooser).toBeVisible();
    if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible()) {
      await chooser.getByRole("button", { name: "Add workspace" }).click();
    }
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(cwd);
  await add.getByRole("button", { name: /Add & Start|Start session/ }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
}
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send prompt" }).click();
}
async function newSession(page: Page, name: string) {
  await sidebar(page)
    .getByRole("treeitem", { name, exact: true })
    .getByRole("button", { name, exact: true })
    .hover();
  await sidebar(page)
    .getByRole("button", { name: `New session in ${name}` })
    .click();
  await expect(composer(page)).toBeEnabled();
}
async function title(page: Page) {
  return (
    await selectedRow(page).locator('[class*="sessionTitle"]').innerText()
  ).trim();
}
const row = (page: Page, name: string) =>
  sidebar(page).locator('button[role="treeitem"]').filter({ hasText: name });
const control = (name: string, sessionId: string, method?: string) =>
  `${origin}/__test__/native/${name}?${new URLSearchParams({ session_id: sessionId, ...(method ? { method } : {}) })}`;

test("resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history", async ({
  page,
  request,
}) => {
  const rpc = observe(page);
  await connect(page, "/srv/work/native-workflows-resume");
  const owner = rpc("session/open").at(-1)!.params.session_id!;
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
      .map((call) => call.params.session_id),
  ).toEqual([target.id]);
  expect(
    rpc("session/hydrate")
      .slice(hydrates)
      .map((call) => call.params.session_id),
  ).toEqual([target.id]);
  expect(rpc("turn/start")).toHaveLength(0);
  await expect(
    sidebar(page).getByText("Unscoped native history (not resumable)"),
  ).toHaveCount(0);
});

test("canceling a held historical open cannot install a late transcript or steal a new selection", async ({
  page,
  request,
}) => {
  const rpc = observe(page);
  const workspace = "native-workflows-resume-cancel";
  await connect(page, `/srv/work/${workspace}`);
  const owner = rpc("session/open").at(-1)!.params.session_id!;
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
    await newSession(page, workspace);
    const next = await title(page);
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
  const rpc = observe(page);
  const workspace = "native-workflows-resume-busy";
  await connect(page, `/srv/work/${workspace}`);
  const owner = rpc("session/open").at(-1)!.params.session_id!;
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
  expect(
    (await request.post(`${origin}/__test__/terminal/hold-next`)).status(),
  ).toBe(204);
  try {
    await send(page, "Historical A must remain busy across resume");
    await expect
      .poll(async () => {
        const state = (await (
          await request.get(`${origin}/__test__/terminal/state`)
        ).json()) as { held: { session_id: string }[] };
        return state.held.map((entry) => entry.session_id);
      })
      .toContain(target.id);
    await newSession(page, workspace);
    const opens = rpc("session/open").length;
    await resumeTarget();
    expect(rpc("session/open")).toHaveLength(opens);
    expect(rpc("turn/start")).toHaveLength(1);
    expect(rpc("turn/start")[0]!.params.session_id).toBe(target.id);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    expect(
      (
        await request.post(
          `${origin}/__test__/terminal/release?session_id=${encodeURIComponent(target.id)}`,
        )
      ).status(),
    ).toBe(204);
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
    await request.post(`${origin}/__test__/terminal/reset`);
  }
});

test("reasoning visibility is retained per Session and does not change captured model effort", async ({
  page,
}) => {
  const rpc = observe(page);
  const workspace = "native-workflows-reasoning";
  await connect(page, `/srv/work/${workspace}`);
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
  await newSession(page, workspace);
  const b = await title(page);
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
  expect(rpc("turn/start")[0]!.params.reasoning_effort).toBe("high");
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toBeVisible();
  await expect(page.locator(".entry-reasoning")).toHaveCount(0);
  await row(page, b).click();
  await send(page, "Verify native reasoning effort B");
  await expect.poll(() => rpc("turn/start").length).toBe(2);
  expect(rpc("turn/start")[1]!.params).not.toHaveProperty("reasoning_effort");
  // UX5 folds: the reasoning entry renders COLLAPSED by default as a
  // ThinkingDisclosure button whose summary is "Thinking · N s · N words"
  // (folds.ts:83). Expand it to read the fixture's reasoning body.
  const reasoningB = page.locator(".entry-reasoning");
  await expect(reasoningB.getByRole("button", { name: /Thinking · / })).toBeVisible();
  await reasoningB.getByRole("button", { name: /Thinking · / }).click();
  await expect(reasoningB).toContainText("Native workflow reasoning for");
  await row(page, a).click();
  await expect(page.locator(".entry-reasoning")).toHaveCount(0);
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
  const reasoningA = page.locator(".entry-reasoning");
  const foldA = reasoningA.getByRole("button", { name: /Thinking · / });
  if (await foldA.isVisible()) await foldA.click();
  await expect(page.locator(".entry-reasoning")).toContainText(
    "Native workflow reasoning for",
  );
  expect(rpc("turn/start")).toHaveLength(2);
});
