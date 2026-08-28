import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const ADMIN_FIXTURE_TOKEN = "tab-scoped-e2e-token";
const PROFILE_FIXTURE_TOKEN = "profile-scoped-e2e-token";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

async function submitConnection(page: Page, token: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

async function connectToWorkspaceChooser(
  page: Page,
  token: string,
): Promise<void> {
  await submitConnection(page, token);
  await expect(
    page.getByRole("complementary", { name: "Product navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Choose a workspace" }),
  ).toBeVisible();
}

async function addWorkspace(page: Page, cwd: string): Promise<void> {
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(cwd);
  await add.getByRole("button", { name: "Add & Start" }).click();
}

test("rejects invalid auth before the product shell is ever mounted", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const watch = { seen: false };
    const scan = () => {
      if (document.querySelector('[aria-label="Product navigation"]')) {
        watch.seen = true;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    Object.assign(window, { __octosFixtureShellWatch: watch });
    scan();
  });

  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("fixture-invalid-auth-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Could not open the Octos UI Protocol connection",
  );
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Product navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Choose a workspace" }),
  ).toHaveCount(0);
  const shellWasSeen = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __octosFixtureShellWatch?: { seen: boolean };
        }
      ).__octosFixtureShellWatch?.seen ?? false,
  );
  expect(shellWasSeen).toBe(false);
});

test("accepts a profile-routable web identity but closes a scoped mismatch", async ({
  page,
}) => {
  await page.goto("/");

  const accepted = await openFixtureSession(page, {
    token: PROFILE_FIXTURE_TOKEN,
    sessionId: "coding:api:web-profile-e2e",
    profileId: "coding",
  });
  expect(accepted).toEqual({
    kind: "opened",
    sessionId: "coding:api:web-profile-e2e",
    profileId: "coding",
  });

  const rejected = await openFixtureSession(page, {
    token: PROFILE_FIXTURE_TOKEN,
    sessionId: "review:api:web-profile-e2e-mismatch",
    profileId: "review",
  });
  expect(rejected).toEqual({
    kind: "closed",
    code: 1008,
    reason: "auth_expired",
  });
});

test("binds a cross-profile launch to the resolved profile before open", async ({
  page,
}) => {
  const opens: Array<Record<string, unknown>> = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload)) as {
          method?: unknown;
          params?: unknown;
        };
        if (
          frame.method === "session/open" &&
          frame.params &&
          typeof frame.params === "object"
        ) {
          opens.push(frame.params as Record<string, unknown>);
        }
      } catch {
        // Non-JSON control frames are irrelevant to this identity assertion.
      }
    });
  });

  await connectToWorkspaceChooser(page, ADMIN_FIXTURE_TOKEN);
  await addWorkspace(page, "/srv/work/cross");
  await page
    .getByRole("button", { name: /Start new session with review/ })
    .click();

  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
  await expect
    .poll(() => opens.some((params) => params.profile_id === "review"))
    .toBe(true);
  const open = opens.find((params) => params.profile_id === "review");
  expect(open?.session_id).toEqual(expect.stringMatching(/^review:api:web-/));
});

interface FixtureSessionInput {
  token: string;
  sessionId: string;
  profileId: string;
}

type FixtureSessionOutcome =
  | { kind: "opened"; sessionId: string; profileId: string }
  | { kind: "closed"; code: number; reason: string };

async function openFixtureSession(
  page: Page,
  input: FixtureSessionInput,
): Promise<FixtureSessionOutcome> {
  return page.evaluate(
    ({ origin, token, sessionId, profileId }) =>
      new Promise<FixtureSessionOutcome>((resolve, reject) => {
        const endpoint = new URL("/api/ui-protocol/ws", origin);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        endpoint.searchParams.set("token", token);
        const socket = new WebSocket(endpoint);
        let settled = false;
        const finish = (outcome: FixtureSessionOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(outcome);
        };
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error("fixture session/open timed out"));
        }, 5_000);

        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "identity-open",
              method: "session/open",
              params: {
                session_id: sessionId,
                profile_id: profileId,
                cwd: "/workspace/identity-contract",
              },
            }),
          );
        });
        socket.addEventListener("message", (event) => {
          const frame = JSON.parse(String(event.data)) as {
            id?: unknown;
            result?: {
              opened?: {
                session_id?: unknown;
                active_profile_id?: unknown;
              };
            };
          };
          if (frame.id !== "identity-open" || !frame.result?.opened) return;
          const opened = frame.result.opened;
          socket.close(1000, "fixture_complete");
          finish({
            kind: "opened",
            sessionId: String(opened.session_id),
            profileId: String(opened.active_profile_id),
          });
        });
        socket.addEventListener("close", (event) => {
          finish({ kind: "closed", code: event.code, reason: event.reason });
        });
      }),
    { origin: FIXTURE_ORIGIN, ...input },
  );
}
