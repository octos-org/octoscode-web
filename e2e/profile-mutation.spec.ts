import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { composer } from "./sessions";
import { sendError, sendResult } from "./wire";

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
async function interceptProfileWrites(page: Page, installedAtStart = false) {
  const writes: HeldWrite[] = [];
  const turnStarts: Rpc[] = [];
  const confirmedProfiles = new Set<string>();
  let installed = installedAtStart;
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
    sendResult(held.route, held.request.id, result);
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
          sendError(route, request.id, {
            code: -32603,
            message: "This test never runs turns",
          });
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
      if (method === "profile/skills/remove") {
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
      sendError(held.route, held.request.id, { code: -32603, message });
    },
  };
}

async function command(page: Page, name: string) {
  await composer(page).fill(`/${name}`);
  await composer(page).press("Enter");
}

test("a failed credential write clears its input, consumes confirmation and requires a fresh review", async ({
  page,
}) => {
  const rpc = await interceptProfileWrites(page);
  await connectAndStartWorkspace(page, "/workspace/profile-mutation-test");
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
  await expect(composer(page)).toBeDisabled();
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
  await expect(composer(page)).toBeEnabled();
  expect(rpc.turnStarts).toHaveLength(0);
});
