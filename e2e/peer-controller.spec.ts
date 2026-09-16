import { expect, test, type Locator, type Page } from "@playwright/test";

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
 * no-method | no-feature).
 *
 * CONSOLE-STATE CONTRACT (read, not assumed): a `peer/dispatch` refusal is a
 * typed JSON-RPC ERROR `data.kind` rendered through the Advanced panel's
 * bounded `data-controller-state="refused"` row (`data-refusal-kind`); a
 * dispatch NEVER renders a receipt row on the seat's control axis. Fleet rows
 * render status WORDS (Requested/Starting/Working/…), never slugs-as-identity:
 * the row label is "Peer N · <model>" (fleet-model.ts:351).
 */

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "tab-scoped-e2e-token";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
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
async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(TOKEN);
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .press("Enter");
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).press("Enter");
  }
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .press("Enter");
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
}

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

/** The slug of the adopted fleet row, read from Fleet's own DOM. */
async function adoptedRowSlug(page: Page): Promise<string> {
  const first = fleetRows(page).first();
  await expect(first).toBeVisible();
  const slug = await first.getAttribute("data-fleet-row");
  expect(slug).toBeTruthy();
  return slug as string;
}

test.describe("Fleet view (migrated console semantics)", () => {
  const cwd = (variant: string) => `/srv/work/${WORKSPACE_PREFIX}${variant}`;

  // --------------------------------------------------- navigation + lanes
  test("Fleet opens from the navigation footer and lists the mock's 2 lanes", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    // The picker shows exactly the advertised lane keys — the ONLY lane source.
    await expect(fleetModel(page)).toBeEnabled();
    const options = await fleetModel(page)
      .locator("option:not([hidden])")
      .allTextContents();
    expect(options).toEqual([...LANE_KEYS]);
    // Empty state renders before any dispatch; no frames were sent.
    await expect(
      fleet(page).locator('[data-fleet-empty="true"]'),
    ).toBeVisible();
    expect(w.calls(DISPATCH_METHOD)).toHaveLength(0);
    expect(w.calls(ACQUIRE_METHOD)).toHaveLength(0);
  });

  // ------------------------------------------ the Start gate (3-way)
  test("Start stays disabled until a model is chosen and a brief is typed", async ({
    page,
  }) => {
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await expect(fleetStart(page)).toBeDisabled();
    await fleetModel(page).selectOption(CHOSEN_LANE);
    await expect(fleetStart(page)).toBeDisabled();
    await fleetBrief(page).fill("gate brief");
    await expect(fleetStart(page)).toBeEnabled();
    // Clearing the brief closes the gate again.
    await fleetBrief(page).fill("");
    await expect(fleetStart(page)).toBeDisabled();
  });

  // ------------------------------------------------ start -> adopted row
  test("Start acquires then emits exactly ONE peer/dispatch and adopts a Fleet row", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await startPeer(page);
    // §4.3 wire order: acquire FIRST, then exactly one dispatch.
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
    const frame = w.calls(DISPATCH_METHOD)[0];
    expect(frame?.detail).toBe(CHOSEN_LANE);
    expect(frame?.operationId).toBeTruthy();
    // The accepted dispatch stages the adopted peer Session, so a row renders.
    const slug = await adoptedRowSlug(page);
    // §4.3 row identity: "Peer N" numbering, never a raw slug as the label.
    const label = fleetRow(page, slug).locator("span").first();
    await expect(label).toContainText(/^Peer \d+$/);
  });

  test("a second Start mints a DISTINCT operation id (no accidental replay)", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(1);
    const first = w.calls(DISPATCH_METHOD)[0]?.operationId;
    expect(first).toBeTruthy();
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(2);
    const second = w.calls(DISPATCH_METHOD)[1]?.operationId;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  // -------------------------------------------- control from Fleet rows
  test("Steer from the row emits exactly ONE peer/control steer frame", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await startPeer(page);
    const slug = await adoptedRowSlug(page);

    const before = w.calls(CONTROL_METHOD).length;
    const steer = fleetAction(page, slug, "steer");
    // §4.3: a blank row draft fails closed — Steer is disabled until typed.
    await expect(steer).toBeDisabled();
    await fleetSteerInput(page, slug).fill("octopus");
    await expect(steer).toBeEnabled();
    await steer.press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    const frame = w.calls(CONTROL_METHOD)[before];
    expect(frame?.detail).toBe("steer");
    // The frame carries the OPERATOR's text and targets the ADOPTED turn.
    expect(frame?.steerText).toBe("octopus");
    expect(frame?.expectedTurnId).toBe(ADOPTED_TURN_ID);
  });

  test("Approve from the row emits exactly ONE approval_respond frame", async ({
    page,
    request,
  }) => {
    // The fixture's staged-peer map is process-global and every Start in this
    // file adopts the SAME synthetic slug, so clear it first: the activity
    // frames below must reach THIS test's peer Session, not an earlier one's.
    await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await startPeer(page);
    const slug = await adoptedRowSlug(page);

    // §4.4 / Round 4 C5: Approve is a FAIL-CLOSED affordance — it is offered
    // only while that row is actually waiting for an approval, so a Working /
    // Starting row exposes no Approve control at all.
    await expect(fleetAction(page, slug, "approve")).toHaveCount(0);
    // Raise a REAL pending approval on the adopted peer's OWN Session. The
    // root composer cannot: Start's acquire holds the external fence, so the
    // Core refuses `turn/start` with ExternalMasterHeld
    // (mock-ui-server.mjs turn/start gate) — the fixture hook emits the peer's
    // own `turn/started` + `approval/requested` on the same owner socket.
    const master = w.sent.find(
      (frame) => frame.method === "session/open" && frame.sessionId !== null,
    )?.sessionId;
    expect(master).toBeTruthy();
    const drive = async (kind: string) => {
      const response = await request.post(
        `${FIXTURE_ORIGIN}/__test__/peer-control/peer-activity?session_id=${encodeURIComponent(
          master as string,
        )}&kind=${kind}&slug=${encodeURIComponent(slug)}`,
      );
      expect(response.status()).toBe(204);
    };
    await drive("turn");
    await drive("approval");
    // The peer's own approval rides its own Session; the row settles once the
    // coordinator has attributed it, which can outlast the default 5 s budget.
    await expect(fleetRow(page, slug)).toHaveAttribute(
      "data-fleet-status",
      "Waiting for your approval",
      { timeout: 20_000 },
    );

    const before = w.calls(CONTROL_METHOD).length;
    await fleetAction(page, slug, "approve").press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    expect(w.calls(CONTROL_METHOD)[before]?.detail).toBe("approval_respond");
  });

  test("Stop from the row emits exactly ONE interrupt frame", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    await startPeer(page);
    const slug = await adoptedRowSlug(page);

    const before = w.calls(CONTROL_METHOD).length;
    await fleetAction(page, slug, "stop").press("Enter");
    await expect.poll(() => w.calls(CONTROL_METHOD).length).toBe(before + 1);
    expect(w.calls(CONTROL_METHOD)[before]?.detail).toBe("interrupt");
  });

  // --------------------------------------------------------- refusals
  test("a stale lease refuses peer/dispatch with the bounded §6 label", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd("stale"));
    await openFleet(page);
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(1);
    // §6 copy renders inline on the ROW (a refused receipt shows the recovery
    // copy on the row, §4.3); the raw server detail never leaks.
    await expect(fleet(page)).toContainText(FENCE_STALE);
    await expect(fleet(page)).not.toContainText(RAW_STALE_COPY);
    await expect(fleet(page)).not.toContainText(RAW_DISPATCH_COPY);
  });

  test("a refused peer/dispatch renders the bounded label, never server copy", async ({
    page,
  }) => {
    const w = wire(page);
    await connectAndStartWorkspace(page, cwd("refused"));
    await openFleet(page);
    await startPeer(page);
    await expect.poll(() => w.calls(DISPATCH_METHOD).length).toBe(1);
    await expect(fleet(page)).toContainText(DISPATCH_MODEL_UNAVAILABLE);
    await expect(fleet(page)).not.toContainText(RAW_DISPATCH_COPY);
    await expect(fleet(page)).not.toContainText("-32602");
    await expect(fleet(page)).not.toContainText("payload_digest");
  });

  // ------------------------------ protocol console stays behind Advanced
  test("the protocol console renders ONLY behind Fleet's Advanced disclosure", async ({
    page,
  }) => {
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    // Default view: NO protocol surface. Class names are hashed; the console
    // carries its data-control-panel hook wherever it mounts.
    await expect(advancedConsole(page)).toHaveCount(0);
    await fleetAdvanced(page).first().press("Enter");
    await expect(advancedConsole(page)).toBeVisible();
  });

  // ------------------------------------------------------------ invariants
  test("an unknown lane is unconstructible: the picker is the ONLY lane source", async ({
    page,
  }) => {
    await connectAndStartWorkspace(page, cwd(""));
    await openFleet(page);
    // Lane keys arrive asynchronously; wait for the picker to list them.
    await expect
      .poll(
        async () =>
          await fleetModel(page).locator("option:not([hidden])").count(),
      )
      .toBeGreaterThan(0);
    const options = await fleetModel(page)
      .locator("option:not([hidden])")
      .allTextContents();
    for (const option of options) expect(LANE_KEYS).toContain(option);
  });
});
