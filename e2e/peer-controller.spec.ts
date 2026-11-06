import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  COMPOSER_PLACEHOLDER,
  FIXTURE_ORIGIN,
  connectAndStartWorkspace,
  runFolder,
} from "./fixture-session.ts";

/**
 * e2e — the FLEET VIEW (product navigation "Fleet"; WEB-UX-DESIGN-4000 §4.3,
 * migrated from the removed control-bar console by grant UX4-4020):
 * navigate -> Start form (model + brief -> ONE dispatch) -> adopted row ->
 * Steer/Approve/Deny/Stop from the row -> typed refusals -> seat latch in the
 * pane's Advanced. SAME semantics as the retired console spec: one frame per
 * activation, bounded refusal copy, no protocol vocabulary.
 *
 * SURFACES (all real hooks; no test bridges):
 *   • Fleet entry: sidebar footer button `data-fleet-nav="entry"`
 *     (ProductSidebar.tsx:780; App mounts FleetView when fleetRouteActive).
 *   • Start form: `data-fleet-form="start"`, `data-fleet-field="model"|"brief"`,
 *     `data-fleet-action="start"` (FleetView.tsx:166-214). Start is the ONLY
 *     implicit acquisition (§4.3): it acquires, then dispatches once.
 *   • Rows: `data-fleet-row="<slug>"` + `data-fleet-status` + actions
 *     `data-fleet-action="approve|deny|steer|stop"` (:394-440); Steer text is
 *     the row's OWN `data-fleet-field="steer-<slug>"` input.
 *   • The old per-chat console survives ONLY behind Fleet's Advanced
 *     disclosure (`aria-expanded`, :296-331) — asserted as the protocol
 *     console, never a default view.
 *
 * The fixture is the opt-in `peer-control-*` family in
 * `apps/web/scripts/mock-ui-server.mjs` (plan 0810 §1-§3): the workspace
 * suffix encodes the variant (default | refused | stale | duplicate |
 * no-method | no-feature | no-fleet); any other suffix is the default, and
 * `/__test__/peer-control/variant` overrides it per Session.
 *
 * Each chain runs in a folder of its own run (`fleetFolder`), so a retry or
 * `--repeat-each` never meets an earlier run's Sessions or rows (T-0435).
 *
 * CONSOLE-STATE CONTRACT (read, not assumed): a `peer/dispatch` refusal is a
 * typed JSON-RPC ERROR `data.kind` rendered through the Advanced panel's
 * bounded `data-controller-state="refused"` row (`data-refusal-kind`); a
 * dispatch NEVER renders a receipt row on the seat's control axis. Fleet rows
 * render status WORDS (Requested/Starting/Working/…), never slugs-as-identity:
 * the row label is "Peer N · <model>" (fleet-model.ts:351).
 */

/** Workspace NAME prefix; full path is `/srv/work/peer-control-<variant>`. */
const WORKSPACE_PREFIX = "peer-control-";
/** The two lane keys the mock advertises (mock-ui-server.mjs:167-198). */
const LANE_KEYS: readonly string[] = ["lane-primary", "lane-review"];
/** The lane the operator picks on the happy path. */
const CHOSEN_LANE = LANE_KEYS[0] as string;
/** Wire methods owned by the console (external-driver.ts). */
const CONTROL_METHOD = "peer/control";
const DISPATCH_METHOD = "peer/dispatch";
const ACQUIRE_METHOD = "session/driver/acquire";
/** The mock's FIXED adopted peer turn a dispatch receipt reports
 *  (`PEER_DISPATCH_ADOPTED_TURN_ID`, mock-ui-server.mjs:157). The row targets
 *  THIS turn, never the master/staging turn. */
const ADOPTED_TURN_ID = "00000000-0000-4000-8000-0000000000d1";
/** Bounded §6 refusal copy (peer-*-commands.ts label tables). */
const FENCE_STALE = "Your control of this session expired";
const DISPATCH_MODEL_UNAVAILABLE =
  "That model is not configured on this server";
