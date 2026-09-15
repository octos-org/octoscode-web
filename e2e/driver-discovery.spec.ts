/**
 * Driver-discovery (external driver v1) mounted-Web spec — SOURCE ONLY.
 *
 * Written against the opt-in synthetic fixture family in
 * `apps/web/scripts/mock-ui-server.mjs` (`/srv/work/driver-discovery-<variant>`)
 * and the real client/wire contracts read from
 * `features/session/external-driver.ts`, `session-record-manager.ts`,
 * `features/session/driver-discovery.ts`, and
 * `product-controls/SessionControlBar.tsx`. It has NOT been executed; every
 * assertion names the real rendered string, wire method, or fixture endpoint
 * it depends on.
 *
 * Variants (workspace suffix -> behavior):
 *   (default)   healthy external binding, empty terminal operations page
 *   internal    binding: null (internal controller)
 *   delay       FIRST walk of the workspace is held until released
 *   no-method   capability omits session/driver/get
 *   no-feature  capability omits external_driver_v1
 *   refused     typed refusal (data.kind driver_scope_mismatch)
 *   malformed   non-integer binding epoch (strict decoder must reject)
 *
 * Frame observation is PROJECTED AT CAPTURE: only allowlisted public
 * fields/counts/request IDs are ever retained. No full params, no payloads,
 * no arbitrary server copy — the raw JSON frame is dropped at the handler.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { openSessionController, closeSessionController } from "./session-settings.ts";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER = "Ask Octos to change, explain, or review code…";
const METHOD = "session/driver/get";

/** Control/mutation + model RPCs the read-only disclosure must NEVER emit. */
const FORBIDDEN_DURING_DISCLOSURE = new Set([
  "session/driver/acquire",
  "session/driver/renew",
  "session/driver/release",
  "peer/dispatch",
  "peer/control",
  "session/wake/claim",
  "session/wake/ack",
]);
function isControlOrModel(method: string | null): boolean {
  if (method === null) return false;
  return (
    FORBIDDEN_DURING_DISCLOSURE.has(method) ||
    method.startsWith("profile/llm/")
  );
}

/**
 * Allowlisted projection of ONE captured frame. This is the ONLY shape the
 * probe ever retains: request-id + method of the frame, the driver request's
 * session id / operation-flag / param COUNT, and the driver reply's public
 * disclosure fields plus operations page COUNTS. Nothing else survives.
 */
