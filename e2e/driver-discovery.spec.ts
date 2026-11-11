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
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { disconnect } from "./fixture-controls";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import {
  closeSessionController,
  openSessionController,
} from "./session-settings.ts";
import {
  composer,
  newSessionIn,
  productNavigation,
  selectedSessionId,
  selectSession,
} from "./sessions";
import { observeFrames } from "./turn-observers";

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
function isControlOrModel(method: string | undefined): boolean {
  if (method === undefined) return false;
  return (
    FORBIDDEN_DURING_DISCLOSURE.has(method) || method.startsWith("profile/llm/")
  );
}

type Probe = ReturnType<typeof observeFrames>;

function disclosure(page: Page) {
  return page.locator('[data-control-disclosure="driver"]');
}
/** The rendered fact row whose <dt> is exactly `label` (Driver/Epoch/...). */
function factRow(page: Page, label: string) {
  return disclosure(page).locator("dl > div").filter({ hasText: label });
}

/** Switch selection back to a previously opened Session by its sidebar title. */
async function returnTo(page: Page, title: string) {
  await closeSessionController(page);
  await selectSession(productNavigation(page), title);
  await expect(composer(page)).toBeEnabled();
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
  await connectAndStartWorkspace(page, `/srv/work/${workspace}`);
  await expect
    .poll(() => probe.calls("session/open").length)
    .toBeGreaterThan(0);
  const sessionId = probe.calls("session/open").at(-1)!.params?.session_id;
  if (typeof sessionId !== "string")
    throw new Error("Expected a full Session ID");
  const title = await selectedSessionId(productNavigation(page));
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
  await newSessionIn(productNavigation(page), workspace);
  await expect.poll(() => probe.calls("session/open").length).toBe(opens + 1);
  await expect(composer(page)).toBeEnabled();
  const sessionId = probe.calls("session/open").at(-1)!.params?.session_id;
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
    (
      await request.post(`${FIXTURE_ORIGIN}/__test__/driver/${action}?${query}`)
    ).status(),
  ).toBe(204);
}

async function heldDriver(
  request: APIRequestContext,
  sessionId: string,
): Promise<{ held: string[]; armed: string[] }> {
  const response = await request.get(
    `${FIXTURE_ORIGIN}/__test__/driver/state?${new URLSearchParams({ session_id: sessionId })}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as { held: string[]; armed: string[] };
}

test.describe("external driver discovery (synthetic fixture)", () => {
  // GLOBAL teardown after EVERY test, pass or fail: clears every driver hold,
  // the WORKSPACE-keyed delay arm, and both session-keyed flips. Without this
  // the delay arm would bleed into the next test.
  test.afterEach(async ({ request }) => {
    await request.post(`${FIXTURE_ORIGIN}/__test__/driver/reset-all`);
  });

  // ---------------------------------------------------------------- group 1
  test("renders a healthy EXTERNAL disclosure from the real empty terminal operations page", async ({
    page,
  }) => {
    const probe = observeFrames(page);
    const s = await connect(page, probe, "");

    // Exactly one discovery walk, and it requests a real operations page. The
    // walk ALWAYS sends `operations`; a reply without a valid terminal page
    // (items [], complete, next_cursor null) is UNSUPPORTED, not complete.
    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(0);
    const walk = probe.calls(METHOD)[0]!;
    // Exactly `session_id` + `operations`, no topic and no injected extra
    // argument.
    expect(walk.params?.session_id).toBe(s.sessionId);
    expect(Object.keys(walk.params ?? {}).sort()).toEqual([
      "operations",
      "session_id",
    ]);
    await probe.settled(walk);

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

  test("A/B: exact synthetic driver ID per selected Session; releasing held A never leaks into a selected B", async ({
    page,
    request,
  }) => {
    const probe = observeFrames(page);
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
    await returnTo(page, a.title);
    await expect(disclosure(page)).toHaveCount(1);
    await expect(factRow(page, "Driver")).toContainText(aId);
    await expect(factRow(page, "Driver")).not.toContainText(bId);
  });

  test("transitions healthy -> refused across a transport reconnect on the SAME record", async ({
    page,
    request,
  }) => {
    const probe = observeFrames(page);
    const s = await connect(page, probe, "");
    await expect(disclosure(page)).toHaveCount(1);
    const before = probe.calls(METHOD).length;

    // Flip the SAME session to refused, then force a reconnect so the record
    // re-walks. The previously-complete inventory must collapse to non-complete
    // and the NEW walk must carry the typed refusal.
    await driverControl(request, "refuse", s.sessionId);
    await disconnect(request);
    await expect.poll(() => probe.calls(METHOD).length).toBeGreaterThan(before);
    const walk = probe.calls(METHOD).at(-1)!;
    await probe.settled(walk);
    await expect(disclosure(page)).toHaveCount(0);
  });
});