/** The raw server detail the bounded label must NOT leak (mock :2564/:2620). */
const RAW_STALE_COPY = "fixture fence stale";
const RAW_DISPATCH_COPY = "driver operation refused: peer/dispatch";

// ---------------------------------------------------------------------------
// Locators — attribute CSS only where class names are CSS-module hashed.
// ---------------------------------------------------------------------------
const productNavigation = (page: Page): Locator => page.locator("aside");
const composer = (page: Page): Locator =>
  page.getByPlaceholder(COMPOSER_PLACEHOLDER);
/** The sidebar's Fleet footer entry (ProductSidebar.tsx:780). */
const fleetEntry = (page: Page): Locator =>
  productNavigation(page).locator('[data-fleet-nav="entry"]');
/** The Fleet surface (FleetView.tsx:161). */
const fleet = (page: Page): Locator =>
  // Round-2 routing (judge #1) mounts Fleet inside the routed pane wrapper
  // (`div.conversation.fleet-pane`, App.tsx) — a PLAIN div, so the labelled
  // region is now the FleetView root alone. The Start-form filter stays: it
  // pins the surface that owns the form rather than any labelled ancestor.
  page
    .locator('section[aria-label="Fleet"]')
    .filter({ has: page.locator('[data-fleet-form="start"]') });
const fleetModel = (page: Page): Locator =>
  fleet(page).locator('[data-fleet-field="model"]');
const fleetBrief = (page: Page): Locator =>
  fleet(page).locator('[data-fleet-field="brief"]');
const fleetStart = (page: Page): Locator =>
  fleet(page).locator('[data-fleet-action="start"]');
const fleetRows = (page: Page): Locator =>
  fleet(page).locator("[data-fleet-row]");
const fleetRow = (page: Page, slug: string): Locator =>
  fleet(page).locator(`[data-fleet-row="${slug}"]`);
const fleetAction = (page: Page, slug: string, action: string): Locator =>
  fleetRow(page, slug).locator(`[data-fleet-action="${action}"]`);
/** §4.3: the row's OWN inline steer text (`data-fleet-field="steer-<slug>"`). */
const fleetSteerInput = (page: Page, slug: string): Locator =>
  fleetRow(page, slug).locator(`[data-fleet-field="steer-${slug}"]`);
/** The Fleet footer's Advanced disclosure — the protocol console's ONLY home.
 *  Round 4 C3 made it a compact NATIVE <details>/<summary> (FleetView.tsx),
 *  so the activation target is the summary, not an aria-expanded button; the
 *  per-row Finished buckets keep the button form and are NOT this control. */
const fleetAdvanced = (page: Page): Locator =>
  fleet(page).locator('summary[data-fleet-advanced-summary="true"]');
const advancedConsole = (page: Page): Locator =>
  fleet(page).locator('[data-control-panel="peer-controller"]');

// ---------------------------------------------------------------------------
// Wire observation — allowlisted projection only (no payloads, no tokens).
// ---------------------------------------------------------------------------
interface SentFrame {
  readonly method: string | null;
  /** The frame's own `session_id`, when it carries one. */
  readonly sessionId: string | null;
  /** `peer/dispatch` lane key, or the `peer/control` command kind. */
  readonly detail: string | null;
  readonly operationId: string | null;
  /** `peer/control` steer's first text input, trimmed by the product. */
  readonly steerText: string | null;
  /** `peer/control`'s `expected_turn_id` (the ADOPTED peer turn). */
  readonly expectedTurnId: string | null;
  /** `session/driver/release`'s `next` mode (the §5.2 hand-back fact). */
  readonly releaseNext: string | null;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
/** Project ONE outbound frame: method + the relevant lane key / command kind. */
function projectSent(raw: unknown): SentFrame | null {
  const frame = asRecord(raw);
  if (frame === null) return null;
  const params = asRecord(frame.params);
  const command = asRecord(params?.command);
  // A `steer` command's ordered text inputs (`{kind:"text", text}` rows).
  const steerInput = command?.input;
  const steerFirst =
    Array.isArray(steerInput) && steerInput.length > 0
      ? asRecord(steerInput[0])
      : null;
  return {
    method: asString(frame.method),
    sessionId: asString(params?.session_id),
    detail: asString(params?.model) ?? asString(command?.kind),
    operationId: asString(params?.operation_id),
    steerText: asString(steerFirst?.text),
    expectedTurnId: asString(params?.expected_turn_id),
    releaseNext: asString(params?.next),
  };
}
function wire(page: Page) {
  const sent: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      try {
        const frame = projectSent(JSON.parse(String(payload)) as unknown);
        if (frame) sent.push(frame);
      } catch {
        // Non-JSON frames are not this surface's; ignore.
      }
    });
  });
  return {
    sent,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
  };
}