interface ObservedFrame {
  readonly id: string | null;
  readonly method: string | null;
  readonly sessionId: string | null;
  readonly operationsRequested: boolean;
  readonly paramKeys: number;
  readonly errorCode: number | null;
  readonly refusalKind: string | null;
  readonly mode: string | null;
  readonly recovery: string | null;
  readonly driverId: string | null;
  readonly epoch: number | null;
  readonly revision: number | null;
  readonly leaseExpiresAtMs: number | null;
  readonly opsComplete: boolean | null;
  readonly opsItemCount: number | null;
  readonly opsNextCursorNull: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Project a raw wire frame down to the allowlisted observation shape. */
/**
 * A captured frame plus the connection ordinal it arrived on. RPC request ids
 * are per-CONNECTION: after a transport reconnect the client opens a NEW socket
 * whose ids restart at 1, so an id alone cannot identify a frame across a
 * reconnect (the healthy pre-reconnect reply and the refused post-reconnect
 * reply can BOTH be id "8").
 */
type Captured = ObservedFrame & { readonly socket: number };

function project(raw: unknown): ObservedFrame | null {
  const frame = asRecord(raw);
  if (frame === null) return null;
  const params = asRecord(frame.params);
  const result = asRecord(frame.result);
  const error = asRecord(frame.error);
  const errorData = asRecord(error?.data);
  const binding = asRecord(result?.binding);
  const operations = asRecord(result?.operations);
  return {
    id: asString(frame.id),
    method: asString(frame.method),
    sessionId: asString(params?.session_id),
    operationsRequested: params !== null && "operations" in params,
    paramKeys: params === null ? 0 : Object.keys(params).length,
    errorCode: asNumber(error?.code),
    refusalKind: asString(errorData?.kind),
    mode: asString(result?.mode),
    recovery: asString(result?.recovery),
    driverId: asString(binding?.driver_id),
    epoch: asNumber(binding?.epoch),
    revision: asNumber(binding?.revision),
    leaseExpiresAtMs: asNumber(binding?.lease_expires_at_ms),
    opsComplete: operations === null ? null : operations.complete === true,
    opsItemCount: Array.isArray(operations?.items)
      ? operations.items.length
      : null,
    opsNextCursorNull:
      operations === null ? null : operations.next_cursor === null,
  };
}

/** Real captured frames, projected on the way in; nothing raw is retained. */
function observe(page: Page) {
  const sent: Captured[] = [];
  const received: Captured[] = [];
  // Post-reconnect replies must never be attributed to the stale pre-reconnect
  // frame that reused their id, so every frame is tagged with the socket it
  // arrived on and replies are matched WITHIN that socket.
  let socketOrdinal = 0;
  const socketIds = new WeakMap<object, number>();
  const ordinal = (socket: object): number => {
    const known = socketIds.get(socket);
    if (known !== undefined) return known;
    const assigned = socketOrdinal;
    socketOrdinal += 1;
    socketIds.set(socket, assigned);
    return assigned;
  };
  const take = (payload: unknown): ObservedFrame | null => {
    try {
      return project(JSON.parse(String(payload)) as unknown);
    } catch {
      return null;
    }
  };
  page.on("websocket", (socket) => {
    const connection = ordinal(socket);
    socket.on("framesent", ({ payload }) => {
      const frame = take(payload);
      if (frame) sent.push({ ...frame, socket: connection });
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = take(payload);
      if (frame) received.push({ ...frame, socket: connection });
    });
  });
  return {
    sent,
    received,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
    replyTo: (frame: Captured): ObservedFrame | null =>
      received.find(
        (candidate) =>
          candidate.id === frame.id && candidate.socket === frame.socket,
      ) ?? null,
    async settled(frame: Captured) {
      await expect
        .poll(() =>
          received.some(
            (candidate) =>
              candidate.id === frame.id && candidate.socket === frame.socket,
          ),
        )
        .toBe(true);
    },
  };
}
type Probe = ReturnType<typeof observe>;

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Product navigation" });
}
function disclosure(page: Page) {
  return page.locator('[data-control-disclosure="driver"]');
}
/** The rendered fact row whose <dt> is exactly `label` (Driver/Epoch/...). */
function factRow(page: Page, label: string) {
  return disclosure(page)
    .locator("dl > div")
    .filter({ hasText: label });
}

async function selectedTitle(page: Page): Promise<string> {
  const value = await sidebar(page)
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!value) throw new Error("A confirmed selected Session is required");
  return value;
}

/** Switch selection back to a previously opened Session by its sidebar title. */
async function selectSession(page: Page, title: string) {
  await closeSessionController(page);
  await sidebar(page)
    .locator('button[role="treeitem"]')
    .filter({ hasText: title })
    .click();
  await expect.poll(() => selectedTitle(page)).toBe(title);
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  await openSessionController(page);
}

/**
 * Connect to the fixture and start a workspace whose synthetic variant is
 * encoded by the suffix (empty string = healthy default).
 */
async function connect(
  page: Page,
  probe: Probe,
  variant: string,
): Promise<{ sessionId: string; workspace: string; title: string }> {
  const workspace = `driver-discovery-${variant}`;
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(`/srv/work/${workspace}`);
  await add.getByRole("button", { name: "Add & Start" }).click();
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  await expect.poll(() => probe.calls("session/open").length).toBeGreaterThan(0);
  const sessionId = probe.calls("session/open").at(-1)!.sessionId;
  if (typeof sessionId !== "string")
    throw new Error("Expected a full Session ID");
  const title = await selectedTitle(page);
  await openSessionController(page);
  return { sessionId, workspace, title };
}

