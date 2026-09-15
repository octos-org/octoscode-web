import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER = "Ask Octos to change, explain, or review code…";
const METHODS = [
  "profile/skills/list",
  "profile/skills/install",
  "profile/skills/remove",
  "profile/sub_providers/list",
  "profile/sub_providers/upsert",
  "profile/sub_providers/remove",
];
type Rpc = { id: string; method: string; params: Record<string, unknown> };
type HeldWrite = { request: Rpc; route: WebSocketRoute };

/** Only the baseline fixture is proxied. Every profile write is held locally. */
async function interceptProfileWrites(page: Page) {
  const writes: HeldWrite[] = [];
  const turnStarts: Rpc[] = [];
  const confirmedProfiles = new Set<string>();
  let installed = false;
  const lanes: Record<string, unknown>[] = [];
  function advertise(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(advertise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? [...new Set([...entry, ...METHODS])]
          : advertise(entry),
      ]),
    );
  }
  const reply = (held: HeldWrite, result: unknown) =>
    held.route.send(
      JSON.stringify({ jsonrpc: "2.0", id: held.request.id, result }),
    );
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      server.onMessage((message) => {
        const frame = JSON.parse(String(message));
        const profile = frame.result?.opened?.active_profile_id;
        if (typeof profile === "string") confirmedProfiles.add(profile);
        route.send(JSON.stringify(advertise(frame)));
      });
      route.onMessage((message) => {
        const request = JSON.parse(String(message)) as Rpc;
        const held = { request, route };
        const profile_id = request.params?.profile_id;
        if (request.method === "turn/start") {
          turnStarts.push(request);
          route.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32603, message: "This test never runs turns" },
            }),
          );
        } else if (request.method === "profile/skills/list") {
          const skills = installed
            ? [
                {
                  name: "sample",
                  version: null,
                  tool_count: 0,
                  source_repo: null,
                },
              ]
            : [];
          reply(held, { profile_id, count: skills.length, skills });
        } else if (request.method === "profile/sub_providers/list") {
          reply(held, { profile_id, sub_providers: lanes });
        } else if (METHODS.includes(request.method)) {
          writes.push(held);
        } else {
          server.send(message);
        }
      });
    },
  );
  return {
    writes,
    turnStarts,
    confirmedProfiles,
    succeed(index: number) {
      const held = writes[index]!;
      const { method, params } = held.request;
      const profile_id = params.profile_id;
      if (method === "profile/skills/install") {
        installed = true;
        reply(held, {
          profile_id,
          ok: true,
          installed: ["sample"],
          skipped: [],
          deps_installed: [],
        });
      } else if (method === "profile/skills/remove") {
        installed = false;
        reply(held, { profile_id, ok: true, removed: params.name });
      } else {
        lanes.splice(0, lanes.length);
        if (method === "profile/sub_providers/upsert")
          lanes.push(params.sub_provider as Record<string, unknown>);
        reply(held, {
          profile_id,
          sub_providers: lanes,
          applied: true,
          restart_required: true,
        });
      }
    },
    fail(index: number, message: string) {
      const held = writes[index]!;
      held.route.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: held.request.id,
          error: { code: -32603, message },
        }),
      );
    },
  };
}

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: /Choose a workspace|Add workspace/ });
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible()) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add
    .getByLabel("Server workspace path")
    .fill("/workspace/profile-mutation-test");
  await add.getByRole("button", { name: /Add & Start|Start session/ }).click();
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
}

async function command(page: Page, name: string) {
  await page.getByPlaceholder(COMPOSER).fill(`/${name}`);
  await page.getByPlaceholder(COMPOSER).press("Enter");
}