/**
 * Connect AND start a `peer-control-*` workspace — the shared helper. The
 * composer does not exist until a Session is open ("Choose a workspace"
 * region), so Add workspace -> Add & Start must run first.
 */
/** Open Fleet through the sidebar entry (§3: Sessions · Fleet · Settings). */
async function openFleet(page: Page): Promise<void> {
  await expect(fleetEntry(page)).toBeVisible();
  await fleetEntry(page).press("Enter");
  await expect(fleet(page)).toBeVisible();
}

/**
 * Start ONE peer through Fleet's OWN form — a REAL `selectOption` on the model
 * picker plus keystrokes in Brief (§4.3: Start is the only implicit
 * acquisition, and it dispatches once with a minted operation id).
 */
async function startPeer(
  page: Page,
  lane: string = CHOSEN_LANE,
): Promise<void> {
  await expect(fleetModel(page)).toBeEnabled();
  await fleetModel(page).selectOption(lane);
  await fleetBrief(page).fill("Fleet start brief\nsecond line is the detail");
  await expect(fleetStart(page)).toBeEnabled();
  await fleetStart(page).press("Enter");
}

/** The slug of THE adopted fleet row, read from Fleet's own DOM. */
async function adoptedRowSlug(page: Page): Promise<string> {
  await expect(fleetRows(page)).toHaveCount(1);
  const slug = await fleetRows(page).getAttribute("data-fleet-row");
  expect(slug).toBeTruthy();
  return slug as string;
}

/** A default-variant `peer-control-*` folder owned by this test run. */
const fleetFolder = (name: string): string =>
  runFolder(`${WORKSPACE_PREFIX}${name}`);

/** The master Session this page opened first, from its own `session/open`. */
function masterSession(w: ReturnType<typeof wire>): string {
  const master = w.sent.find(
    (frame) => frame.method === "session/open" && frame.sessionId !== null,
  )?.sessionId;
  expect(master).toBeTruthy();
  return master as string;
}