/** Open a second Session in the SAME workspace (same synthetic variant). */
async function sibling(
  page: Page,
  probe: Probe,
  workspace: string,
): Promise<string> {
  await closeSessionController(page);
  const opens = probe.calls("session/open").length;
  const row = sidebar(page).getByRole("treeitem", {
    name: workspace,
    exact: true,
  });
  await row.getByRole("button", { name: workspace, exact: true }).hover();
  await sidebar(page)
    .getByRole("button", { name: `New session in ${workspace}` })
    .click();
  await expect.poll(() => probe.calls("session/open").length).toBe(opens + 1);
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  const sessionId = probe.calls("session/open").at(-1)!.sessionId;
  if (typeof sessionId !== "string")
    throw new Error("Expected a sibling Session ID");
  await openSessionController(page);
  return sessionId;
}

async function driverControl(
  request: APIRequestContext,
  action: string,
  sessionId: string,
  method?: string,
) {
  const query = new URLSearchParams({
    session_id: sessionId,
    ...(method ? { method } : {}),
  });
  expect(
    (await request.post(`${ORIGIN}/__test__/driver/${action}?${query}`)).status(),
  ).toBe(204);
}

async function heldDriver(
  request: APIRequestContext,
  sessionId: string,
): Promise<{ held: string[]; armed: string[] }> {
  const response = await request.get(
    `${ORIGIN}/__test__/driver/state?${new URLSearchParams({ session_id: sessionId })}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as { held: string[]; armed: string[] };
}

/** Force a transport drop so the SAME record re-hydrates and re-walks. */
async function forceReconnect(request: APIRequestContext) {
  expect((await request.post(`${ORIGIN}/__test__/disconnect`)).status()).toBe(
    204,
  );
}

test.describe("external driver discovery (synthetic fixture)", () => {
  // GLOBAL teardown after EVERY test, pass or fail: clears every driver hold,
  // the WORKSPACE-keyed delay arm, and both session-keyed flips. Without this
  // the delay arm would bleed into the next test.
  test.afterEach(async ({ request }) => {
    await request.post(`${ORIGIN}/__test__/driver/reset-all`);
  });

  // ---------------------------------------------------------------- group 1
  test("renders a healthy EXTERNAL disclosure from the real empty terminal operations page", async ({
    page,
  }) => {
    const probe = observe(page);
    const s = await connect(page, probe, "");

    // Exactly one discovery walk, and it requests a real operations page. The
    // walk ALWAYS sends `operations`; a reply without a valid terminal page
    // (items [], complete, next_cursor null) is UNSUPPORTED, not complete.
    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(0);
    const walk = probe.calls(METHOD)[0]!;
    expect(walk.sessionId).toBe(s.sessionId);
    expect(walk.operationsRequested).toBe(true);
    // Allowlisted param COUNT: exactly `session_id` + `operations`, no topic
    // and no injected extra argument.
    expect(walk.paramKeys).toBe(2);
    await probe.settled(walk);
    const reply = probe.replyTo(walk)!;
    expect(reply.opsComplete).toBe(true);
    expect(reply.opsItemCount).toBe(0);
    expect(reply.opsNextCursorNull).toBe(true);

    // The disclosure mounts ONLY when the inventory is complete.
    const bar = disclosure(page);
    await expect(bar).toHaveCount(1);
    await expect(bar.locator("summary")).toContainText("External controller");
    await expect(bar).toContainText("No recovery pending");
    await expect(bar).toContainText("No active lease"); // lease_expires_at_ms: 0

    // Facts are hidden until the native <details> is opened BY KEYBOARD, and
    // opening it must not emit a single control or model RPC.
    const facts = bar.locator("dl > div");
    await expect(facts.filter({ hasText: "Driver" })).not.toBeVisible();
    const controlModelBefore = probe.sent.filter((frame) =>
      isControlOrModel(frame.method),
    ).length;
    await bar.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(bar).toHaveAttribute("open", "");

    // Visible synthetic identity: exact rendered ID + epoch + revision.
    const driverRow = facts.filter({ hasText: "Driver" });
    await expect(driverRow).toBeVisible();
    await expect(driverRow).toContainText(`synthetic-driver-${s.sessionId}`);
    await expect(facts.filter({ hasText: "Epoch" })).toContainText("7");
    await expect(facts.filter({ hasText: "Revision" })).toContainText("42");

    const controlModelAfter = probe.sent.filter((frame) =>
      isControlOrModel(frame.method),
    ).length;
    expect(controlModelAfter).toBe(controlModelBefore);
  });

  test("renders an INTERNAL disclosure with no binding rows", async ({
    page,
  }) => {
    const probe = observe(page);
    await connect(page, probe, "internal");

    const bar = disclosure(page);
    await expect(bar).toHaveCount(1);
    await expect(bar.locator("summary")).toContainText("Internal controller");
    // No binding => the Driver/Epoch/Revision/Lease rows must not be rendered.
    await expect(bar).not.toContainText("No active lease");
    await expect(bar).not.toContainText("synthetic-driver-");
  });

  // ---------------------------------------------------------------- group 2
  test("holds ONLY the first walk of a workspace: same-workspace sibling completes while A stays held", async ({
    page,
    request,
  }) => {
    const probe = observe(page);
    const a = await connect(page, probe, "delay");

    // A's walk is deterministically held (no arm-after-open race): its request
    // is on the wire but unanswered, so A never becomes complete.
    await expect
      .poll(async () => (await heldDriver(request, a.sessionId)).held)
      .toContain(METHOD);
    await expect(disclosure(page)).toHaveCount(0);

    // A sibling in the SAME workspace must still complete — the delay barrier
    // is keyed by workspace, and only its FIRST request is held.
    const bSession = await sibling(page, probe, a.workspace);
    await expect(disclosure(page)).toHaveCount(1);
    await expect(disclosure(page).locator("summary")).toContainText(
      "External controller",
    );
    await expect
      .poll(async () => (await heldDriver(request, bSession)).held)
      .toEqual([]);

    // Releasing A delivers its ORIGINAL captured reply verbatim.
    await driverControl(request, "release", a.sessionId, METHOD);
    await expect
      .poll(async () => (await heldDriver(request, a.sessionId)).held)
      .toEqual([]);
  });

  test("A/B: exact synthetic driver ID per selected Session; releasing held A never leaks into a selected B", async ({
    page,
    request,
  }) => {
    const probe = observe(page);
    const a = await connect(page, probe, "delay");
    await expect
      .poll(async () => (await heldDriver(request, a.sessionId)).held)
      .toContain(METHOD);
    await expect(disclosure(page)).toHaveCount(0);

    // B (same delay workspace) completes and is selected. Its disclosure must
    // show B's OWN exact synthetic driver id.
    const bSession = await sibling(page, probe, a.workspace);
    const aId = `synthetic-driver-${a.sessionId}`;
    const bId = `synthetic-driver-${bSession}`;
    expect(aId).not.toBe(bId);
    await expect(disclosure(page)).toHaveCount(1);
    await expect(factRow(page, "Driver")).toContainText(bId);
    await expect(factRow(page, "Driver")).not.toContainText(aId);

    // Release A WHILE B is selected: B must retain B, not adopt A.
    await driverControl(request, "release", a.sessionId, METHOD);
    await expect
      .poll(async () => (await heldDriver(request, a.sessionId)).held)
      .toEqual([]);
    await expect(factRow(page, "Driver")).toContainText(bId);
    await expect(factRow(page, "Driver")).not.toContainText(aId);

    // Switch back to A: A now presents A's OWN id, never B's.
    await selectSession(page, a.title);
    await expect(disclosure(page)).toHaveCount(1);
    await expect(factRow(page, "Driver")).toContainText(aId);
    await expect(factRow(page, "Driver")).not.toContainText(bId);
  });

  // ---------------------------------------------------------------- group 3
  for (const variant of ["no-method", "no-feature"]) {
    test(`does not admit a walk when ${variant} capability is withheld`, async ({
      page,
    }) => {
      const probe = observe(page);
      await connect(page, probe, variant);

      // The admission gate requires BOTH the method and the feature; with one
      // withheld the walk must never be sent and no disclosure may mount.
      await page.waitForTimeout(500);
      expect(probe.calls(METHOD)).toHaveLength(0);
      await expect(disclosure(page)).toHaveCount(0);
    });
  }

  // ---------------------------------------------------------------- group 4
  test("surfaces a typed refusal and never mounts a disclosure for it", async ({
    page,
  }) => {
    const probe = observe(page);
    await connect(page, probe, "refused");

    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(0);
    const walk = probe.calls(METHOD)[0]!;
    await probe.settled(walk);
    const reply = probe.replyTo(walk)!;
    expect(reply.errorCode).toBe(-32_041);
    expect(reply.refusalKind).toBe("driver_scope_mismatch");
    await expect(disclosure(page)).toHaveCount(0);
  });

  test("rejects a MALFORMED disclosure binding at the strict decode boundary", async ({
    page,
  }) => {
    const probe = observe(page);
    await connect(page, probe, "malformed");

    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(0);
    const walk = probe.calls(METHOD)[0]!;
    await probe.settled(walk);
    // Structural rejection, not a Core refusal: a non-integer epoch is invalid,
    // so no disclosure may render.
    await expect(disclosure(page)).toHaveCount(0);
    await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  });

  test("transitions healthy -> refused across a transport reconnect on the SAME record", async ({
    page,
    request,
  }) => {
    const probe = observe(page);
    const s = await connect(page, probe, "");
    await expect(disclosure(page)).toHaveCount(1);
    const before = probe.calls(METHOD).length;

    // Flip the SAME session to refused, then force a reconnect so the record
    // re-walks. The previously-complete inventory must collapse to non-complete
    // and the NEW walk must carry the typed refusal.
    await driverControl(request, "refuse", s.sessionId);
    await forceReconnect(request);
    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(before);
    const walk = probe.calls(METHOD).at(-1)!;
    await probe.settled(walk);
    const reply = probe.replyTo(walk)!;
    expect(reply.errorCode).toBe(-32_041);
    expect(reply.refusalKind).toBe("driver_scope_mismatch");
    await expect(disclosure(page)).toHaveCount(0);
  });

  test("transitions malformed -> healthy across a transport reconnect on the SAME record", async ({
    page,
    request,
  }) => {
    const probe = observe(page);
    const s = await connect(page, probe, "");
    await expect(disclosure(page)).toHaveCount(1);

    // Damage the SAME record's binding, then reconnect: the strict decoder
    // rejects the malformed binding and the disclosure collapses.
    await driverControl(request, "malform", s.sessionId);
    const before = probe.calls(METHOD).length;
    await forceReconnect(request);
    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(before);
    await expect(disclosure(page)).toHaveCount(0);

    // Undo the damage and reconnect once more: the record recovers to healthy
    // and the disclosure re-mounts with its exact synthetic id.
    await driverControl(request, "allow", s.sessionId);
    const recovered = probe.calls(METHOD).length;
    await forceReconnect(request);
    await expect
      .poll(() => probe.calls(METHOD).length)
      .toBeGreaterThan(recovered);
    await expect(disclosure(page)).toHaveCount(1);
    await expect(factRow(page, "Driver")).toContainText(
      `synthetic-driver-${s.sessionId}`,
    );
  });

  // ---------------------------------------------------------------- group 5
  test("observes a deterministic discovery request: one walk, real params, terminal page", async ({
    page,
  }) => {
    const probe = observe(page);
    const s = await connect(page, probe, "");

    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(0);
    const walk = probe.calls(METHOD)[0]!;
    expect(walk.sessionId).toBe(s.sessionId);
    expect(walk.operationsRequested).toBe(true);
    await probe.settled(walk);
    const reply = probe.replyTo(walk)!;
    expect(reply.mode).toBe("external");
    expect(reply.recovery).toBe("none");
    expect(reply.epoch).toBe(7);
    expect(reply.revision).toBe(42);
    expect(reply.leaseExpiresAtMs).toBe(0);
    // The observation retains no payload: only the projected counts above.
    expect(reply.opsItemCount).toBe(0);
  });
});