test("skill writes hold the profile lock through deferred replies and deduplicate confirmation", async ({
  page,
}) => {
  const rpc = await interceptProfileWrites(page);
  await connect(page);
  await command(page, "skills");
  const dialog = page.getByRole("dialog", { name: "Profile skills" });
  await expect(
    dialog.getByText("No skills installed in this Profile."),
  ).toBeVisible();
  await dialog
    .getByLabel("Repository or server-side path")
    .fill("example/sample");
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  expect(rpc.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Confirm install", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => rpc.writes.length).toBe(1);
  expect(rpc.writes[0]!.request.params).toMatchObject({
    repo: "example/sample",
    force: false,
  });
  expect(rpc.confirmedProfiles.size).toBe(1);
  expect(rpc.writes[0]!.request.params.profile_id).toBe(
    [...rpc.confirmedProfiles][0],
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm install", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Close skills" }),
  ).toBeDisabled();
  await expect(page.getByPlaceholder(COMPOSER)).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(rpc.writes).toHaveLength(1);
  rpc.succeed(0);
  await expect(
    dialog.getByRole("button", { name: "Remove sample" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Close skills" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Remove sample" }).click();
  await dialog
    .getByRole("button", { name: "Confirm remove", exact: true })
    .click();
  await expect.poll(() => rpc.writes.length).toBe(2);
  expect(rpc.writes[1]!.request.method).toBe("profile/skills/remove");
  expect(rpc.writes[1]!.request.params).toEqual({
    profile_id: [...rpc.confirmedProfiles][0],
    name: "sample",
  });
  await expect(page.getByPlaceholder(COMPOSER)).toBeDisabled();
  rpc.succeed(1);
  await expect(
    dialog.getByText("No skills installed in this Profile."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close skills" }).click();
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  expect(rpc.turnStarts).toHaveLength(0);
});

test("a failed credential write clears its input, consumes confirmation and requires a fresh review", async ({
  page,
}) => {
  const rpc = await interceptProfileWrites(page);
  await connect(page);
  await command(page, "research");
  const dialog = page.getByRole("dialog", { name: "Research provider lanes" });
  await expect(
    dialog.getByText("No research lanes configured in this Profile."),
  ).toBeVisible();
  await dialog.getByLabel("Lane key", { exact: true }).fill("sample");
  await dialog
    .getByLabel("Provider identity", { exact: true })
    .fill("synthetic-provider");
  await dialog
    .getByLabel("API key environment name")
    .fill("SYNTHETIC_TEST_KEY");
  const credential = dialog.getByLabel("New credential", { exact: false });
  const firstSecret = " synthetic-browser-secret ";
  await credential.fill(firstSecret);
  await dialog.getByRole("button", { name: "Review lane save" }).click();
  expect(rpc.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Confirm save", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => rpc.writes.length).toBe(1);
  expect(rpc.writes[0]!.request.params.api_key).toBe(firstSecret);
  expect(rpc.confirmedProfiles.size).toBe(1);
  expect(rpc.writes[0]!.request.params.profile_id).toBe(
    [...rpc.confirmedProfiles][0],
  );
  await expect(credential).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Close research lanes" }),
  ).toBeDisabled();
  await expect(page.getByPlaceholder(COMPOSER)).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  rpc.fail(
    0,
    `Provider echoed ${firstSecret.trim()} and ${JSON.stringify(firstSecret.trim())}`,
  );
  await expect(dialog.locator('[role="alert"]')).toContainText(
    "re-enter any credential",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm save", exact: true }),
  ).toHaveCount(0);
  await expect(credential).toBeEnabled();
  await expect(credential).toHaveValue("");
  expect(
    await page.evaluate(
      (secret) => ({
        dom: document.documentElement.outerHTML.includes(secret),
        local: JSON.stringify(localStorage).includes(secret),
        session: JSON.stringify(sessionStorage).includes(secret),
      }),
      firstSecret.trim(),
    ),
  ).toEqual({ dom: false, local: false, session: false });
  expect(rpc.writes).toHaveLength(1);
  await credential.fill("replacement-synthetic-key");
  await dialog.getByRole("button", { name: "Review lane save" }).click();
  expect(rpc.writes).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Confirm save", exact: true })
    .click();
  await expect.poll(() => rpc.writes.length).toBe(2);
  expect(rpc.writes[1]!.request.params.api_key).toBe(
    "replacement-synthetic-key",
  );
  expect(rpc.writes[1]!.request.params.profile_id).toBe(
    rpc.writes[0]!.request.params.profile_id,
  );
  rpc.succeed(1);
  await expect(dialog.getByText(/A serve restart is required/)).toBeVisible();
  await expect(dialog.getByText(/No restart was performed/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close research lanes" }).click();
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  expect(rpc.turnStarts).toHaveLength(0);
});