test.describe("Fleet view (migrated console semantics)", () => {
  const cwd = (variant: string) => `/srv/work/${WORKSPACE_PREFIX}${variant}`;

  // -------------------------------------------------- navigation + lanes
  test("Fleet opens with only the advertised lanes, keeps the console behind Advanced, and every way out leaves it", async ({
    page,
  }) => {
    const w = wire(page);
    const folder = fleetFolder("fleet-nav");
    const name = folder.split("/").pop() as string;
    await connectAndStartWorkspace(page, folder);
    const sidebar = productNavigation(page);
    const master = await sidebar
      .locator('[role="treeitem"][aria-current="page"]')
      .getAttribute("data-session-id");
    expect(master).toBeTruthy();

    await openFleet(page);
    // The picker shows exactly the advertised lane keys — the ONLY lane source,
    // so an unknown lane cannot be chosen.
    await expect(fleetModel(page)).toBeEnabled();
    await expect(fleetModel(page).locator("option:not([hidden])")).toHaveText([
      ...LANE_KEYS,
    ]);
    // Empty state renders before any dispatch; no frames were sent.
    await expect(
      fleet(page).locator('[data-fleet-empty="true"]'),
    ).toBeVisible();
    expect(w.calls(DISPATCH_METHOD)).toHaveLength(0);
    expect(w.calls(ACQUIRE_METHOD)).toHaveLength(0);

    // The protocol console exists ONLY behind the Advanced disclosure. Class
    // names are hashed; the console carries its data-control-panel hook.
    await expect(advancedConsole(page)).toHaveCount(0);
    await expect(fleetAdvanced(page)).toHaveCount(1);
    await fleetAdvanced(page).press("Enter");
    await expect(advancedConsole(page)).toBeVisible();

    // Settings leaves Fleet, and Fleet can be reopened afterwards.
    await sidebar
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(fleet(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await openFleet(page);

    // New Session leaves Fleet and opens the conversation.
    await sidebar
      .locator(`[role="treeitem"][aria-label=${JSON.stringify(name)}]`)
      .getByRole("button", { name, exact: true })
      .hover();
    await sidebar
      .getByRole("button", { name: `New session in ${name}` })
      .click();
    await expect(composer(page)).toBeEnabled();
    await expect(fleet(page)).toBeHidden();
    await expect(
      sidebar.locator('[role="treeitem"][data-session-id]'),
    ).toHaveCount(2);

    // Selecting a Session in the sidebar leaves Fleet, and browser Back does
    // not bring it back.
    await openFleet(page);
    await sidebar
      .locator(`[role="treeitem"][data-session-id=${JSON.stringify(master)}]`)
      .click();
    await expect(page.locator("section.conversation")).toBeVisible();
    await expect(composer(page)).toBeEnabled();
    await expect(fleet(page)).toBeHidden();
    await page.goBack();
    await expect(fleet(page)).toBeHidden();
  });

  test("unsupported Fleet capability disables the entry and explains why", async ({
    page,
  }) => {
    await connectAndStartWorkspace(page, cwd("no-fleet"));
    await expect(fleetEntry(page)).toBeDisabled();
    await expect(
      productNavigation(page).getByText(
        "Current server does not support Fleet yet",
      ),
    ).toBeVisible();
  });

  test("Fleet empty state stays top-aligned on desktop and mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    const dynamicSession = fleet(page)
      .locator("label")
      .filter({ hasText: "Session" })
      .locator("select");
    const back = page.locator(".fleet-back");
    expect((await back.boundingBox())!.width).toBeLessThanOrEqual(80);
    await expect(page.locator(".fleet-pane")).toHaveScreenshot(
      "fleet-empty-desktop.png",
      { mask: [dynamicSession] },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await back.boundingBox())!.width).toBeLessThanOrEqual(80);
    await expect(page.locator(".fleet-pane")).toHaveScreenshot(
      "fleet-empty-mobile.png",
      { mask: [dynamicSession] },
    );
  });

  // ------------------------------------- Start -> adopted row -> row actions
  test("Start opens only with model and brief, dispatches once per Start, and the row's Steer, Approve and Stop each send one frame", async ({
    page,
    request,
  }) => {
    await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
    const w = wire(page);
    await connectAndStartWorkspace(page, fleetFolder("fleet-start"));
    await openFleet(page);

    // The Start gate: a model AND a brief; clearing the brief closes it again.
    await expect(fleetStart(page)).toBeDisabled();
    await fleetModel(page).selectOption(CHOSEN_LANE);
    await expect(fleetStart(page)).toBeDisabled();
    await fleetBrief(page).fill("gate brief");
    await expect(fleetStart(page)).toBeEnabled();
    await fleetBrief(page).fill("");
    await expect(fleetStart(page)).toBeDisabled();

    // §4.3 wire order: acquire FIRST, then exactly one dispatch.
    await startPeer(page);
    await expect
      .poll(() => w.calls(ACQUIRE_METHOD).length)
      .toBeGreaterThanOrEqual(1);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(1);
    const acquireIndex = w.sent.findIndex(
      (frame) => frame.method === ACQUIRE_METHOD,
    );
    const dispatchIndex = w.sent.findIndex(
      (frame) => frame.method === DISPATCH_METHOD,
    );
    expect(acquireIndex).toBeGreaterThanOrEqual(0);
    expect(dispatchIndex).toBeGreaterThan(acquireIndex);
    const first = w.calls(DISPATCH_METHOD)[0];
    expect(first?.detail).toBe(CHOSEN_LANE);
    expect(first?.operationId).toBeTruthy();

    // The accepted dispatch stages the adopted peer Session, so a row renders,
    // named "Peer N" — never a raw slug as identity (§4.3).
    const slug = await adoptedRowSlug(page);
    await expect(fleetRow(page, slug)).toHaveAttribute(
      "aria-label",
      /^Peer \d+, /,
    );

    // Steer: a blank row draft fails closed; the frame carries the OPERATOR's
    // text and targets the ADOPTED turn.
    let before = w.calls(CONTROL_METHOD).length;
    const steer = fleetAction(page, slug, "steer");
    await expect(steer).toBeDisabled();
    await fleetSteerInput(page, slug).fill("octopus");
    await expect(steer).toBeEnabled();
    await steer.press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    const steered = w.calls(CONTROL_METHOD)[before];
    expect(steered?.detail).toBe("steer");
    expect(steered?.steerText).toBe("octopus");
    expect(steered?.expectedTurnId).toBe(ADOPTED_TURN_ID);

    // §4.4 / Round 4 C5: Approve is offered only while the row actually waits
    // for an approval. The root composer cannot raise one: Start's acquire
    // holds the external fence, so the fixture emits the peer's OWN
    // `turn/started` + `approval/requested` on the same owner socket.
    await expect(fleetAction(page, slug, "approve")).toHaveCount(0);
    const master = masterSession(w);
    const drive = async (kind: string) => {
      const response = await request.post(
        `${FIXTURE_ORIGIN}/__test__/peer-control/peer-activity?session_id=${encodeURIComponent(
          master,
        )}&kind=${kind}&slug=${encodeURIComponent(slug)}`,
      );
      expect(response.status()).toBe(204);
    };
    await drive("turn");
    await drive("approval");
    // The row settles once the coordinator has attributed the peer's own
    // approval, which can outlast the default 5 s budget.
    await expect(fleetRow(page, slug)).toHaveAttribute(
      "data-fleet-status",
      "Waiting for your approval",
      { timeout: 20_000 },
    );
    before = w.calls(CONTROL_METHOD).length;
    await fleetAction(page, slug, "approve").press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    expect(w.calls(CONTROL_METHOD)[before]?.detail).toBe("approval_respond");

    // Stop sends one interrupt.
    before = w.calls(CONTROL_METHOD).length;
    await fleetAction(page, slug, "stop").press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    expect(w.calls(CONTROL_METHOD)[before]?.detail).toBe("interrupt");

    // A second Start mints a DISTINCT operation id (no accidental replay).
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(2);
    const second = w.calls(DISPATCH_METHOD)[1]?.operationId;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first?.operationId);
  });

  // --------------------------------------------------------- refusals
  test("a refused dispatch shows its bounded label, never server copy: a stale lease, then after a reload an unconfigured model", async ({
    page,
    request,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, fleetFolder("fleet-refusals"));
    const master = masterSession(w);
    const variant = async (name: string) => {
      const response = await request.post(
        `${FIXTURE_ORIGIN}/__test__/peer-control/variant?session_id=${encodeURIComponent(
          master,
        )}&variant=${name}`,
      );
      expect(response.status()).toBe(204);
    };

    // This Session's lease is stale: the dispatch is refused with the typed
    // `driver_fence_stale`, rendered through the §6 label on the row.
    await variant("stale");
    await openFleet(page);
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(1);
    await expect(fleet(page)).toContainText(FENCE_STALE);
    await expect(fleet(page)).not.toContainText(RAW_STALE_COPY);
    await expect(fleet(page)).not.toContainText(RAW_DISPATCH_COPY);

    // The operator reloads and tries again; now the lane's model is not
    // configured on the server (`driver_model_unavailable`).
    await variant("refused");
    await page.reload();
    await expect(composer(page)).toBeEnabled();
    await openFleet(page);
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(2);
    await expect(fleet(page)).toContainText(DISPATCH_MODEL_UNAVAILABLE);
    await expect(fleet(page)).not.toContainText(RAW_DISPATCH_COPY);
    await expect(fleet(page)).not.toContainText("-32602");
    await expect(fleet(page)).not.toContainText("payload_digest");
  });
});
