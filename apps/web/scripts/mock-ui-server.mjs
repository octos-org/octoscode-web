import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const port = Number.parseInt(process.env.OCTOSCODE_MOCK_PORT ?? "50080", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("OCTOSCODE_MOCK_PORT must be a valid TCP port");
}
let sockets;
// Canonical per-Session state. A Session is identified by its id alone; its
// profile/workspace scope, open transports, durable projection log, current
// and completed turns, and pending interaction all live here so one transport
// may multiplex many Sessions and every transport hydrates the same truth.
const sessionStateBySessionId = new Map();
function sessionState(sessionId) {
  let state = sessionStateBySessionId.get(sessionId);
  if (!state) {
    state = {
      sessionId,
      profileId: profileIdFromSessionId(sessionId) ?? defaultProfileId,
      workspaceRoot: null,
      sockets: new Set(),
      log: { events: [], seq: 0 },
      messages: [],
      startedTurnIds: new Set(),
      activeTurn: null, // { turnId, threadId, state, ownerSocket }
      completedTurns: [],
      interaction: null, // { kind, id, turnId, threadId, ownerSocket }
      permission: { mode: "workspace_write", network: "deny" },
      taskState: "running",
    };
    sessionStateBySessionId.set(sessionId, state);
  }
  return state;
}
const openedSessionsBySocket = new WeakMap();
const openedWorkspaceBySocket = new WeakMap();
const openedProfileBySocket = new WeakMap();
const authenticatedProfileBySocket = new WeakMap();
const rejectedSessionIds = new Set();
const delayedHydrateSockets = new WeakSet();
const forkedSessions = new Set();
const historyRefreshArmed = new Set();
const heldHistoryHydrates = new Map();
const gatherRepliesArmed = new Set();
const heldGatherReplies = new Map();
// WEB-WORKSPACE-BROWSER-CONTRACT-5000 — server-folder browsing. The feature is
// advertised ONLY to a connection presenting the browsing fixture token, so the
// same fixture exercises both halves of the gate: browse with this token, and
// the untouched typed-path form (no Browse affordance at all) with every other.
const workspaceBrowseAuthToken = "workspace-browse-e2e-token";
const workspaceBrowseSockets = new WeakSet();
// plan.todos.v1 — the agent's live checklist. `plan/updated` replaces the plan
// wholesale and its authoring turn's terminal clears it, so the plan fixture
// streams a SEQUENCE of replacements across one deliberately slow turn. A
// second token drops the feature (and the notification) from the envelope so
// the same server also serves the feature-absent case: no card at all.
const planFixtureAuthToken = "plan-fixture-e2e-token";
const planFixtureSockets = new WeakSet();
const planAbsentAuthToken = "plan-absent-e2e-token";
const planAbsentSockets = new WeakSet();
const PLAN_FEATURE = "plan.todos.v1";
const PLAN_NOTIFICATION = "plan/updated";
const PLAN_FIXTURE_PROMPT = "Plan fixture";
/** One ordered checklist per step; each step REPLACES the previous plan.
 *  Step 0 rides the turn; later steps are driven by /__test__/plan/advance so
 *  a spec observes each replacement instead of racing a timer. */
const PLAN_FIXTURE_STEPS = [
  {
    title: "Shipping the coding surface",
    items: [
      { id: "inspect", title: "Inspect the workspace", status: "in_progress" },
      { id: "change", title: "Implement the change", status: "pending" },
      {
        id: "verify",
        title: "Run product checks",
        status: "pending",
        priority: "P2",
      },
    ],
  },
  {
    // A wholesale replacement: one item drops out and a new one appears, so a
    // client that merged instead of replacing would show four rows here.
    title: "Shipping the coding surface",
    items: [
      { id: "inspect", title: "Inspect the workspace", status: "completed" },
      { id: "change", title: "Implement the change", status: "in_progress" },
      { id: "docs", title: "Update the changelog", status: "pending" },
    ],
  },
];
/** The most recent plan-fixture turn, and how far through the sequence it is. */
let planFixtureTurn = null;

function sendPlanStep(step) {
  const turn = planFixtureTurn;
  if (!turn || turn.socket.readyState !== WebSocket.OPEN) return false;
  turn.socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "plan/updated",
      params: {
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        plan: {
          title: step.title,
          updated_at_ms: Date.now(),
          items: step.items,
        },
      },
    }),
  );
  return true;
}
const WORKSPACE_BROWSE_METHODS = [
  "onboarding/workspace_list",
  "onboarding/workspace_create",
];
const WORKSPACE_BROWSE_FEATURE = "onboarding.workspace_browse.v1";
// The server's own working directory: `path: null` resolves here.
const workspaceBrowseWorkingDirectory = "/srv/fixture";
const workspaceBrowseHome = "/srv/fixture";
const workspaceBrowseBannedRoots = ["/etc", "/root", "/var/db"];
// A non-directory: listing it is not_a_directory, creating over it is
// exists_not_directory.
const workspaceBrowseFiles = new Set(["/srv/fixture/projects/README.md"]);
// A directory the fixture refuses to read, so the permission copy is reachable.
const workspaceBrowseUnreadable = new Set(["/srv/fixture/restricted"]);

function freshWorkspaceBrowseTree() {
  return new Map([
    ["/", { writable: false, dirs: ["srv"], hidden: 4, truncated: false }],
    [
      "/srv",
      { writable: false, dirs: ["fixture"], hidden: 1, truncated: false },
    ],
    [
      "/srv/fixture",
      {
        writable: true,
        dirs: ["Projects", "archive", "readonly", "restricted"],
        hidden: 2,
        truncated: false,
      },
    ],
    [
      "/srv/fixture/Projects",
      {
        writable: true,
        dirs: ["octoscode-web", "notes"],
        hidden: 0,
        truncated: false,
      },
    ],
    [
      "/srv/fixture/Projects/octoscode-web",
      { writable: true, dirs: [], hidden: 1, truncated: false },
    ],
    [
      "/srv/fixture/Projects/notes",
      { writable: true, dirs: [], hidden: 0, truncated: false },
    ],
    [
      "/srv/fixture/archive",
      { writable: false, dirs: ["2025"], hidden: 0, truncated: true },
    ],
    [
      "/srv/fixture/archive/2025",
      { writable: false, dirs: [], hidden: 0, truncated: false },
    ],
    [
      "/srv/fixture/readonly",
      { writable: false, dirs: [], hidden: 0, truncated: false },
    ],
    [
      "/srv/fixture/restricted",
      { writable: false, dirs: [], hidden: 0, truncated: false },
    ],
  ]);
}

let workspaceBrowseTree = freshWorkspaceBrowseTree();

function workspaceBrowseResolve(path) {
  if (path === null || path === undefined || path === "") {
    return { ok: true, path: workspaceBrowseWorkingDirectory };
  }
  if (typeof path !== "string") return { ok: false, kind: "invalid_path" };
  let candidate = path.trim();
  if (!candidate) return { ok: true, path: workspaceBrowseWorkingDirectory };
  if (candidate === "~") candidate = workspaceBrowseHome;
  else if (candidate.startsWith("~/")) {
    candidate = `${workspaceBrowseHome}/${candidate.slice(2)}`;
  }
  if (!candidate.startsWith("/")) return { ok: false, kind: "invalid_path" };
  if (candidate.includes("\u0000")) return { ok: false, kind: "invalid_path" };
  const normalized = candidate.replace(/\/+$/, "") || "/";
  const banned = workspaceBrowseBannedRoots.find(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
  if (banned) return { ok: false, kind: "root_escape", bannedRoot: banned };
  return { ok: true, path: normalized };
}

function workspaceBrowseParent(path) {
  if (path === "/") return null;
  const cut = path.lastIndexOf("/");
  const parent = cut === 0 ? "/" : path.slice(0, cut);
  const banned = workspaceBrowseBannedRoots.some(
    (root) => parent === root || parent.startsWith(`${root}/`),
  );
  return banned ? null : parent;
}

function workspaceBrowseJoin(parent, name) {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

// Native-workflow coverage is opt-in, keeping older capability-off tests intact.
// These controls only touch synthetic Sessions in the dedicated fixture path.
const nativeWorkspacePrefix = "/srv/work/native-workflows-";
const nativeMethods = new Set([
  "session/btw",
  "thread/graph/get",
  "turn/state/get",
  "approval/scopes/list",
  "turn/steer",
  "session/goal/get",
  "session/goal/set",
  "session/goal/clear",
  "loop/create",
  "loop/list",
  "loop/pause",
  "loop/resume",
  "loop/delete",
  "loop/fire_now",
  "monitor/create",
  "monitor/list",
  "monitor/pause",
  "monitor/resume",
  "monitor/delete",
  "agent/list",
  "agent/status/read",
  "agent/output/read",
  "agent/artifact/list",
  "agent/artifact/read",
  "agent/interrupt",
  "agent/close",
]);
const nativeHoldMethods = new Set([...nativeMethods, "session/hydrate"]);
const nativeHolds = new Map(); // sessionId -> Map(method -> null | captured reply)
// Mounted-driver discovery coverage is opt-in: only Sessions opened in a
// /srv/work/driver-discovery-* workspace negotiate session/driver/get. The
// fixture holds ONLY synthetic disclosure facts — never a real driver, lease,
// or Core authority. Variant is encoded by the workspace suffix.
const driverDiscoveryPrefix = "/srv/work/driver-discovery-";
const DRIVER_GET_METHOD = "session/driver/get";
const DRIVER_FEATURE = "external_driver_v1";
// Fixed synthetic stamps (no timestamps/randomness) so a held reply stays
// byte-identical across hold/release.
const DRIVER_EPOCH = 7;
const DRIVER_REVISION = 42;
const DRIVER_LEASE_EXPIRES_AT_MS = 1_770_000_000_000;
const driverHolds = new Map(); // sessionId -> Map(method -> null | captured reply)
// Workspaces whose FIRST discovery request was already held once, so a
// post-release re-walk replies normally instead of hanging again. Keyed by
// WORKSPACE, not Session: a sibling Session in the same `delay` workspace must
// still complete while exactly one record stays held.
const delayedDriverWorkspaces = new Set();
// Sessions explicitly flipped to a REFUSED reply (same typed refusal kind as
// the `refused` variant). Lets a test drive a healthy -> refused transition on
// the SAME record across a reconnect.
const refusedDriverSessions = new Set();
// Sessions explicitly flipped to a MALFORMED binding (strict decoder must
// reject). Lets a test drive a malformed -> healthy transition on the SAME
// record across a reconnect, mirroring `refusedDriverSessions`.
const malformedDriverSessions = new Set();
function isDriverState(state) {
  return state?.workspaceRoot?.startsWith(driverDiscoveryPrefix) === true;
}
/** Variant encoded by the workspace suffix (both | no-method | no-feature | ...). */
function driverVariant(state) {
  return (state?.workspaceRoot ?? "").slice(driverDiscoveryPrefix.length);
}
function driverAdverts(variant) {
  return {
    method: variant !== "no-method",
    feature: variant !== "no-feature",
  };
}
// peer/control + driver acquire coverage is opt-in: only Sessions opened in a
// /srv/work/peer-control-* workspace advertise `peer/control` (alongside the
// driver get/acquire/renew/release methods and external_driver_v1) and answer
// the matching RPCs. The fixture holds ONLY synthetic disclosure facts — never
// a real driver, lease, control token or Core authority. Variant is encoded by
// the workspace suffix (default=accepted | refused | stale | duplicate |
// no-method | no-feature), and may be overridden per Session by the test hook.
const peerControlPrefix = "/srv/work/peer-control-";
const PEER_CONTROL_METHOD = "peer/control";
const PEER_DISPATCH_METHOD = "peer/dispatch";
const SESSION_DRIVER_ACQUIRE = "session/driver/acquire";
const SESSION_DRIVER_RENEW = "session/driver/renew";
const SESSION_DRIVER_RELEASE = "session/driver/release";
const PEER_CONTROL_METHODS = [
  DRIVER_GET_METHOD,
  SESSION_DRIVER_ACQUIRE,
  SESSION_DRIVER_RENEW,
  SESSION_DRIVER_RELEASE,
  PEER_CONTROL_METHOD,
  PEER_DISPATCH_METHOD,
];
// Fixed synthetic proof/stamps (no randomness) so a replayed reply stays
// byte-identical across a reconnect.
const PEER_CONTROL_TOKEN = "synthetic-control-token";
const PEER_CONTROL_ACCEPTED_AT_MS = 1_770_000_000_000;
const PEER_CONTROL_DIGEST = "synthetic-payload-digest";
const PEER_CONTROL_SLUG = "synthetic-peer";
/** Fixed synthetic in-flight operation the acquire reports as PENDING work, so
 *  the seat's target identity resolves. `peerControlTargetFor` requires
 *  `pendingWork[0]`: a dispatching binding holds none, a fresh acquire has
 *  exactly one. A non-empty string, per the acquire decoder's contract. */
const PEER_CONTROL_PENDING_OP = "synthetic-pending-op";
/** Fixed synthetic LIVE turn (a valid protocol UUID) the fixture reports as
 *  `active` in hydrate, so the selected record's queue holds an active turn and
 *  the seat's `expectedTurnId` is real — the accepted receipt echoes it and the
 *  client re-validates it as a protocol UUID on the accepted path. */
const PEER_CONTROL_ACTIVE_TURN_ID = "00000000-0000-4000-8000-0000000000c1";
// Fixed synthetic adopted turn for a dispatch receipt (a valid protocol UUID so
// the strict leaf identity check `adoptedIdentityIsNativeShared` passes).
const PEER_DISPATCH_ADOPTED_TURN_ID = "00000000-0000-4000-8000-0000000000d1";
/** Sub-provider lane read, advertised ONLY on a `peer-control-*` workspace
 *  (contract §3: the profile's real sub_providers are the ONLY sanctioned lane
 *  source — never a hard-coded literal). */
const PEER_SUB_PROVIDERS_METHOD = "profile/sub_providers/list";
/** Lanes a `peer-control-*` workspace advertises. The KEYS are what
 *  `peer/dispatch` accepts; any other `model` refuses as
 *  `driver_model_unavailable` BEFORE any staging (Core ui_protocol.rs:654,
 *  field doc :7959). Shapes mirror `parseResearchLanes`
 *  (packages/client/src/research.ts:34-76) so the real client decodes them. */
const PEER_CONTROL_LANES = [
  {
    key: "lane-primary",
    provider: "openai",
    model: "gpt-5.4",
    api_key_env: "OPENAI_API_KEY",
    base_url: null,
    description: "Primary dispatch lane",
    default_context_window: 400_000,
    max_output_tokens: 128_000,
    api_type: "responses",
  },
  {
    key: "lane-review",
    provider: "anthropic",
    model: "claude-opus-4-1",
    api_key_env: "ANTHROPIC_API_KEY",
    base_url: null,
    description: "Secondary review lane",
    default_context_window: 200_000,
    max_output_tokens: 64_000,
    api_type: "messages",
  },
];
/** The LAST `session/driver/acquire` per Session: the fence (epoch + token)
 *  every later `peer/control` / `peer/dispatch` must present. A presented fence
 *  that does not match it is `driver_fence_stale` (Core ui_protocol.rs:645). */
const peerAcquires = new Map(); // sessionId -> { epoch, control_token }
/** The durable driver MODE per peer-control Session (UX4-4020): "external"
 *  until a `session/driver/release {next:"internal"}` hands the Session back.
 *  While external, `turn/start` is REFUSED with the Core's ExternalMasterHeld
 *  admission error — the real chat-handover contract, not a client-side guess. */
const peerDriverModes = new Map(); // sessionId -> "external" | "internal"
function peerDriverMode(sessionId) {
  return peerDriverModes.get(sessionId) ?? "external";
}
/** Durable accepted-dispatch records: operation_id -> { digest, receipt }.
 *  An equal retry (same id + same digest) returns the ORIGINAL immutable
 *  receipt with `duplicate:true`; a differing digest is
 *  `driver_operation_conflict` (Core ui_protocol.rs:660, field doc :7956). */
const peerDispatches = new Map(); // sessionId -> Map<operation_id, record>
/** Fence check for a state-changing driver call. Applies only once THIS
 *  Session has acquired: with no recorded acquire there is no "last acquire"
 *  to mismatch, so the legacy variant arms stay authoritative. */
function peerFenceStale(state, params) {
  const recorded = peerAcquires.get(state.sessionId);
  if (!recorded) return false;
  return (
    params?.epoch !== recorded.epoch ||
    params?.control_token !== recorded.control_token
  );
}
/** Canonical request digest. Deliberately EXCLUDES server-generated ids, which
 *  the receipt carries separately (Core `PeerDispatchResult` doc :8026-8028). */
function peerDispatchDigest(params) {
  return `synthetic-dispatch-digest-${JSON.stringify({
    model: params?.model ?? null,
    dispatch: params?.dispatch ?? null,
    goal_id: params?.goal_id ?? null,
    task_id: params?.task_id ?? null,
    kickoff_input: params?.kickoff_input ?? null,
  })}`;
}
function peerLaneKeys() {
  return PEER_CONTROL_LANES.map((lane) => lane.key);
}
function dispatchRecordsFor(state) {
  let records = peerDispatches.get(state.sessionId);
  if (!records) {
    records = new Map();
    peerDispatches.set(state.sessionId, records);
  }
  return records;
}
/** Register the adopted peer Session so the SAME dispatching socket can
 *  `session/open` `${base}#peer-${slug}` and the existing peer-activity
 *  triggers (`Peer <kind> fixture <slug>`) resolve the slug — the adopted row
 *  then goes live/blocked/done exactly as contract §2 describes. */
function stageDispatchedPeer(state, slug, masterSessionId, brief) {
  const base = String(state.sessionId).split("#")[0];
  const peerSessionId = `${base}#peer-${slug}`;
  stagedPeers.set(peerSessionId, {
    slug,
    profileId: state.profileId,
    workspaceRoot: state.workspaceRoot,
    masterSessionId,
    brief,
  });
  return peerSessionId;
}
function isPeerControlState(state) {
  return state?.workspaceRoot?.startsWith(peerControlPrefix) === true;
}
function peerControlVariant(state) {
  return (state?.workspaceRoot ?? "").slice(peerControlPrefix.length);
}
const peerControlVariantOverrides = new Map(); // sessionId -> variant
function effectivePeerControlVariant(state) {
  return (
    peerControlVariantOverrides.get(state.sessionId) ??
    peerControlVariant(state)
  );
}
function peerControlAdverts(variant) {
  return {
    method: variant !== "no-method",
    feature: variant !== "no-feature",
  };
}
const peerControlCalls = new Map(); // sessionId -> [kind, ...]
function recordPeerControlCall(sessionId, kind) {
  const calls = peerControlCalls.get(sessionId) ?? [];
  calls.push(kind);
  peerControlCalls.set(sessionId, calls);
}
/** Deterministic synthetic slug for the controlled peer (safe + stable). */
function peerControlSlug() {
  return PEER_CONTROL_SLUG;
}
/**
 * Synthetic `session/driver/get` disclosure for a peer-control workspace. The
 * lease is NONZERO (an ACTIVE external binding) so the discovery walk settles
 * `complete`/`external` and control readiness flips to `ready`.
 */
function peerControlDriverResponse(state) {
  const acquired = peerAcquires.get(state.sessionId);
  const mode = peerDriverMode(state.sessionId);
  return {
    mode,
    recovery: "none",
    ...(mode === "external"
      ? {
          binding: {
            driver_id:
              acquired?.driver_id ?? `synthetic-driver-${state.sessionId}`,
            epoch: DRIVER_EPOCH,
            revision: DRIVER_REVISION,
            lease_expires_at_ms:
              acquired?.lease_expires_at_ms ??
              (peerControlVariant(state).startsWith("handover")
                ? 0
                : DRIVER_LEASE_EXPIRES_AT_MS),
            workspace_root: state.workspaceRoot,
          },
        }
      : {}),
    // The discovery walk ALWAYS requests an operations page; empty items with
    // complete:true / next_cursor:null is the valid terminal page.
    operations: {
      items: [],
      snapshot: `synthetic-snapshot-${state.sessionId}`,
      observed_revision: String(DRIVER_REVISION),
      complete: true,
      next_cursor: null,
    },
  };
}
/** `session/driver/acquire` reply: token + ACTIVE binding bound to the caller. */
function peerControlAcquireResponse(state, request) {
  return {
    control_token: PEER_CONTROL_TOKEN,
    // The seat's target identity is taken from the acquire's PENDING work
    // (`peerControlTargetFor` reads `pendingWork[0]`); a fresh acquire holds
    // exactly one. Omitting it leaves the target null -> no seat -> no panel.
    pending_work: [PEER_CONTROL_PENDING_OP],
    recovery: "none",
    binding: {
      driver_id: request.params.driver_id,
      epoch: DRIVER_EPOCH,
      revision: DRIVER_REVISION,
      lease_expires_at_ms: DRIVER_LEASE_EXPIRES_AT_MS,
      workspace_root: state.workspaceRoot,
    },
  };
}
/** `session/driver/release` reply: mode-specific, echoing the caller's `next`. */
function peerControlReleaseResponse(state, request) {
  const next = request.params.next;
  if (next === "internal") {
    // Release-to-internal omits the binding entirely.
    return { mode: "internal", recovery: "none" };
  }
  return {
    mode: "external",
    recovery: "none",
    // Parked binding: durable mode stays external with NO live lease (lease 0).
    binding: {
      driver_id: request.params.driver_id,
      epoch: DRIVER_EPOCH,
      revision: DRIVER_REVISION,
      lease_expires_at_ms: 0,
      workspace_root: state.workspaceRoot,
    },
  };
}
/**
 * ACCEPTED `peer/control` receipt — EXACTLY the native deny_unknown_fields key
 * set. Identity: the captured master's `#topic` is stripped, then the target is
 * `${base}#peer-${slug}` with a native-safe slug and a UUID turn id.
 */
function peerControlAcceptedReceipt(state, request, duplicate) {
  const base = String(state.sessionId).split("#")[0];
  const slug = peerControlSlug();
  return {
    operation_id: request.params.operation_id,
    state: "accepted",
    target_operation_id: request.params.target_operation_id,
    expected_turn_id: request.params.expected_turn_id,
    target_session_id: `${base}#peer-${slug}`,
    slug,
    accepted_at_ms: PEER_CONTROL_ACCEPTED_AT_MS,
    payload_digest: PEER_CONTROL_DIGEST,
    duplicate: duplicate === true,
  };
}
/**
 * REFUSED `peer/control` receipt — still the exact CONTroL_RESULT_KEYS shape
 * (deny_unknown_fields), but `state:"refused"` with empty target fields. The
 * client branches this to the typed `peer_control_refused` refusal BEFORE the
 * accepted decode, so no fence/field validation applies on this path.
 */
function peerControlRefusedReceipt(state, request) {
  return {
    operation_id: request.params.operation_id,
    state: "refused",
    target_operation_id: "",
    expected_turn_id: "",
    target_session_id: "",
    slug: "",
    accepted_at_ms: 0,
    payload_digest: "",
    duplicate: false,
  };
}
/**
 * ACCEPTED `peer/dispatch` receipt — EXACTLY the native deny_unknown_fields key
 * set the leaf's `decodePeerDispatchReceipt` requires. The adopted identity is
 * the captured master wire base + `#peer-<slug>`, and the adopted turn is a
 * valid protocol UUID, so the strict identity check passes. The `model` echo
 * discloses a RESOLVED model (may differ from the requested lane) while
 * `model_lane` byte-matches the caller's requested `model`.
 */
function peerDispatchAcceptedReceipt(state, request, duplicate) {
  const base = String(state.sessionId).split("#")[0];
  const slug = peerControlSlug();
  return {
    operation_id: request.params.operation_id,
    state: "accepted",
    model: "synthetic-resolved-model",
    model_lane: request.params.model,
    workspace_root: state.workspaceRoot,
    scoped_goal: null,
    adopted_turn_id: PEER_DISPATCH_ADOPTED_TURN_ID,
    adopted_session_id: `${base}#peer-${slug}`,
    slug,
    duplicate: duplicate === true,
    accepted_at_ms: PEER_CONTROL_ACCEPTED_AT_MS,
    payload_digest: peerDispatchDigest(request.params),
  };
}
/**
 * A REFUSED `peer/dispatch` is NOT a receipt: the Core refuses EVERY dispatch
 * through `preparation_failure_to_rpc` -> `driver_store_error_to_rpc`
 * (ui_protocol_transport.rs:19207-19213) and SENDS an rpc ERROR —
 * -32602 `"driver operation refused: peer/dispatch"` carrying `data:{kind}`.
 * `handle_peer_control` is the asymmetric leaf: ITS refusals stay SUCCESS
 * results (`peerControlRefusedReceipt` above). Every dispatch refusal arm below
 * therefore `replyError`s; no dispatch-shaped refused receipt exists.
 */
const peerDispatchCalls = new Map(); // sessionId -> [kind, ...]
function recordPeerDispatchCall(sessionId, kind) {
  const calls = peerDispatchCalls.get(sessionId) ?? [];
  calls.push(kind);
  peerDispatchCalls.set(sessionId, calls);
}
/**
 * `refused` | `stale` | `duplicate` derive from the workspace suffix; default
 * accepted. `stale` is the SYMMETRIC half of the `peer/control` stale arm: this
 * workspace's control lease is stale, so BOTH leaves refuse with the same typed
 * `driver_fence_stale` error rather than a refused receipt.
 */
function peerDispatchVariant(state) {
  const variant = effectivePeerControlVariant(state);
  return variant === "refused" || variant === "stale" || variant === "duplicate"
    ? variant
    : "accepted";
}
/**
 * Synthetic MALFORMED disclosure: structurally invalid binding (non-integer
 * epoch) so the STRICT client decoder must reject it outright. This proves the
 * decode boundary, not a Core refusal.
 */
function driverMalformedResponse(state) {
  return {
    mode: "external",
    recovery: "none",
    binding: {
      driver_id: `synthetic-driver-${state.sessionId}`,
      epoch: "not-an-integer",
      revision: DRIVER_REVISION,
      lease_expires_at_ms: DRIVER_LEASE_EXPIRES_AT_MS,
      workspace_root: state.workspaceRoot,
    },
  };
}
/**
 * Deterministic synthetic disclosure per synthetic Session. "refused"/"revoked"
 * are expressed as NON-ok replies (allowlisted typed refusal kinds), never as a
 * closed/invalidated binding — the wire is binary result|error.
 */
function driverResponse(state) {
  const variant = driverVariant(state);
  if (refusedDriverSessions.has(state.sessionId))
    return {
      error: {
        code: -32_041,
        message: "fixture refused",
        data: { kind: "driver_scope_mismatch" },
      },
    };
  if (malformedDriverSessions.has(state.sessionId))
    return { result: driverMalformedResponse(state) };
  if (variant === "refused")
    return {
      error: {
        code: -32_041,
        message: "fixture refused",
        data: { kind: "driver_scope_mismatch" },
      },
    };
  if (variant === "revoked")
    return {
      error: {
        code: -32_041,
        message: "fixture revoked",
        data: { kind: "driver_operations_cursor_reset" },
      },
    };
  if (variant === "malformed")
    return { result: driverMalformedResponse(state) };
  const external = variant !== "internal";
  return {
    result: {
      mode: external ? "external" : "internal",
      recovery: "none",
      binding: external
        ? {
            driver_id: `synthetic-driver-${state.sessionId}`,
            epoch: DRIVER_EPOCH,
            revision: DRIVER_REVISION,
            // 0 = "no live lease". A retained inactive external binding stays
            // external; only `mode` may present it.
            lease_expires_at_ms: 0,
            workspace_root: state.workspaceRoot,
          }
        : null,
      // The discovery walk ALWAYS requests an operations page; a requested
      // page that is ABSENT is typed UNSUPPORTED, never a complete inventory.
      // Empty items with complete:true / next_cursor:null is the valid
      // terminal page and skips the peer-dispatch row path entirely.
      operations: {
        items: [],
        snapshot: `synthetic-snapshot-${state.sessionId}`,
        observed_revision: "1",
        complete: true,
        next_cursor: null,
      },
    },
  };
}
function sendDriverReply(socket, id, response) {
  if (response.error) {
    replyError(
      socket,
      id,
      response.error.code,
      response.error.message,
      response.error.data,
    );
    return;
  }
  reply(socket, id, response.result);
}
/**
 * Answer an armed session/driver/get: send immediately, OR capture the reply on
 * the socket-scoped barrier so the test controls release timing. The caller
 * must `return` — the loop never falls through past this.
 */
function driverReply(socket, request) {
  const state = sessionState(request.params.session_id);
  if (!isDriverState(state)) {
    replyError(
      socket,
      request.id,
      -32_601,
      `unknown method: ${DRIVER_GET_METHOD}`,
    );
    return;
  }
  const response = driverResponse(state);
  const methods = driverHolds.get(state.sessionId);
  const alreadyHeld = methods?.has(DRIVER_GET_METHOD) === true;
  // A `delay` workspace holds exactly ONE discovery request — its first —
  // until the test releases it (deterministic barrier: no arm-after-open race).
  // The arm is keyed by workspace so a sibling Session still completes.
  const autoHold =
    driverVariant(state) === "delay" &&
    !delayedDriverWorkspaces.has(state.workspaceRoot);
  if (autoHold || alreadyHeld) {
    // NEVER overwrite an outstanding captured reply: the original held
    // request/frame is preserved verbatim, and a second pending request for the
    // same Session is refused with a protocol error instead of silently
    // replacing (and losing) the first.
    if (alreadyHeld) {
      replyError(
        socket,
        request.id,
        -32_602,
        "driver fixture: a discovery request is already held for this Session",
      );
      return;
    }
    delayedDriverWorkspaces.add(state.workspaceRoot);
    const held = methods ?? new Map();
    held.set(DRIVER_GET_METHOD, { socket, id: request.id, response });
    driverHolds.set(state.sessionId, held);
    return;
  }
  sendDriverReply(socket, request.id, response);
}
function isNativeState(state) {
  return state?.workspaceRoot?.startsWith(nativeWorkspacePrefix) === true;
}
function nativeState(state) {
  if (!state.native) {
    const now = Date.now();
    const artifact = {
      id: "native-report",
      title: "Native verification report",
      kind: "report",
      status: "ready",
    };
    state.native = {
      goal: null,
      generation: 0,
      loops: [],
      monitors: [],
      steers: [],
      agents: ["native-agent-1", "native-agent-2"].map((agentId) => ({
        agent_id: agentId,
        session_id: state.sessionId,
        profile_id: state.profileId,
        path: agentId,
        role: "reviewer",
        nickname: `Reviewer ${agentId}`,
        backend_kind: "octos",
        status: "running",
        created_at_ms: now,
        updated_at_ms: now,
        artifact_count: 1,
        artifacts: [artifact],
        cwd: state.workspaceRoot,
        output_tail: `Native output owned by ${state.sessionId}`,
      })),
    };
  }
  return state.native;
}
function nativeReply(socket, request, result) {
  const methods = nativeHolds.get(request.params.session_id);
  if (methods?.has(request.method)) {
    if (methods.get(request.method)) {
      replyError(socket, request.id, -32_050, "Native reply is already held");
      return;
    }
    // Snapshot NOW: releasing a read must not silently read the newer state.
    // Mutations are committed once before holding their acknowledgment.
    methods.set(request.method, {
      socket,
      id: request.id,
      result: structuredClone(result),
    });
  } else reply(socket, request.id, result);
}
function nativeNotify(state, method, params) {
  for (const socket of state.sockets) {
    if (socket.readyState === WebSocket.OPEN) notifyRpc(socket, method, params);
  }
}
function nativeGoalResult(state, actor = "user") {
  const native = nativeState(state);
  return {
    session_id: state.sessionId,
    profile_id: state.profileId,
    goal: native.goal,
    generation: native.generation,
    transition_actor: actor,
  };
}
const fixtureSnapshots = [
  {
    id: "snapshot-fixture-before",
    label: "Before fixture changes",
    timestamp_unix: 1_788_000_000,
  },
];
function holdHistoryRefreshAfterMutation(sessionId) {
  if (historyRefreshArmed.delete(sessionId))
    sessionState(sessionId).holdHydrate = true;
}
let holdNextTurnStartAcknowledgement = false;
let heldTurnStart = null;
const turnStateBySession = new Map();
let rejectNextSessionOpen = false;
// Controlled terminal-release barrier. Each /__test__/terminal/hold-next arms
// exactly ONE future completion tail (browser or peer): when that tail fires
// it parks in heldTerminals (keyed by session) until an explicit per-Session
// release. A queued A2 therefore drains the moment A1's terminal is released
// (it is never held), while a cohort barrier (12+3) arms as many tails as it
// will start. reset disarms every remaining arm and flushes held terminals.
let holdNextTerminal = 0;
// Peer-fence barrier (audit 0550 G2/G3). A turn armed here is marked
// `ownerKind: "peer"` while it lives on the shared master socket, so a
// `turn/interrupt` that reaches it is REFUSED with the fence notice instead of
// cancelling it. Each arm burns on the next turn/start; `peerHoldNextSessions`
// arms one named Session, the bare counter arms the next turn regardless.
let holdPeerNextTurn = 0;
const peerHoldNextSessions = new Set(); // sessionId -> arm that Session's NEXT turn
const heldTerminals = new Map(); // sessionId -> { emit, turnId }
// Native-peer lifecycle, mirroring Core's exact contract. A peer is NOT a
// fabricated active row: the master transport first sends `peer/prepare`
// with the Core fleet parameter `n`; the fixture answers with that many
// STAGED peer identities and emits a `peer/staged` notification per peer.
// A peer becomes genuinely active only when the browser host performs a real
// `session/open` for `${profileId}:local:tui#peer-${slug}` followed by one
// UUID `turn/start` on the SAME shared owner WebSocket. RPC admission on that
// owner is what the fixture counts — never a synthetic counter.
const stagedPeers = new Map(); // sessionId -> { slug, profileId, workspaceRoot, masterSessionId, brief }
const admittedPeers = new Set(); // sessionId -> opened over a real owner WS
function isPeerSessionId(sessionId) {
  return stagedPeers.has(sessionId) || admittedPeers.has(sessionId);
}
function stagePeers(count, profileId, workspaceRoot, masterSessionId, brief) {
  const staged = [];
  for (let index = 0; index < count; index += 1) {
    const slug = crypto.randomUUID();
    const sessionId = `${profileId}:local:tui#peer-${slug}`;
    stagedPeers.set(sessionId, {
      slug,
      profileId,
      workspaceRoot,
      masterSessionId,
      brief,
    });
    staged.push({
      sessionId,
      slug,
      profileId,
      workspaceRoot,
      topic: `peer-${slug}`,
      profile_id: profileId,
      cwd: workspaceRoot,
      brief_path: `${workspaceRoot}/.peers/${slug}/brief.md`,
    });
  }
  return staged;
}
/**
 * Peer-session activity producers (audit 0550 row 5). A staged peer's OWN
 * Session frames — turn/started, approval/requested, approval/decided and
 * turn/completed — drive its dock row through live / blocked / done. The
 * fixture emits them on the SAME pooled owner socket that staged the peer,
 * exactly as the real Core routes a peer Session's notifications through the
 * shared transport; the browser's `SessionPeerCoordinator` attributes them by
 * the peer session id it recorded at `session/open` (session-peer-coordinator
 * .ts:134-176). An unknown slug is IGNORED: no frame, no synthetic row, no
 * crash. Triggered by composer text in the ROOT session, like
 * `Request approval fixture` below.
 */
const PEER_ACTIVITY_TRIGGER =
  /^Peer (turn|approval|resolve|complete) fixture (\S+)$/u;
function peerSessionIdForSlug(slug) {
  for (const [sessionId, peer] of stagedPeers)
    if (peer.slug === slug && !peer.closed) return sessionId;
  return null;
}
function peerApprovalId(slug) {
  return `peer-approval-${slug}`;
}
function emitPeerActivityFrame(socket, kind, slug) {
  const peerSessionId = peerSessionIdForSlug(slug);
  if (peerSessionId === null) return false;
  const send = (method, params) => notifyRpc(socket, method, params);
  if (kind === "turn")
    send("turn/started", {
      session_id: peerSessionId,
      turn_id: crypto.randomUUID(),
      // Core `TurnStartedEvent` declares `timestamp` NON-Option (wire-parity
      // finding 2360); the client never reads it, but a Core-strict
      // deserializer would reject the frame without it.
      timestamp: new Date().toISOString(),
    });
  else if (kind === "approval")
    send("approval/requested", {
      session_id: peerSessionId,
      approval_id: peerApprovalId(slug),
      turn_id: crypto.randomUUID(),
      tool_name: "shell",
      title: "Peer requests to run checks",
      body: "A staged peer wants to run the repository checks.",
      approval_kind: "command",
      risk: "medium",
    });
  else if (kind === "resolve")
    send("approval/decided", {
      session_id: peerSessionId,
      approval_id: peerApprovalId(slug),
      decision: "approve",
    });
  else if (kind === "complete")
    send("turn/completed", {
      session_id: peerSessionId,
      turn_id: crypto.randomUUID(),
    });
  return true;
}
// Turns cancelled by an explicit turn/interrupt: their pending completion
// timer must never emit assistant_persisted/turn_terminal afterwards.
const cancelledTurns = new Set();
const mockAuthMode = process.env.OCTOSCODE_MOCK_AUTH_MODE ?? "optional";
if (!new Set(["optional", "required"]).has(mockAuthMode)) {
  throw new Error("OCTOSCODE_MOCK_AUTH_MODE must be optional or required");
}
const mockAuthTokens = new Set(
  (process.env.OCTOSCODE_MOCK_AUTH_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean),
);
const mockProfileAuthToken = (
  process.env.OCTOSCODE_MOCK_PROFILE_AUTH_TOKEN ?? ""
).trim();
const mockProfileAuthId = (
  process.env.OCTOSCODE_MOCK_PROFILE_AUTH_ID ?? ""
).trim();
if (Boolean(mockProfileAuthToken) !== Boolean(mockProfileAuthId)) {
  throw new Error(
    "OCTOSCODE_MOCK_PROFILE_AUTH_TOKEN and OCTOSCODE_MOCK_PROFILE_AUTH_ID must be configured together",
  );
}
if (mockProfileAuthToken) mockAuthTokens.add(mockProfileAuthToken);
if (mockAuthMode === "required" && mockAuthTokens.size === 0) {
  throw new Error(
    "OCTOSCODE_MOCK_AUTH_TOKENS must contain a fixture token when auth is required",
  );
}
// WEB-PAIRING-CONTRACT-5100 — the pairing half of the fixture. One code per
// process start, single use, 5 minutes, at most 10 failed claims. The code is
// FIXED here (a real server mints it) so a spec can build the link it needs;
// /__test__/pair/reset re-mints it and stages each refusal kind.
const PAIR_CODE = (process.env.OCTOSCODE_MOCK_PAIR_CODE ?? "R7K2QPX9")
  .trim()
  .toUpperCase();
const PAIR_TOKEN = (
  process.env.OCTOSCODE_MOCK_PAIR_TOKEN ?? "paired-e2e-token"
).trim();
const PAIR_CODE_SHAPE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
const PAIR_TTL_MS = 5 * 60_000;
const MAX_PAIR_ATTEMPTS = 10;
if (!PAIR_CODE_SHAPE.test(PAIR_CODE)) {
  throw new Error("OCTOSCODE_MOCK_PAIR_CODE must be 8 Crockford base32 chars");
}
// The claimed token must authenticate the socket that follows it.
mockAuthTokens.add(PAIR_TOKEN);
const PAIR_MODES = new Set([
  "fresh",
  "burned",
  "expired",
  "locked",
  "unsupported",
]);
let pairState = freshPairState();

function freshPairState(mode = "fresh") {
  return {
    mode,
    mintedAt:
      mode === "expired" ? Date.now() - PAIR_TTL_MS - 1_000 : Date.now(),
    burned: mode === "burned",
    locked: mode === "locked",
    failures: mode === "locked" ? MAX_PAIR_ATTEMPTS : 0,
    supported: mode !== "unsupported",
  };
}

/** Case-insensitive against the printed alphabet, and constant-time. */
function pairCodeMatches(candidate) {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(PAIR_CODE, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Loopback only — a wider peer is told nothing, not told "no". */
function isLoopbackPeer(request) {
  const address = request.socket.remoteAddress ?? "";
  const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
  return bare === "::1" || bare === "127.0.0.1" || bare.startsWith("127.");
}

function pairErrorKind(candidate) {
  // A malformed body is not a guess: it never touches the attempt budget.
  if (!PAIR_CODE_SHAPE.test(candidate)) return "pair_code_invalid";
  if (pairState.locked) return "pair_code_locked";
  if (Date.now() - pairState.mintedAt > PAIR_TTL_MS) return "pair_code_expired";
  if (pairState.burned) return "pair_code_unknown";
  if (pairCodeMatches(candidate)) return null;
  pairState.failures += 1;
  if (pairState.failures >= MAX_PAIR_ATTEMPTS) {
    pairState.locked = true;
    pairState.burned = true;
    return "pair_code_locked";
  }
  return "pair_code_unknown";
}
const defaultProfileId = "coding";
const sessionChannels = new Set([
  "api",
  "cli",
  "dingtalk",
  "discord",
  "email",
  "feishu",
  "line",
  "local",
  "matrix",
  "qq-bot",
  "slack",
  "system",
  "telegram",
  "test",
  "twilio",
  "wechat",
  "wecom",
  "wecom-bot",
  "whatsapp",
]);
const initialProfileModels = [
  {
    family_id: "zai",
    model_id: "glm-5.3-flash",
    route: {
      route_id: "official",
      label: "Z.AI Coding Plan",
      base_url: "https://api.z.ai/api/coding/paas/v4",
      api_key_env: "ZAI_API_KEY",
      api_type: "openai",
    },
    has_api_key: true,
    selected: true,
    available: true,
  },
  {
    family_id: "deepseek",
    model_id: "deepseek-v4-pro",
    route: {
      route_id: "official",
      label: "DeepSeek",
      base_url: "https://api.deepseek.com/v1",
      api_key_env: "DEEPSEEK_API_KEY",
      api_type: "openai",
    },
    has_api_key: false,
    selected: false,
    available: true,
  },
];
const defaultRuntimeModel = {
  model: "deepseek-v4",
  provider: "deepseek",
  title: "DeepSeek V4",
};
const configuredModelsByProfile = new Map([
  [defaultProfileId, cloneConfiguredModels(initialProfileModels)],
]);
const effectiveRuntimeModelByProfile = new Map([
  [defaultProfileId, defaultRuntimeModel],
]);

function cloneConfiguredModels(models) {
  return models.map((model) => ({
    ...model,
    route: { ...model.route },
  }));
}

function configuredModelsForProfile(profileId) {
  let configured = configuredModelsByProfile.get(profileId);
  if (!configured) {
    configured = cloneConfiguredModels(initialProfileModels);
    configuredModelsByProfile.set(profileId, configured);
  }
  return configured;
}

function sessionModel(model) {
  return {
    model: model.model_id,
    provider: model.family_id,
    title: modelTitle(model.model_id),
    family: model.family_id,
    route: model.route.route_id,
    selected: model.selected,
    available: model.available,
  };
}

function profileModelConfiguration(profileId) {
  const configured = configuredModelsForProfile(profileId);
  const selected = configured.find((model) => model.selected) ?? null;
  return {
    profile_id: profileId,
    primary: selected ? configuredModelProjection(selected, true) : null,
    fallbacks: configured
      .filter((model) => model !== selected)
      .map((model) => configuredModelProjection(model, false)),
  };
}

function configuredModelProjection(model, selected) {
  return {
    family_id: model.family_id,
    model_id: model.model_id,
    route: { ...model.route },
    has_api_key: model.has_api_key,
    selected,
    available: model.available,
  };
}

function modelTitle(modelId) {
  if (modelId === "glm-5.3-flash") return "GLM 5.3 Flash";
  if (modelId === "deepseek-v4-pro") return "DeepSeek V4 Pro";
  return modelId;
}

/** Bounded body read: a fixture never buffers an unbounded claim. */
function readJsonBody(request, limit = 4_096) {
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) finish(null);
    });
    request.on("end", () => {
      try {
        finish(JSON.parse(raw));
      } catch {
        finish(null);
      }
    });
    request.on("error", () => finish(null));
  });
}

const http = createServer((request, response) => {
  if (request.url === "/api/auth/me") {
    response.setHeader(
      "Access-Control-Allow-Origin",
      request.headers.origin ?? "*",
    );
    response.setHeader("Access-Control-Allow-Headers", "Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const token = authTokenFromUpgradeRequest(request);
    if (mockAuthMode === "required" && !mockAuthTokens.has(token)) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        user: {
          id: token === "forget-me-token" ? "other-user" : "fixture-user",
        },
      }),
    );
    return;
  }
  if (request.url === "/health") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
    return;
  }
  // WEB-PAIRING-CONTRACT-5100 §Server — /pair/info and /pair/claim, first so a
  // CORS preflight from the web client's own origin is answered before any
  // other route can 404 it.
  const pairPath = new URL(request.url, "http://fixture").pathname;
  if (pairPath === "/pair/info" || pairPath === "/pair/claim") {
    response.setHeader(
      "access-control-allow-origin",
      request.headers.origin ?? "*",
    );
    response.setHeader("vary", "origin");
    if (request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("access-control-max-age", "600");
      response.writeHead(204).end();
      return;
    }
    // A non-loopback peer, and a server with pairing switched off, both answer
    // 404: the endpoint never confirms it exists to the wider network.
    if (!isLoopbackPeer(request) || !pairState.supported) {
      response.writeHead(404).end();
      return;
    }
    if (pairPath === "/pair/info") {
      if (request.method !== "GET") {
        response.writeHead(405).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          product: "octos",
          version: "2.0.3-fixture",
          pairing_required: !pairState.burned && !pairState.locked,
          server_origin: `http://127.0.0.1:${port}`,
        }),
      );
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    void readJsonBody(request).then((body) => {
      const candidate =
        body && typeof body.code === "string"
          ? body.code.trim().toUpperCase()
          : "";
      const kind = pairErrorKind(candidate);
      if (kind) {
        response
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { kind } }));
        return;
      }
      // Single use: the first success burns the code.
      pairState.burned = true;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          token: PAIR_TOKEN,
          server_origin: `http://127.0.0.1:${port}`,
        }),
      );
    });
    return;
  }
  if (pairPath === "/__test__/pair/reset" && request.method === "POST") {
    const mode =
      new URL(request.url, "http://fixture").searchParams.get("mode") ??
      "fresh";
    if (!PAIR_MODES.has(mode)) {
      response.writeHead(400).end("Unknown pairing fixture mode");
      return;
    }
    pairState = freshPairState(mode);
    response.writeHead(204).end();
    return;
  }
  if (pairPath === "/__test__/pair/state" && request.method === "GET") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({ code: PAIR_CODE, token: PAIR_TOKEN, ...pairState }),
      );
    return;
  }
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/native/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    const state = sessionStateBySessionId.get(
      url.searchParams.get("session_id"),
    );
    if (!isNativeState(state)) {
      response
        .writeHead(409)
        .end("An opened native-workflow fixture Session is required");
      return;
    }
    const method = url.searchParams.get("method");
    const methods = nativeHolds.get(state.sessionId) ?? new Map();
    if (request.method === "GET" && url.pathname === "/__test__/native/state") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          held: [...methods].filter(([, value]) => value).map(([name]) => name),
          armed: [...methods]
            .filter(([, value]) => !value)
            .map(([name]) => name),
        }),
      );
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === "/__test__/native/seed-history") {
      const entries = [
        {
          id: `bare-${crypto.randomUUID()}`,
          title: "Unscoped native history (not resumable)",
          message_count: 2,
        },
      ];
      for (const label of ["A", "B"]) {
        const id = `${state.profileId}:local:native-history-${crypto.randomUUID()}`;
        const historical = sessionState(id);
        historical.profileId = state.profileId;
        historical.workspaceRoot = state.workspaceRoot;
        forkedSessions.add(id);
        const turnId = crypto.randomUUID();
        const frames = [
          {
            type: "user_message",
            data: { text: `Historical native request ${label}` },
          },
          {
            type: "assistant_persisted",
            data: {
              text: `Historical native answer ${label}`,
              assistant_segment_id: `${turnId}:assistant:1`,
              meta: { message_id: `message-${turnId}` },
            },
          },
          { type: "turn_terminal", data: { outcome: "completed" } },
        ];
        for (const [index, payload] of frames.entries())
          recordProjection(id, {
            session_id: id,
            thread_id: turnId,
            turn_id: turnId,
            seq: index + 1,
            cursor: { stream: id, seq: index + 1 },
            payload,
          });
        historical.completedTurns.push({
          turn_id: turnId,
          thread_id: turnId,
          state: "completed",
        });
        entries.push({
          id,
          title: `Native historical Session ${label}`,
          message_count: 2,
        });
      }
      const sessions = entries.map((entry) => ({
        ...entry,
        updated_at: new Date().toISOString(),
      }));
      sessionsByWorkspace.set(state.workspaceRoot, [
        ...(sessionsByWorkspace.get(state.workspaceRoot) ?? []),
        ...sessions,
      ]);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ sessions }));
      return;
    }
    if (
      url.pathname === "/__test__/native/hold" &&
      nativeHoldMethods.has(method) &&
      !methods.has(method)
    ) {
      methods.set(method, null);
      nativeHolds.set(state.sessionId, methods);
    } else if (
      url.pathname === "/__test__/native/release" &&
      methods.get(method)
    ) {
      const held = methods.get(method);
      methods.delete(method);
      if (held.socket.readyState === WebSocket.OPEN)
        reply(held.socket, held.id, held.result);
    } else if (
      url.pathname === "/__test__/native/goal-revision" &&
      nativeState(state).goal
    ) {
      const native = nativeState(state);
      native.goal = {
        ...native.goal,
        objective: "Newer server-owned objective",
        updated_at_ms: Date.now(),
      };
      native.generation += 1;
      nativeNotify(
        state,
        "session/goal/updated",
        nativeGoalResult(state, "backend"),
      );
    } else if (
      url.pathname === "/__test__/native/generation" &&
      nativeState(state).goal
    ) {
      // E goal-generation audit driver: emit a goal notification stamped with
      // an ARBITRARY generation (not the fixture's monotonic counter). Core
      // keeps ONE scalar goal_event_generation shared across sessions and
      // profiles (agent_orchestrator.rs), so any single session can observe a
      // base other than 1 and interleaved gaps. The browser must admit a
      // strictly-greater positive generation, drop a non-increasing one, and
      // never let a wrong-owner (different session_id) event mutate this
      // session — regardless of how large its generation is.
      // NOTE: the fixture's scalar is PER-SESSION (nativeState is per
      // Session), a conservative stand-in for Core's process-wide scalar:
      // these tests drive a single open Session, and every injected frame —
      // including a foreign-owner one — advances THIS session's scalar so a
      // genuine later user transition keeps a strictly-greater stamp. This is
      // arbitrary-frame injection, not a faithful multi-session allocator.
      const native = nativeState(state);
      const prior = native.generation;
      const target = Number(url.searchParams.get("to"));
      const foreign = url.searchParams.get("foreign") === "1";
      const generation =
        Number.isSafeInteger(target) && target > 0 ? target : prior + 10;
      const objective = url.searchParams.get("objective");
      // Any injected goal event — including a foreign-owner one — advances the
      // scalar (mirroring Core's shared counter) so a genuine later user
      // transition for this session keeps a strictly-greater stamp and is
      // never starved by an arbitrary driver base.
      native.generation = Math.max(prior, generation);
      if (!foreign && objective !== null && generation > prior) {
        native.goal = { ...native.goal, objective, updated_at_ms: Date.now() };
      }
      // Foreign events still carry a fully valid goal record — only the
      // session_id differs. The browser must drop them by owner check
      // (activity-only), not by malformed payload.
      nativeNotify(state, "session/goal/updated", {
        session_id: foreign ? `${state.sessionId}-other` : state.sessionId,
        profile_id: state.profileId,
        goal: { ...native.goal, ...(objective !== null ? { objective } : {}) },
        generation,
        transition_actor: "backend",
      });
    } else if (
      url.pathname === "/__test__/native/steer-drop" &&
      nativeState(state).steers.length
    ) {
      // Keep the fixture receipt so the test can repeat the SAME notification:
      // the browser must return each admitted text to its FIFO at most once.
      const steer = nativeState(state).steers.at(-1);
      nativeNotify(state, "turn/steer_dropped", {
        session_id: state.sessionId,
        turn_id: steer.turnId,
        reason: "fixture_turn_finishing",
        inputs: [steer.text],
      });
    } else {
      response.writeHead(409).end("No matching native fixture operation");
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/driver/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    // GLOBAL teardown: clears EVERY driver-discovery hold, delay arm and
    // refusal. Keyed by nothing on purpose — this is the afterEach safety net
    // so no per-test state (notably the WORKSPACE-keyed delay arm) can bleed
    // into the next test even after an assertion failure.
    if (
      request.method === "POST" &&
      url.pathname === "/__test__/driver/reset-all"
    ) {
      driverHolds.clear();
      delayedDriverWorkspaces.clear();
      refusedDriverSessions.clear();
      malformedDriverSessions.clear();
      response.writeHead(204).end();
      return;
    }
    const state = sessionStateBySessionId.get(
      url.searchParams.get("session_id"),
    );
    if (!isDriverState(state)) {
      response
        .writeHead(409)
        .end("An opened driver-discovery fixture Session is required");
      return;
    }
    const method = url.searchParams.get("method");
    const methods = driverHolds.get(state.sessionId) ?? new Map();
    if (request.method === "GET" && url.pathname === "/__test__/driver/state") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          held: [...methods].filter(([, value]) => value).map(([name]) => name),
          armed: [...methods]
            .filter(([, value]) => !value)
            .map(([name]) => name),
        }),
      );
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (
      url.pathname === "/__test__/driver/hold" &&
      method === DRIVER_GET_METHOD &&
      !methods.has(method)
    ) {
      methods.set(method, null);
      driverHolds.set(state.sessionId, methods);
    } else if (url.pathname === "/__test__/driver/reset") {
      driverHolds.delete(state.sessionId);
      delayedDriverWorkspaces.delete(state.workspaceRoot);
    } else if (url.pathname === "/__test__/driver/refuse") {
      refusedDriverSessions.add(state.sessionId);
    } else if (url.pathname === "/__test__/driver/malform") {
      malformedDriverSessions.add(state.sessionId);
    } else if (url.pathname === "/__test__/driver/allow") {
      // Undo a session-keyed refusal/malform on the SAME record, so a
      // refused|malformed -> healthy transition can be driven across a
      // reconnect.
      refusedDriverSessions.delete(state.sessionId);
      malformedDriverSessions.delete(state.sessionId);
    } else if (
      url.pathname === "/__test__/driver/release" &&
      methods.get(method)
    ) {
      const held = methods.get(method);
      methods.delete(method);
      if (held.socket.readyState === WebSocket.OPEN)
        sendDriverReply(held.socket, held.id, held.response);
    } else {
      response.writeHead(409).end("No matching driver fixture operation");
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/peer-control/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    const state = sessionStateBySessionId.get(
      url.searchParams.get("session_id"),
    );
    if (!isPeerControlState(state)) {
      response
        .writeHead(409)
        .end("An opened peer-control fixture Session is required");
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/__test__/peer-control/state"
    ) {
      // Exactly-one-frame probe: the total control frames this Session sent and
      // their kinds (accepted | duplicate | refused | fence_stale).
      const calls = peerControlCalls.get(state.sessionId) ?? [];
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ calls: calls.length, kinds: [...calls] }));
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/__test__/peer-control/dispatch-state"
    ) {
      // Parallel probe for the STAGING leaf: total `peer/dispatch` frames this
      // Session sent and their kinds (accepted | duplicate | refused). Kept
      // separate from the control probe so neither metric masks the other.
      const calls = peerDispatchCalls.get(state.sessionId) ?? [];
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ calls: calls.length, kinds: [...calls] }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === "/__test__/peer-control/variant") {
      // Per-Session variant override (default derives from the workspace
      // suffix): accepted | refused | stale | duplicate.
      peerControlVariantOverrides.set(
        state.sessionId,
        url.searchParams.get("variant") ?? "",
      );
    } else if (url.pathname === "/__test__/peer-control/peer-activity") {
      // Drive a DISPATCHED peer's own Session lifecycle (turn | approval |
      // resolve | complete). The root-composer trigger (PEER_ACTIVITY_TRIGGER)
      // cannot reach a peer-control workspace: Start's acquire makes the
      // binding external-held, and `turn/start` is then refused with
      // ExternalMasterHeld — so this is the ONLY way to observe an adopted row
      // waiting for approval. Frames ride the SAME owner socket as the staging.
      const kind = url.searchParams.get("kind") ?? "";
      const slug = url.searchParams.get("slug") ?? peerControlSlug();
      let owner = null;
      for (const client of sockets.clients)
        if (openedSessionsBySocket.get(client)?.has(state.sessionId))
          owner = client;
      if (
        owner === null ||
        !["turn", "approval", "resolve", "complete"].includes(kind) ||
        !emitPeerActivityFrame(owner, kind, slug)
      ) {
        response.writeHead(409).end("No staged peer for this fixture Session");
        return;
      }
    } else if (url.pathname === "/__test__/peer-control/reset") {
      peerControlVariantOverrides.delete(state.sessionId);
      peerControlCalls.delete(state.sessionId);
      peerDispatchCalls.delete(state.sessionId);
      peerDispatches.delete(state.sessionId);
      peerAcquires.delete(state.sessionId);
      peerDriverModes.delete(state.sessionId);
    } else {
      response.writeHead(409).end("No matching peer-control fixture operation");
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    new URL(request.url, "http://fixture").pathname === "/__test__/scope/inject"
  ) {
    const url = new URL(request.url, "http://fixture");
    const sessionId = url.searchParams.get("session_id");
    const event = url.searchParams.get("event");
    const state = sessionStateBySessionId.get(sessionId);
    const parked = state?.interaction;
    const active = state?.activeTurn;
    if (
      !sessionId ||
      sessionId.includes("#") ||
      !parked?.topicScopeProbe ||
      !active ||
      active.turnId !== parked.turnId ||
      parked.ownerSocket.readyState !== WebSocket.OPEN ||
      ![
        "foreign-request",
        "owner-request",
        "foreign-resolution",
        "foreign-terminal",
        "foreign-cursor",
      ].includes(event) ||
      (event === "foreign-resolution" && parked.kind !== "approval")
    ) {
      response
        .writeHead(409)
        .end("An active synthetic topicless ownership probe is required");
      return;
    }
    const recipient = parked.ownerSocket;
    const topic = "foreign-routing-topic";
    if (event === "foreign-request" || event === "owner-request") {
      const params =
        parked.kind === "approval"
          ? approvalRequest(sessionId, parked.turnId)
          : questionRequest(sessionId, parked.turnId);
      // Deliberately conflict on the exact request id AND turn id. Routing
      // ownership, not an unrelated id, must exclude the foreign request.
      if (event === "foreign-request") {
        params.topic = topic;
        params.title = `Foreign-topic ${parked.kind} must stay hidden`;
      }
      notifyRpc(
        recipient,
        parked.kind === "approval"
          ? "approval/requested"
          : "user_question/requested",
        params,
      );
    } else if (event === "foreign-resolution") {
      notifyRpc(recipient, "approval/decided", {
        session_id: sessionId,
        topic,
        turn_id: parked.turnId,
        approval_id: parked.id,
        decision: "approve",
      });
    } else {
      // These are foreign wire frames, NOT events in the base Session's log.
      // One contradicts routing with the same cursor stream (false settle);
      // the other carries the topic's own stream (false recovery/gap).
      notifyRpc(recipient, "projection/envelope", {
        session_id: sessionId,
        topic,
        thread_id: parked.threadId,
        turn_id: parked.turnId,
        seq: (active.emitSeq?.value ?? 1) + 1,
        cursor: {
          stream:
            event === "foreign-cursor" ? `${sessionId}#${topic}` : sessionId,
          seq: state.log.seq + 1,
        },
        payload:
          event === "foreign-cursor"
            ? {
                type: "assistant_delta",
                data: {
                  assistant_segment_id: "foreign-segment",
                  text: "FOREIGN_TOPIC_OUTPUT_MUST_NOT_APPEAR",
                },
              }
            : { type: "turn_terminal", data: { outcome: "completed" } },
      });
    }
    // A visible, correctly routed notification proves the browser processed
    // the preceding frame, making negative UI assertions deterministic.
    notifyRpc(recipient, "warning", {
      session_id: sessionId,
      code: "Topic ownership probe barrier",
      message: `Scope ownership barrier: ${event}`,
    });
    response.writeHead(204).end();
    return;
  }
  // Scoped session listings. By default this fixture answers `session/list`
  // the way an older / `appui.sessions_in_cwd`-off Core does: rows with no
  // scope attestation, which the client must never place under a workspace.
  // Arming a workspace makes its listing attest `workspace_root` +
  // `profile_id`, the way a Core that read `<cwd>/.octos/<profile>` does.
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/session-list/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    const workspace = url.searchParams.get("workspace");
    if (
      request.method === "POST" &&
      url.pathname === "/__test__/session-list/scoped" &&
      workspace
    ) {
      scopedListingWorkspaces.add(workspace);
      response.writeHead(204).end();
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/session-list/reset"
    ) {
      scopedListingWorkspaces.clear();
      response.writeHead(204).end();
    } else
      response.writeHead(409).end("No matching fixture session-list control");
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/disconnect") {
    for (const client of sockets.clients) {
      client.close(1012, "fixture restart");
    }
    response.writeHead(204).end();
    return;
  }
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/history/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    const sessionId = url.searchParams.get("session_id");
    if (
      request.method === "GET" &&
      url.pathname === "/__test__/history/state"
    ) {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          armed: [...historyRefreshArmed],
          held: [...heldHistoryHydrates.keys()],
        }),
      );
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/history/hold-refresh" &&
      sessionStateBySessionId.has(sessionId)
    ) {
      historyRefreshArmed.add(sessionId);
      response.writeHead(204).end();
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/history/release" &&
      heldHistoryHydrates.has(sessionId)
    ) {
      heldHistoryHydrates.get(sessionId).release();
      heldHistoryHydrates.delete(sessionId);
      response.writeHead(204).end();
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/history/reset"
    ) {
      historyRefreshArmed.clear();
      for (const state of sessionStateBySessionId.values())
        state.holdHydrate = false;
      for (const held of heldHistoryHydrates.values()) held.release();
      heldHistoryHydrates.clear();
      response.writeHead(204).end();
    } else response.writeHead(409).end("No matching fixture history control");
    return;
  }
  if (
    new URL(request.url, "http://fixture").pathname.startsWith(
      "/__test__/gather/",
    )
  ) {
    const url = new URL(request.url, "http://fixture");
    const sessionId = url.searchParams.get("session_id");
    if (request.method === "GET" && url.pathname === "/__test__/gather/state") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          armed: [...gatherRepliesArmed],
          held: [...heldGatherReplies.keys()],
        }),
      );
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/gather/hold-next" &&
      sessionStateBySessionId.has(sessionId)
    ) {
      gatherRepliesArmed.add(sessionId);
      response.writeHead(204).end();
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/gather/release" &&
      heldGatherReplies.has(sessionId)
    ) {
      heldGatherReplies.get(sessionId).release();
      heldGatherReplies.delete(sessionId);
      response.writeHead(204).end();
    } else if (
      request.method === "POST" &&
      url.pathname === "/__test__/gather/reset"
    ) {
      gatherRepliesArmed.clear();
      for (const held of heldGatherReplies.values()) held.release();
      heldGatherReplies.clear();
      response.writeHead(204).end();
    } else response.writeHead(409).end("No matching fixture gather control");
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/replay-lossy") {
    for (const client of sockets.clients) {
      const opened = openedSessionsBySocket.get(client);
      const sessionId =
        heldTurnStart?.socket === client
          ? heldTurnStart.sessionId
          : opened
            ? [...opened][0]
            : "coding:local:main";
      if (heldTurnStart?.socket === client) heldTurnStart.admit();
      delayedHydrateSockets.add(client);
      notifyRpc(client, "protocol/replay_lossy", {
        session_id: sessionId,
        dropped_count: 1,
        last_durable_cursor: {
          stream: sessionId,
          seq: sessionStateBySessionId.get(sessionId)?.log.seq ?? 10,
        },
      });
    }
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/reject-opened") {
    for (const client of sockets.clients) {
      const opened = openedSessionsBySocket.get(client);
      if (opened) {
        for (const sessionId of opened) rejectedSessionIds.add(sessionId);
      }
    }
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/turn-start/hold-next"
  ) {
    if (holdNextTurnStartAcknowledgement || heldTurnStart) {
      response
        .writeHead(409)
        .end("A turn/start acknowledgement is already controlled");
      return;
    }
    holdNextTurnStartAcknowledgement = true;
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/turn-start/admit"
  ) {
    response.writeHead(heldTurnStart?.admit() ? 204 : 409).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/turn-start/reset"
  ) {
    holdNextTurnStartAcknowledgement = false;
    takeHeldTurnStart()?.reject();
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/session-open/reject-next"
  ) {
    rejectNextSessionOpen = true;
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/session-open/reset"
  ) {
    rejectNextSessionOpen = false;
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "GET" &&
    request.url === "/__test__/turn-start/state"
  ) {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        armed: holdNextTurnStartAcknowledgement,
        held: heldTurnStart
          ? {
              session_id: heldTurnStart.sessionId,
              turn_id: heldTurnStart.turnId,
            }
          : null,
      }),
    );
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/turn-start/release"
  ) {
    const controlled = takeHeldTurnStart();
    if (!controlled || !controlled.accept()) {
      response
        .writeHead(409)
        .end("There is no live held turn/start to release");
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/turn-start/reject"
  ) {
    const controlled = takeHeldTurnStart();
    if (!controlled || !controlled.reject()) {
      response.writeHead(409).end("There is no live held turn/start to reject");
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/__test__/terminal/hold-next"
  ) {
    holdNextTerminal += 1;
    response.writeHead(204).end();
    return;
  }
  // plan.todos.v1: emit the NEXT wholesale plan replacement for the live plan
  // fixture turn. Driving it explicitly keeps "the plan changed" observable
  // instead of racing a timer against the client's render.
  if (request.method === "POST" && request.url === "/__test__/plan/advance") {
    const step = PLAN_FIXTURE_STEPS[planFixtureTurn?.step ?? -1];
    if (!step || !sendPlanStep(step)) {
      response
        .writeHead(409)
        .end("There is no live plan fixture turn to advance");
      return;
    }
    planFixtureTurn.step += 1;
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "POST" &&
    new URL(request.url, "http://fixture").pathname ===
      "/__test__/terminal/peer-hold"
  ) {
    const armedSessionId = new URL(
      request.url,
      "http://fixture",
    ).searchParams.get("session_id");
    if (armedSessionId) peerHoldNextSessions.add(armedSessionId);
    else holdPeerNextTurn += 1;
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/terminal/reset") {
    holdNextTerminal = 0;
    holdPeerNextTurn = 0;
    peerHoldNextSessions.clear();
    for (const state of sessionStateBySessionId.values()) {
      if (state.activeTurn) state.activeTurn.holdTerminal = false;
      // UX4 Pass 2 (run 20 triage): retire the SEEDED synthetic control-seat
      // turn too. It is not in `heldTerminals` (it has no terminal), so the
      // drain below cannot clear it — and it leaked across tests into
      // diagnostics sweeps (run 20: fence-soak "still active" on
      // /srv/work/peer-control- with turn ...0c1, ownerSocket null).
      if (
        state.activeTurn?.turnId === PEER_CONTROL_ACTIVE_TURN_ID &&
        state.activeTurn.ownerSocket === null
      ) {
        state.activeTurn = null;
      }
    }
    for (const [, held] of heldTerminals) {
      held.emit();
    }
    heldTerminals.clear();
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET" && request.url === "/__test__/terminal/state") {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        armed: holdNextTerminal,
        held: [...heldTerminals.entries()].map(([sessionId, held]) => ({
          session_id: sessionId,
          turn_id: held.turnId,
        })),
      }),
    );
    return;
  }
  if (
    request.method === "POST" &&
    new URL(request.url, "http://fixture").pathname ===
      "/__test__/terminal/release"
  ) {
    const sessionId = new URL(request.url, "http://fixture").searchParams.get(
      "session_id",
    );
    const held = sessionId ? heldTerminals.get(sessionId) : undefined;
    if (!held) {
      response.writeHead(409).end("There is no held terminal for this Session");
      return;
    }
    heldTerminals.delete(sessionId);
    held.emit();
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/peers/spawn") {
    response
      .writeHead(410)
      .end("Stage peers through the browser's peer/prepare command");
    return;
  }
  if (
    request.method === "POST" &&
    new URL(request.url, "http://fixture").pathname === "/__test__/peers/close"
  ) {
    const sessionId = new URL(request.url, "http://fixture").searchParams.get(
      "session_id",
    );
    const peer = stagedPeers.get(sessionId);
    const state = sessionStateBySessionId.get(sessionId);
    if (!peer || !state || state.activeTurn) {
      response.writeHead(409).end("An opened, terminal peer is required");
      return;
    }
    peer.closed = true;
    for (const recipient of sessionStateBySessionId.get(peer.masterSessionId)
      ?.sockets ?? []) {
      notifyRpc(recipient, "peer/closed", {
        session_id: peer.masterSessionId,
        profile_id: peer.profileId,
        topic: `peer-${peer.slug}`,
        slug: peer.slug,
      });
    }
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/peers/reset") {
    stagedPeers.clear();
    admittedPeers.clear();
    for (const [workspaceRoot, sessions] of sessionsByWorkspace) {
      sessionsByWorkspace.set(
        workspaceRoot,
        sessions.filter(
          (session) => !/^[^:]+:local:tui#peer-/.test(session.id),
        ),
      );
    }
    for (const [sessionId, state] of sessionStateBySessionId) {
      if (/^[^:]+:local:tui#peer-/.test(sessionId)) {
        state.sockets.clear();
        sessionStateBySessionId.delete(sessionId);
      }
    }
    for (const sessionId of heldTerminals.keys()) {
      if (/^[^:]+:local:tui#peer-/.test(sessionId)) {
        heldTerminals.delete(sessionId);
      }
    }
    response.writeHead(204).end();
    return;
  }
  if (
    request.method === "GET" &&
    request.url === "/__test__/diagnostics/state"
  ) {
    const activeBySession = {};
    const socketsBySession = {};
    for (const [sessionId, state] of sessionStateBySessionId) {
      activeBySession[sessionId] = state.activeTurn
        ? {
            turn_id: state.activeTurn.turnId,
            owner:
              state.activeTurn.ownerKind ??
              (state.activeTurn.ownerSocket ? "socket" : "peer"),
            profile_id: state.profileId,
            workspace_root: state.workspaceRoot,
          }
        : null;
      socketsBySession[sessionId] = state.sockets.size;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        sessions: sessionStateBySessionId.size,
        active: Object.entries(activeBySession).filter(
          ([, value]) => value !== null,
        ).length,
        activeBySession,
        socketsBySession,
        heldTerminals: heldTerminals.size,
      }),
    );
    return;
  }
  response.writeHead(404).end("Octoscode AppUI fixture only");
});
sockets = new WebSocketServer({
  server: http,
  path: "/api/ui-protocol/ws",
  verifyClient: ({ req }) =>
    mockAuthMode === "optional" ||
    mockAuthTokens.has(authTokenFromUpgradeRequest(req)),
});
const defaultWorkspace = "/workspace/octoscode-web";
const defaultSessions = [
  {
    id: "coding:local:main",
    message_count: 12,
    title: "Ship octoscode-web",
    updated_at: "2026-08-26T00:00:00Z",
    last_prompt: "Add the coding product surfaces",
  },
  {
    id: "coding:local:review",
    message_count: 4,
    title: "Review protocol drift",
    updated_at: "2026-08-25T18:00:00Z",
    last_prompt: "Compare the Core fixture",
  },
];
const sessionsByWorkspace = new Map([[defaultWorkspace, defaultSessions]]);
const scopedListingWorkspaces = new Set();

// Durable per-Session projection log. The fixture records every projection
// envelope a Session emits so a later hydrate of the same Session — from any
// transport — replays that Session's own transcript. This models Core's
// durable per-Session log: a background turn's user prompt, assistant
// segments, and terminal outcome must survive navigation, parking, and
// reconnect instead of being visible only on the socket that streamed them.
// The demo (server-authored) sessions keep their static transcript so ordered
// product tests that hydrate `coding:local:main` still see the fixture demo.
const MAX_SESSION_LOG_EVENTS = 500;
function isBrowserSessionId(sessionId) {
  return /(^|:)web-[0-9a-f-]{36}$/i.test(sessionId.trim());
}
function recordProjection(sessionId, params) {
  // Peers persist messages and canonical replay just like browser Sessions.
  // Demo sessions keep their static transcript.
  if (!isDurableSessionId(sessionId)) {
    return params;
  }
  const log = sessionState(sessionId).log;
  log.seq += 1;
  // Allocate the durable session cursor exactly once and store the SAME
  // envelope that goes on the wire, so a replay is byte-identical to the
  // live event. The per-thread seq (1..N) stays as authored; the cursor seq
  // is the session-global durable watermark.
  const recorded = { ...params, cursor: { stream: sessionId, seq: log.seq } };
  const state = sessionState(sessionId);
  const { type, data } = recorded.payload;
  if (type === "user_message" || type === "assistant_persisted") {
    const messageId =
      type === "user_message"
        ? `user-${params.turn_id}`
        : data.meta?.message_id;
    const existing = state.messages.find(
      (message) => message.message_id === messageId,
    );
    const message = {
      seq: existing?.seq ?? state.messages.length,
      role: type === "user_message" ? "user" : "assistant",
      content: data.text ?? "",
      thread_id: params.thread_id,
      message_id: messageId,
      persisted_at: new Date().toISOString(),
      media: [],
    };
    if (existing) Object.assign(existing, message);
    else state.messages.push(message);
  }
  log.events.push(recorded);
  if (log.events.length > MAX_SESSION_LOG_EVENTS) {
    log.events.splice(0, log.events.length - MAX_SESSION_LOG_EVENTS);
  }
  return recorded;
}

// The Markdown surface fixture. A demo (server-authored) Session serves this
// as static hydrate history; a DURABLE Session earns the same transcript by
// running the MARKDOWN_TRANSCRIPT_PROMPT turn, so a bookmarked conversation has
// real persisted Markdown — code fence included — to restore.
const MARKDOWN_TRANSCRIPT_PROMPT = "Show the Markdown transcript surface";
const MARKDOWN_TRANSCRIPT_ANSWER = [
  "## Durable coding transcript",
  "",
  "The renderer supports **GFM**, safe [external links](https://github.com/octos-org/octoscode-web), and `inline code`.",
  "",
  "- [x] Hydrate the session",
  "- [x] Preserve code formatting",
  "- [ ] Review the diff",
  "",
  "| Surface | State |",
  "| --- | --- |",
  "| Cursor replay | Ready |",
  "| Syntax highlighting | Ready |",
  "",
  "```ts",
  "export function answer(value: number): number {",
  "  return value * 2;",
  "}",
  "```",
  "",
  "> Raw HTML stays inert: <script>never runs</script>",
].join("\n");

function isDurableSessionId(sessionId) {
  return (
    isBrowserSessionId(sessionId) ||
    isPeerSessionId(sessionId) ||
    forkedSessions.has(sessionId)
  );
}

const baseCapabilities = {
  version: {
    protocol: "octos-ui/v1alpha1",
    schema_version: 1,
    jsonrpc: "2.0",
  },
  capabilities_schema_version: 2,
  supported_methods: [
    "config/capabilities/list",
    "launch/resolve",
    "profile/local/create",
    "profile/llm/catalog",
    "profile/llm/delete",
    "profile/llm/fetch_models",
    "profile/llm/list",
    "profile/llm/select",
    "profile/llm/test",
    "profile/llm/upsert",
    "session/open",
    "session/hydrate",
    "session/fork",
    "session/rollback",
    "snapshot/list",
    "snapshot/restore",
    "turn/start",
    "turn/state/get",
    "turn/interrupt",
    "approval/respond",
    "user_question/respond",
    "permission/profile/list",
    "permission/profile/set",
    "diff/preview/get",
    "task/list",
    "task/cancel",
    "task/output/read",
    "task/artifact/list",
    "task/artifact/read",
    "session/status/read",
    "session/list",
    "session/delete",
    "session/files.list",
    "peer/prepare",
    "peer/gather",
  ],
  supported_notifications: [
    "projection/envelope",
    "protocol/replay_lossy",
    "progress/updated",
    "plan/updated",
    "peer/staged",
    "peer/closed",
  ],
  supported_features: [
    "state.session_hydrate.v1",
    "state.turn_state_get.v1",
    "projection.envelope.v2",
    "approval.typed.v1",
    "user_question.v1",
    "harness.task_control.v1",
    "harness.task_artifacts.v1",
    "plan.todos.v1",
    "session.workspace_cwd.v1",
  ],
};

function capabilitiesFor(socket, state) {
  const base = planAbsentSockets.has(socket)
    ? {
        ...baseCapabilities,
        supported_features: baseCapabilities.supported_features.filter(
          (feature) => feature !== PLAN_FEATURE,
        ),
        supported_notifications:
          baseCapabilities.supported_notifications.filter(
            (notification) => notification !== PLAN_NOTIFICATION,
          ),
      }
    : baseCapabilities;
  const capabilities = workspaceBrowseSockets.has(socket)
    ? {
        ...base,
        supported_methods: [
          ...base.supported_methods,
          ...WORKSPACE_BROWSE_METHODS,
        ],
        supported_features: [
          ...base.supported_features,
          WORKSPACE_BROWSE_FEATURE,
        ],
      }
    : base;
  const workspaceRoot = state
    ? state.workspaceRoot
    : openedWorkspaceBySocket.get(socket);
  if (workspaceRoot?.startsWith(driverDiscoveryPrefix)) {
    const adverts = driverAdverts(
      workspaceRoot.slice(driverDiscoveryPrefix.length),
    );
    return {
      ...capabilities,
      supported_methods: adverts.method
        ? [...capabilities.supported_methods, DRIVER_GET_METHOD]
        : capabilities.supported_methods,
      supported_features: adverts.feature
        ? [...capabilities.supported_features, DRIVER_FEATURE]
        : capabilities.supported_features,
    };
  }
  if (workspaceRoot?.startsWith(peerControlPrefix)) {
    const adverts = peerControlAdverts(
      workspaceRoot.slice(peerControlPrefix.length),
    );
    return {
      ...capabilities,
      supported_methods: adverts.method
        ? [
            ...capabilities.supported_methods,
            ...PEER_CONTROL_METHODS,
            PEER_SUB_PROVIDERS_METHOD,
          ]
        : capabilities.supported_methods,
      supported_features: adverts.feature
        ? [...capabilities.supported_features, DRIVER_FEATURE]
        : capabilities.supported_features,
    };
  }
  const native = workspaceRoot?.startsWith(nativeWorkspacePrefix) === true;
  if (!native) return capabilities;
  return {
    ...capabilities,
    supported_methods: [...capabilities.supported_methods, ...nativeMethods],
    supported_features: [
      ...capabilities.supported_features,
      "state.thread_graph.v1",
      "state.turn_state_get.v1",
      "event.turn_steer_dropped.v1",
      "coding.autonomy.v1",
      "coding.goal_runtime.v1",
      "coding.loop_runtime.v1",
      "coding.monitor_runtime.v1",
      "coding.agent_control.v1",
    ],
    supported_notifications: [
      ...capabilities.supported_notifications,
      "turn/steer_dropped",
      "session/goal/updated",
      "session/goal/cleared",
      "loop/updated",
      "agent/updated",
    ],
  };
}

/** Native-shaped synthetic receipts; scheduling/model execution stays outside the browser. */
function handleNativeRequest(socket, request, state) {
  const { method, params } = request;
  const sessionId = state.sessionId;
  const native = nativeState(state);
  const owner = { session_id: sessionId, profile_id: state.profileId };
  let result;
  if (method === "session/btw") {
    if (typeof params.question !== "string" || !params.question.trim()) {
      replyError(
        socket,
        request.id,
        -32602,
        "A native aside question is required",
      );
      return;
    }
    result = {
      session_id: sessionId,
      answer: `Native aside for ${sessionId}: ${params.question}`,
      model: "fixture-native",
    };
  } else if (method === "thread/graph/get") {
    const threadIds = [
      ...new Set(state.messages.map((message) => message.thread_id)),
    ];
    result = {
      session_id: sessionId,
      cursor: { stream: sessionId, seq: state.log.seq },
      threads: threadIds.map((threadId) => {
        const messages = state.messages.filter(
          (message) => message.thread_id === threadId,
        );
        return {
          thread_id: threadId,
          root_seq: messages[0].seq,
          root_client_message_id: messages[0].message_id,
          message_seqs: messages.map((message) => message.seq),
          status: "unknown",
        };
      }),
      orphans: [],
    };
  } else if (method === "turn/state/get") {
    const completed = state.completedTurns.find(
      (turn) => turn.turn_id === params.turn_id,
    );
    const active = state.activeTurn?.turnId === params.turn_id;
    result = {
      session_id: sessionId,
      turn_id: params.turn_id,
      state: active ? "active" : (completed?.state ?? "unknown"),
      ...(active || completed ? { thread_id: params.turn_id } : {}),
      committed_seqs: state.messages
        .filter((message) => message.thread_id === params.turn_id)
        .map((message) => message.seq),
    };
  } else if (method === "approval/scopes/list") {
    result = {
      scopes: [
        {
          session_id: sessionId,
          scope: "workspace",
          scope_match: state.workspaceRoot,
          decision: "allow",
        },
      ],
    };
  } else if (method === "turn/steer") {
    if (
      !state.activeTurn ||
      state.activeTurn.turnId !== params.expected_turn_id ||
      !Array.isArray(params.input) ||
      params.input.length !== 1 ||
      params.input[0]?.kind !== "text" ||
      typeof params.input[0].text !== "string" ||
      !params.input[0].text.trim()
    ) {
      replyError(
        socket,
        request.id,
        -32_050,
        "Expected native active turn or eligible input does not match",
      );
      return;
    }
    native.steers.push({
      turnId: state.activeTurn.turnId,
      text: params.input[0].text,
    });
    result = { turn_id: state.activeTurn.turnId, steered: true };
  } else if (method === "session/goal/get") {
    result = { ...owner, goal: native.goal };
  } else if (method === "session/goal/set") {
    const now = Date.now();
    if (
      typeof params.objective !== "string" ||
      !params.objective.trim() ||
      !["active", "paused", "complete"].includes(params.status) ||
      params.transition_actor !== "user"
    ) {
      replyError(socket, request.id, -32602, "Invalid native goal transition");
      return;
    }
    native.goal = {
      ...native.goal,
      goal_id: native.goal?.goal_id ?? crypto.randomUUID(),
      objective: params.objective,
      status: params.status,
      token_budget: params.token_budget ?? native.goal?.token_budget ?? 50_000,
      tokens_used: native.goal?.tokens_used ?? 0,
      time_used_seconds: native.goal?.time_used_seconds ?? 0,
      created_at_ms: native.goal?.created_at_ms ?? now,
      updated_at_ms: now,
    };
    native.generation += 1;
    result = nativeGoalResult(state);
  } else if (method === "session/goal/clear") {
    const cleared = native.goal !== null;
    native.goal = null;
    native.generation += 1;
    result = { ...nativeGoalResult(state), cleared };
  } else if (method === "loop/list") {
    result = {
      ...owner,
      loops: native.loops.filter((loop) => loop.status !== "deleted"),
    };
  } else if (method === "loop/create") {
    const now = Date.now();
    if (
      !["maintenance", "self_paced", "fixed_interval"].includes(params.mode) ||
      (params.mode !== "maintenance" && !params.prompt?.trim()) ||
      (params.mode === "fixed_interval" &&
        (!Number.isSafeInteger(params.interval_seconds) ||
          params.interval_seconds < 60 ||
          params.interval_seconds > 86400)) ||
      (params.mode !== "fixed_interval" &&
        params.interval_seconds !== undefined)
    ) {
      replyError(socket, request.id, -32602, "Invalid native loop cadence");
      return;
    }
    const loop = {
      ...owner,
      loop_id: crypto.randomUUID(),
      mode: params.mode,
      prompt: params.prompt?.trim() || "run maintenance checks",
      status: "active",
      ...(params.interval_seconds === undefined
        ? {}
        : { interval_seconds: params.interval_seconds }),
      next_run_at_ms: now + (params.interval_seconds ?? 300) * 1000,
      expires_at_ms: now + 86400_000,
      created_at_ms: now,
      updated_at_ms: now,
    };
    native.loops.push(loop);
    result = {
      ...owner,
      loop_id: loop.loop_id,
      loop,
      ok: true,
      status: "active",
      created: true,
      fire: { queued: false, reason: "waiting_for_schedule" },
    };
  } else if (method === "loop/fire_now") {
    // Manual-loop regression driver: a typed fire-now receipt with a real
    // fire outcome. Core (agent_orchestrator.rs control_loop FireNow, ~10420)
    // returns a top-level `status: "queued"` — the enqueue outcome, NOT the
    // loop's own status — plus the nested `loop` record serialized by
    // autonomy_loop_json (whose own status is unchanged: firing is not
    // pausing). Persisted side effects: last_run_at_ms/next_run_at_ms/
    // updated_at_ms update REGARDLESS of enqueue outcome; the INTERNAL
    // AutonomyLoopRecord.fires_used increments only when a NEW continuation
    // was queued — but fires_used is NOT in autonomy_loop_json/UiLoopRecord
    // (ui_protocol.rs UiLoopRecord), so it NEVER appears on the wire. The
    // fixture therefore models ONLY the emitted semantics — timestamps plus
    // the fire receipt — and does NOT track the internal counter, since no
    // wire frame can ever observe it (the smoke asserts its wire absence).
    const loop = native.loops.find((entry) => entry.loop_id === params.loop_id);
    if (!loop || loop.status === "deleted") {
      replyError(socket, request.id, -32_004, "No matching native loop");
      return;
    }
    const now = Date.now();
    const intervalMs = (loop.interval_seconds ?? 300) * 1000;
    loop.last_run_at_ms = now;
    loop.next_run_at_ms = now + intervalMs;
    loop.updated_at_ms = now;
    result = {
      ...owner,
      loop_id: loop.loop_id,
      loop,
      ok: true,
      status: "queued",
      fire: {
        queued: true,
        duplicate: false,
        // Core serializes continuation_id as a u64 number (not a UUID).
        continuation_id: Date.now(),
        dedupe_key: `native-fixture-fire:${loop.loop_id}`,
        reason: "LoopFire",
      },
    };
  } else if (method.startsWith("loop/")) {
    const loop = native.loops.find((entry) => entry.loop_id === params.loop_id);
    if (!loop || loop.status === "deleted") {
      replyError(socket, request.id, -32_004, "No matching native loop");
      return;
    }
    loop.status =
      method === "loop/pause"
        ? "paused"
        : method === "loop/delete"
          ? "deleted"
          : "active";
    loop.updated_at_ms = Date.now();
    result = {
      ...owner,
      loop_id: loop.loop_id,
      loop,
      ok: true,
      status: loop.status,
      ...(method === "loop/delete"
        ? { deleted: true, reaped_cron_job_ids: [] }
        : {}),
    };
  } else if (method === "monitor/list") {
    result = {
      ...owner,
      monitors: native.monitors.filter((entry) => entry.status !== "deleted"),
    };
  } else if (method === "monitor/create") {
    const now = Date.now();
    if (
      typeof params.name !== "string" ||
      !params.name.trim() ||
      !Array.isArray(params.argv) ||
      params.argv.length === 0 ||
      !params.argv.every((entry) => typeof entry === "string") ||
      (params.mode !== undefined &&
        params.mode !== "poll" &&
        params.mode !== "stream") ||
      (params.interval_seconds !== undefined &&
        !Number.isSafeInteger(params.interval_seconds)) ||
      (params.batch_ms !== undefined &&
        !Number.isSafeInteger(params.batch_ms)) ||
      (params.max_events_per_hour !== undefined &&
        !Number.isSafeInteger(params.max_events_per_hour)) ||
      (params.persistent !== undefined &&
        typeof params.persistent !== "boolean")
    ) {
      replyError(socket, request.id, -32602, "Invalid native monitor params");
      return;
    }
    const mode = params.mode === "stream" ? "stream" : "poll";
    const monitor = {
      ...owner,
      monitor_id: crypto.randomUUID(),
      name: params.name.trim(),
      argv: params.argv,
      filter_regex: params.filter_regex ?? null,
      mode,
      // Core (monitor_runtime.rs + transport mapping): a poll monitor carries
      // interval_seconds defaulting to MONITOR_MIN_POLL_INTERVAL_SECS (1s); a
      // stream monitor has none. batch_ms defaults to
      // MONITOR_DEFAULT_BATCH_MS (200), NOT 1000.
      ...(mode === "stream"
        ? {}
        : {
            interval_seconds: params.interval_seconds ?? 1,
          }),
      batch_ms: params.batch_ms ?? 200,
      max_events_per_hour: params.max_events_per_hour ?? 60,
      persistent: params.persistent ?? false,
      status: "active",
      pause_reason: null,
      goal_id: params.goal_id ?? null,
      last_fired_at_ms: null,
      fires_used: 0,
      expires_at_ms: now + 86_400_000,
      created_at_ms: now,
      updated_at_ms: now,
    };
    native.monitors.push(monitor);
    result = {
      ...owner,
      monitor_id: monitor.monitor_id,
      monitor,
      ok: true,
      status: "active",
      created: true,
    };
  } else if (method.startsWith("monitor/")) {
    const monitor = native.monitors.find(
      (entry) => entry.monitor_id === params.monitor_id,
    );
    if (!monitor || monitor.status === "deleted") {
      replyError(socket, request.id, -32_004, "No matching native monitor");
      return;
    }
    // Core control_monitor: pause sets pause_reason "user"; resume clears it;
    // delete moves to deleted. The typed receipt carries the full record.
    monitor.status =
      method === "monitor/pause"
        ? "paused"
        : method === "monitor/delete"
          ? "deleted"
          : "active";
    monitor.pause_reason =
      method === "monitor/pause"
        ? "user"
        : method === "monitor/resume"
          ? null
          : monitor.pause_reason;
    monitor.updated_at_ms = Date.now();
    result = {
      ...owner,
      monitor_id: monitor.monitor_id,
      monitor,
      ok: true,
      status: monitor.status,
      deleted: method === "monitor/delete",
    };
  } else if (method === "agent/list") {
    result = { ...owner, agents: native.agents };
  } else {
    const agent = native.agents.find(
      (entry) => entry.agent_id === params.agent_id,
    );
    if (!agent) {
      replyError(socket, request.id, -32_004, "No matching native agent");
      return;
    }
    const agentOwner = { session_id: sessionId, agent_id: agent.agent_id };
    if (method === "agent/status/read")
      result = { session_id: sessionId, agent };
    else if (method === "agent/output/read")
      result = {
        ...agentOwner,
        source: "fixture",
        text: agent.output_tail,
        cursor: null,
        next_cursor: null,
        has_more: false,
        complete: true,
      };
    else if (method === "agent/artifact/list")
      result = { ...agentOwner, artifacts: agent.artifacts };
    else if (method === "agent/artifact/read") {
      const artifact = agent.artifacts.find(
        (entry) => entry.id === params.artifact_id,
      );
      if (!artifact || params.path !== undefined) {
        replyError(socket, request.id, -32_004, "No matching native artifact");
        return;
      }
      result = {
        ...agentOwner,
        artifact: {
          ...artifact,
          content: "NESTED_UNREDACTED_CONTENT_MUST_NOT_RENDER",
        },
        content: `Redacted native report owned by ${sessionId}`,
      };
    } else {
      const status = method === "agent/interrupt" ? "interrupted" : "closed";
      const alreadyTerminal = [
        "interrupted",
        "closed",
        "completed",
        "failed",
      ].includes(agent.status);
      agent.status = status;
      agent.updated_at_ms = Date.now();
      result = {
        ...agentOwner,
        status,
        ok: true,
        interrupted: status === "interrupted",
        closed: status === "closed",
        already_terminal: alreadyTerminal,
      };
    }
  }
  nativeReply(socket, request, result);
}

sockets.on("connection", (socket, request) => {
  const connectionAuthToken = authTokenFromUpgradeRequest(request);
  if (connectionAuthToken === workspaceBrowseAuthToken) {
    workspaceBrowseSockets.add(socket);
  }
  if (connectionAuthToken === planFixtureAuthToken) {
    planFixtureSockets.add(socket);
  }
  if (connectionAuthToken === planAbsentAuthToken) {
    planAbsentSockets.add(socket);
  }
  const connectionProfileId = authenticatedProfileForToken(connectionAuthToken);
  if (connectionProfileId) {
    authenticatedProfileBySocket.set(socket, connectionProfileId);
  }
  let projectionCursor = 10;
  let createdProfileId = null;
  socket.on("close", () => {
    for (const sessionId of openedSessionsBySocket.get(socket) ?? []) {
      const methods = nativeHolds.get(sessionId);
      for (const [method, held] of methods ?? []) {
        if (!held || held.socket === socket) methods.delete(method);
      }
      if (methods?.size === 0) nativeHolds.delete(sessionId);
      const driverMethods = driverHolds.get(sessionId);
      for (const [method, held] of driverMethods ?? []) {
        if (!held || held.socket === socket) driverMethods.delete(method);
      }
      if (driverMethods?.size === 0) driverHolds.delete(sessionId);
    }
    for (const [sessionId, held] of heldGatherReplies) {
      if (held.socket === socket) heldGatherReplies.delete(sessionId);
    }
    for (const [sessionId, held] of heldHistoryHydrates) {
      if (held.socket === socket) heldHistoryHydrates.delete(sessionId);
    }
    if (heldTurnStart?.socket === socket) heldTurnStart = null;
    const openedSessions = openedSessionsBySocket.get(socket);
    if (openedSessions) {
      for (const sessionId of openedSessions) {
        const state = sessionStateBySessionId.get(sessionId);
        if (!state) continue;
        state.sockets.delete(socket);
        const interruptedOwner =
          state.activeTurn?.ownerSocket === socket ||
          state.interaction?.ownerSocket === socket;
        // A turn parked on a USER QUESTION is not in-flight model work — it is
        // blocked on the OPERATOR. The Core keeps it so the question returns
        // through hydrate's `pending_questions` lane (that lane exists for
        // exactly this case; killing it here would make it unreachable). The
        // owner is dropped, and the next client to hydrate adopts the parked
        // question below.
        const parkedOnQuestion =
          state.interaction?.kind === "question" &&
          state.interaction.turnId === state.activeTurn?.turnId;
        if (interruptedOwner && parkedOnQuestion) {
          if (state.interaction.ownerSocket === socket)
            state.interaction.ownerSocket = null;
          if (state.activeTurn && state.activeTurn.ownerSocket === socket)
            state.activeTurn.ownerSocket = null;
          continue;
        }
        if (interruptedOwner && state.activeTurn) {
          heldTerminals.delete(sessionId);
          // Core rc.11 kills connection-owned turns when the owner
          // disconnects. Persist an interrupted terminal so a later hydrate
          // reports the documented recovery instead of a fabricated success.
          const active = state.activeTurn;
          if (!active.emitSeq) active.emitSeq = { value: 1 };
          const params = {
            session_id: sessionId,
            thread_id: active.threadId,
            // Canonical monotonic per-thread sequence: the interrupted
            // terminal takes the NEXT seq after whatever this thread already
            // authored, so it can never duplicate assistant_delta (seq 2) or
            // any other event of the same thread.
            seq: (active.emitSeq.value += 1),
            cursor: { stream: sessionId, seq: 0 },
            turn_id: active.turnId,
            payload: {
              // v0.10.0 validates canonical payloads before they mutate the
              // cursor (packages/client/src/projection-payload.ts:62-70):
              // `turn_terminal.error` is the structured Core shape, not a bare
              // code string. A string here is rejected as a malformed envelope
              // and parks the record in permanent recovery.
              type: "turn_terminal",
              data: {
                outcome: "interrupted",
                error: {
                  code: "connection_closed",
                  message: "The connection closed before the turn completed.",
                },
              },
            },
          };
          cancelledTurns.add(active.turnId);
          const recorded = recordProjection(sessionId, params) ?? params;
          state.completedTurns.push({
            turn_id: active.turnId,
            thread_id: active.threadId,
            state: "interrupted",
            error: "connection_closed",
          });
          state.activeTurn = null;
          state.interaction = null;
          for (const openSocket of state.sockets) {
            if (openSocket.readyState === WebSocket.OPEN) {
              openSocket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "projection/envelope",
                  params: recorded,
                }),
              );
            }
          }
        }
      }
    }
  });
  socket.on("message", (bytes) => {
    let request;
    try {
      request = JSON.parse(bytes.toString());
    } catch {
      socket.close(1003, "invalid JSON-RPC frame");
      return;
    }
    if (
      !request ||
      typeof request !== "object" ||
      request.jsonrpc !== "2.0" ||
      typeof request.id !== "string" ||
      typeof request.method !== "string"
    ) {
      socket.close(1003, "invalid JSON-RPC request");
      return;
    }
    const sessionId = request.params?.session_id ?? "coding:local:main";
    if (request.params?.session_id && request.method !== "session/open") {
      const scope = sessionScopeFor(
        sessionId,
        request.params,
        connectionProfileId,
      );
      if (!scope.ok) {
        rejectSessionScope(socket, request.id, scope);
        return;
      }
      if (
        new Set([
          "session/hydrate",
          "session/fork",
          "session/rollback",
          "snapshot/list",
          "snapshot/restore",
          "turn/start",
          "turn/interrupt",
          "approval/respond",
          "user_question/respond",
          "peer/prepare",
          "peer/gather",
        ]).has(request.method) &&
        !openedSessionsBySocket.get(socket)?.has(sessionId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown session: ${sessionId}`,
        );
        return;
      }
    }
    if (request.method === "config/capabilities/list") {
      reply(socket, request.id, { capabilities: capabilitiesFor(socket) });
      return;
    }
    if (WORKSPACE_BROWSE_METHODS.includes(request.method)) {
      // A connection that was never advertised the feature must not be able
      // to reach it by guessing the method name.
      if (!workspaceBrowseSockets.has(socket)) {
        replyError(
          socket,
          request.id,
          -32_601,
          `unknown method: ${request.method}`,
          { kind: "profile_local_unsupported" },
        );
        return;
      }
      if (request.method === "onboarding/workspace_list") {
        handleWorkspaceList(socket, request);
      } else {
        handleWorkspaceCreate(socket, request);
      }
      return;
    }
    if (typeof sessionId !== "string" || !sessionId) {
      replyError(
        socket,
        request.id,
        -32602,
        "session_id must be a non-empty string",
      );
      return;
    }
    if (request.method === DRIVER_GET_METHOD) {
      const state = sessionStateBySessionId.get(sessionId);
      const opened = openedSessionsBySocket.get(socket)?.has(sessionId);
      // A peer-control Session reuses the SAME get method but discloses an
      // ACTIVE external binding (nonzero lease) so readiness settles `ready`.
      if (isPeerControlState(state) && opened) {
        reply(socket, request.id, peerControlDriverResponse(state));
        return;
      }
      if (!isDriverState(state) || !opened) {
        replyError(
          socket,
          request.id,
          -32_004,
          "No opened driver-discovery Session",
        );
        return;
      }
      driverReply(socket, request);
      return;
    }
    if (
      request.method === SESSION_DRIVER_ACQUIRE ||
      request.method === SESSION_DRIVER_RENEW ||
      request.method === SESSION_DRIVER_RELEASE
    ) {
      const state = sessionStateBySessionId.get(sessionId);
      if (
        !isPeerControlState(state) ||
        !openedSessionsBySocket.get(socket)?.has(sessionId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown method: ${request.method}`,
        );
        return;
      }
      if (request.method === SESSION_DRIVER_ACQUIRE) {
        // Record the minted fence: every later control/dispatch must present
        // THIS epoch + token or refuse as `driver_fence_stale`.
        peerAcquires.set(state.sessionId, {
          epoch: DRIVER_EPOCH,
          control_token: PEER_CONTROL_TOKEN,
          driver_id: request.params.driver_id,
          lease_expires_at_ms: DRIVER_LEASE_EXPIRES_AT_MS,
        });
        // An acquire makes the binding external-held for ADMISSION purposes
        // even before any dispatch: the Core refuses `turn/start` with
        // ExternalMasterHeld while ANY external fence holds the Session.
        peerDriverModes.set(state.sessionId, "external");
        reply(socket, request.id, peerControlAcquireResponse(state, request));
        return;
      }
      if (request.method === SESSION_DRIVER_RENEW) {
        reply(socket, request.id, {
          lease_expires_at_ms: DRIVER_LEASE_EXPIRES_AT_MS,
        });
        return;
      }
      const next = request.params?.next;
      if (next === "internal") {
        peerDriverModes.set(state.sessionId, "internal");
        // Hand-back retires the SEEDED synthetic active turn the control
        // fixture planted on the MASTER session (it exists only so the seat's
        // target resolves). The adopted peer's OWN turn lives in its own
        // Session and keeps running; the master must accept chat again.
        if (
          state.activeTurn?.turnId === PEER_CONTROL_ACTIVE_TURN_ID &&
          state.activeTurn.ownerSocket === null
        ) {
          state.activeTurn = null;
          heldTerminals.delete(state.sessionId);
        }
      } else if (next === "external") {
        peerDriverModes.set(state.sessionId, "external");
        const acquired = peerAcquires.get(state.sessionId);
        if (acquired) acquired.lease_expires_at_ms = 0;
      }
      reply(socket, request.id, peerControlReleaseResponse(state, request));
      return;
    }
    if (request.method === PEER_CONTROL_METHOD) {
      const state = sessionStateBySessionId.get(sessionId);
      if (
        !isPeerControlState(state) ||
        !openedSessionsBySocket.get(socket)?.has(sessionId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown method: ${PEER_CONTROL_METHOD}`,
        );
        return;
      }
      const variant = effectivePeerControlVariant(state);
      // Typed driver_fence_stale: the stale variant surfaces the allowlisted
      // refusal kind through the error `data.kind`, never the raw message.
      if (variant === "stale") {
        recordPeerControlCall(sessionId, "fence_stale");
        replyError(socket, request.id, -32_043, "fixture fence stale", {
          kind: "driver_fence_stale",
        });
        return;
      }
      // REFUSED receipt: a deny_unknown_fields frame with only state:"refused".
      if (variant === "refused") {
        recordPeerControlCall(sessionId, "refused");
        reply(socket, request.id, peerControlRefusedReceipt(state, request));
        return;
      }
      // (e) Live fence: a presented epoch/control_token that does not match the
      // last acquire is stale (Core ui_protocol.rs:645), refused BEFORE any
      // receipt work and disclosed typed through `data.kind`.
      if (peerFenceStale(state, request.params)) {
        recordPeerControlCall(sessionId, "fence_stale");
        replyError(
          socket,
          request.id,
          -32_043,
          "fence does not match the last acquire",
          { kind: "driver_fence_stale" },
        );
        return;
      }
      const duplicate = variant === "duplicate";
      recordPeerControlCall(sessionId, duplicate ? "duplicate" : "accepted");
      reply(
        socket,
        request.id,
        peerControlAcceptedReceipt(state, request, duplicate),
      );
      return;
    }
    if (request.method === PEER_DISPATCH_METHOD) {
      const state = sessionStateBySessionId.get(sessionId);
      if (
        !isPeerControlState(state) ||
        !openedSessionsBySocket.get(socket)?.has(sessionId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown method: ${PEER_DISPATCH_METHOD}`,
        );
        return;
      }
      const variant = peerDispatchVariant(state);
      if (variant === "refused") {
        recordPeerDispatchCall(sessionId, "refused");
        // The Core has no "refused dispatch receipt": the ONE refusal a
        // `refused` workspace can stand for is an unadvertised lane, so it
        // carries the SAME typed kind as the lane gate below — as an ERROR.
        replyError(
          socket,
          request.id,
          -32602,
          "driver operation refused: peer/dispatch",
          { kind: "driver_model_unavailable" },
        );
        return;
      }
      if (variant === "stale") {
        recordPeerDispatchCall(sessionId, "fence_stale");
        // Symmetric with the `peer/control` stale arm (:2561-2566): a stale
        // control lease refuses BOTH leaves through the SAME typed error the
        // Core's `driver_store_error_to_rpc` emits for StaleEpoch/LeaseExpired/
        // BadProof (ui_protocol_transport.rs:19222-19224) — never a receipt.
        replyError(
          socket,
          request.id,
          -32602,
          "driver operation refused: peer/dispatch",
          { kind: "driver_fence_stale" },
        );
        return;
      }
      if (variant === "duplicate") {
        recordPeerDispatchCall(sessionId, "duplicate");
        reply(
          socket,
          request.id,
          peerDispatchAcceptedReceipt(state, request, true),
        );
        return;
      }
      // (e) Live fence, checked BEFORE any lane/staging work.
      if (peerFenceStale(state, request.params)) {
        recordPeerDispatchCall(sessionId, "fence_stale");
        replyError(
          socket,
          request.id,
          -32602,
          "driver operation refused: peer/dispatch",
          { kind: "driver_fence_stale" },
        );
        return;
      }
      // (a)+(c) Lane gate: ONLY an advertised sub_provider KEY is accepted;
      // anything else refuses typed BEFORE any staging or kickoff — never a
      // silent fallback to the primary model.
      if (!peerLaneKeys().includes(request.params?.model)) {
        recordPeerDispatchCall(sessionId, "model_unavailable");
        replyError(
          socket,
          request.id,
          -32602,
          "driver operation refused: peer/dispatch",
          { kind: "driver_model_unavailable" },
        );
        return;
      }
      // (b) Idempotency: an equal retry returns the ORIGINAL immutable receipt
      // flagged `duplicate:true`; the same id with a DIFFERENT digest is a
      // typed conflict — never a second adoption.
      const digest = peerDispatchDigest(request.params);
      const records = dispatchRecordsFor(state);
      const existing = records.get(request.params.operation_id);
      if (existing) {
        if (existing.digest === digest) {
          recordPeerDispatchCall(sessionId, "duplicate");
          reply(socket, request.id, { ...existing.receipt, duplicate: true });
          return;
        }
        recordPeerDispatchCall(sessionId, "conflict");
        replyError(
          socket,
          request.id,
          -32602,
          "driver operation refused: peer/dispatch",
          { kind: "driver_operation_conflict" },
        );
        return;
      }
      // (d) Fresh accept: persist the immutable receipt FIRST, then stage the
      // adopted peer Session for the SAME owner socket, then reply.
      const receipt = peerDispatchAcceptedReceipt(state, request, false);
      records.set(request.params.operation_id, { digest, receipt });
      stageDispatchedPeer(
        state,
        receipt.slug,
        state.sessionId,
        request.params?.dispatch?.brief ?? "",
      );
      recordPeerDispatchCall(sessionId, "accepted");
      reply(socket, request.id, receipt);
      return;
    }
    if (request.method === PEER_SUB_PROVIDERS_METHOD) {
      // (c) The sanctioned lane source: >= 2 lanes (keys + models) on a
      // `peer-control-*` workspace; unadvertised (and unanswered) elsewhere.
      const workspaceRoot = openedWorkspaceBySocket.get(socket);
      if (!workspaceRoot?.startsWith(peerControlPrefix)) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown method: ${PEER_SUB_PROVIDERS_METHOD}`,
        );
        return;
      }
      reply(socket, request.id, {
        profile_id: request.params?.profile_id ?? defaultProfileId,
        sub_providers: PEER_CONTROL_LANES,
      });
      return;
    }
    // turn/state/get is also a base capability: non-native Sessions fall
    // through to the generic lookup below instead of being refused.
    const genericTurnStateGet =
      request.method === "turn/state/get" &&
      !isNativeState(sessionStateBySessionId.get(sessionId));
    if (nativeMethods.has(request.method) && !genericTurnStateGet) {
      const state = sessionStateBySessionId.get(sessionId);
      if (
        !isNativeState(state) ||
        !openedSessionsBySocket.get(socket)?.has(sessionId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          "No opened native-workflow Session",
        );
        return;
      }
      handleNativeRequest(socket, request, state);
      return;
    }
    const { permission, taskState } = sessionState(sessionId);
    if (request.method === "launch/resolve") {
      const cwd = request.params?.cwd ?? "";
      const profile = request.params?.profile_id || "_main";
      const result = cwd.endsWith("/no-profile")
        ? createdProfileId
          ? { decision: "activate", resolved_profile: createdProfileId }
          : { decision: "no_profile" }
        : cwd.endsWith("/cross")
          ? {
              decision: "cross_profile",
              resolved_profile: profile,
              existing_profiles: ["review"],
            }
          : cwd.endsWith("/new")
            ? { decision: "activate", resolved_profile: profile }
            : { decision: "resume", resolved_profile: profile };
      reply(socket, request.id, result);
      return;
    }
    if (request.method === "profile/llm/catalog") {
      reply(socket, request.id, {
        families: {
          zai: {
            env: "ZAI_API_KEY",
            models: [
              {
                id: "glm-5.3-flash",
                endpoints: [
                  {
                    id: "official",
                    label: "Z.AI Coding Plan",
                    base_url: "https://api.z.ai/api/coding/paas/v4",
                    api_key_env: "ZAI_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
              {
                id: "glm-5.3",
                endpoints: [
                  {
                    id: "official",
                    label: "Z.AI Coding Plan",
                    base_url: "https://api.z.ai/api/coding/paas/v4",
                    api_key_env: "ZAI_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
            ],
          },
          deepseek: {
            env: "DEEPSEEK_API_KEY",
            models: [
              {
                id: "deepseek-chat",
                endpoints: [
                  {
                    id: "openrouter",
                    label: "OpenRouter",
                    base_url: "https://openrouter.ai/api/v1",
                    api_key_env: "OPENROUTER_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
            ],
          },
          ollama: {
            env: "",
            models: [{ id: "qwen3", endpoints: [] }],
          },
        },
      });
      return;
    }
    if (request.method === "profile/llm/list") {
      const profileId = profileIdFor(socket, request.params);
      if (!request.params?.session_id) {
        reply(socket, request.id, profileModelConfiguration(profileId));
        return;
      }
      reply(socket, request.id, {
        session_id: sessionId,
        models: configuredModelsForProfile(profileId).map(sessionModel),
      });
      return;
    }
    if (request.method === "profile/llm/select") {
      const modelId = request.params?.model_id;
      const familyId = request.params?.family_id;
      const routeId = request.params?.route_id ?? "official";
      const configured = configuredModelsForProfile(
        profileIdFor(socket, request.params),
      );
      const selected = configured.find(
        (model) =>
          model.model_id === modelId &&
          model.family_id === familyId &&
          model.route.route_id === routeId,
      );
      if (!selected) {
        replyError(socket, request.id, -32602, "Model is not configured");
        return;
      }
      const profileId = profileIdFor(socket, request.params);
      for (const model of configured) model.selected = model === selected;
      const runtimeModel =
        effectiveRuntimeModelByProfile.get(profileId) ?? defaultRuntimeModel;
      reply(socket, request.id, {
        session_id: sessionId,
        selected: {
          ...sessionModel(selected),
          selected: true,
        },
        applied: true,
        restart_required: true,
        runtime_policy_stamp: runtimePolicyStamp(
          profileId,
          runtimeModel,
          permission,
        ),
      });
      return;
    }
    if (request.method === "profile/local/create") {
      // Core owns the final id and may normalize or suffix a colliding request.
      // Keeping this fixture non-equal prevents the Web onboarding flow from
      // treating requested_id as authoritative.
      createdProfileId =
        request.params.requested_id === "coding"
          ? "coding-2"
          : request.params.requested_id;
      reply(socket, request.id, {
        profile_id: createdProfileId,
        user_id: `user-${createdProfileId}`,
        name: request.params.name,
        username: request.params.username,
        email: request.params.email,
        created: true,
        runtime_mode: "solo",
      });
      return;
    }
    if (request.method === "profile/llm/test") {
      const rejected = request.params.api_key === "sk-rejected-secret";
      const invalidKeylessProbe =
        request.params.selection?.family_id === "ollama" &&
        request.params.api_key !== "octoscode-web-keyless-probe";
      const applied = !rejected && !invalidKeylessProbe;
      reply(socket, request.id, {
        profile_id: request.params.profile_id,
        applied,
        message: applied
          ? "Provider test succeeded"
          : rejected
            ? "Provider rejected the supplied credential"
            : "Keyless compatibility probe missing",
        ...(!applied
          ? {
              error: rejected
                ? "Provider rejected the supplied credential"
                : "Keyless compatibility probe missing",
            }
          : {}),
      });
      return;
    }
    if (request.method === "profile/llm/fetch_models") {
      const familyId = request.params.selection?.family_id;
      const route = request.params.selection?.route;
      const profileId = profileIdFor(socket, request.params);
      const savedCredential = configuredModelsForProfile(profileId).some(
        (model) =>
          model.family_id === familyId &&
          model.route.route_id === route?.route_id &&
          model.has_api_key,
      );
      if (
        !request.params.api_key &&
        !savedCredential &&
        familyId !== "ollama"
      ) {
        reply(socket, request.id, {
          profile_id: profileId,
          family_id: familyId,
          models: [],
          reason: "no_api_key",
        });
        return;
      }
      const discovered =
        familyId === "zai"
          ? ["glm-5.3-flash", "glm-5.3", "glm-5.2"]
          : familyId === "deepseek"
            ? ["deepseek-chat", "deepseek-reasoner"]
            : familyId === "ollama"
              ? ["qwen3", "gpt-oss:20b"]
              : [];
      reply(socket, request.id, {
        profile_id: profileId,
        family_id: familyId,
        models: discovered,
        ...(discovered.length ? {} : { reason: "provider_unavailable" }),
      });
      return;
    }
    if (request.method === "profile/llm/upsert") {
      const profileId = profileIdFor(socket, request.params);
      const selection = request.params.selection;
      const route = selection?.route;
      const configured = configuredModelsForProfile(profileId);
      const existing = configured.find(
        (model) =>
          model.family_id === selection?.family_id &&
          model.model_id === selection?.model_id &&
          model.route.route_id === route?.route_id,
      );
      const next = existing ?? {
        family_id: selection?.family_id,
        model_id: selection?.model_id,
        route: {},
        has_api_key: false,
        selected: false,
        available: true,
      };
      next.route = {
        route_id: route?.route_id,
        label: route?.label,
        base_url: route?.base_url,
        api_key_env: route?.api_key_env,
        api_type: route?.api_type,
      };
      if (request.params.api_key) next.has_api_key = true;
      if (!existing) configured.push(next);
      if (
        request.params.set_primary ||
        !configured.some((model) => model.selected)
      ) {
        for (const model of configured) model.selected = model === next;
      }
      reply(socket, request.id, {
        profile_id: profileId,
        applied: true,
      });
      return;
    }
    if (request.method === "profile/llm/delete") {
      const profileId = profileIdFor(socket, request.params);
      const configured = configuredModelsForProfile(profileId);
      const index = configured.findIndex(
        (model) =>
          model.family_id === request.params.family_id &&
          model.model_id === request.params.model_id &&
          model.route.route_id === request.params.route_id,
      );
      if (index < 0) {
        replyError(socket, request.id, -32602, "Model is not configured");
        return;
      }
      const [deleted] = configured.splice(index, 1);
      if (deleted?.selected && configured[0]) configured[0].selected = true;
      reply(socket, request.id, {
        ...profileModelConfiguration(profileId),
        applied: true,
      });
      return;
    }
    if (request.method === "session/open") {
      const scope = sessionScopeFor(
        sessionId,
        request.params,
        connectionProfileId,
      );
      if (!scope.ok) {
        rejectSessionScope(socket, request.id, scope);
        return;
      }
      if (rejectNextSessionOpen) {
        rejectNextSessionOpen = false;
        replyError(
          socket,
          request.id,
          -32_041,
          "Fixture rejected the candidate session/open",
        );
        return;
      }
      if (rejectedSessionIds.has(sessionId)) {
        replyError(
          socket,
          request.id,
          -32_040,
          "The saved Session is no longer available",
        );
        return;
      }
      // Opening a staged peer binds its exact scope to this transport. It
      // becomes active only after a separate UUID turn/start is admitted.
      const staged = stagedPeers.get(sessionId);
      if (staged?.closed) {
        replyError(socket, request.id, -32_040, "This peer Session is closed");
        return;
      }
      if (staged) {
        if (connectionProfileId && staged.profileId !== connectionProfileId) {
          rejectSessionScope(
            socket,
            request.id,
            scopeMismatch(
              "peer session is outside the authenticated profile",
              staged.profileId,
              connectionProfileId,
              true,
            ),
          );
          return;
        }
      }
      const profileId = scope.profileId;
      const existingState = sessionStateBySessionId.get(sessionId);
      const workspaceRoot =
        request.params?.cwd ??
        staged?.workspaceRoot ??
        existingState?.workspaceRoot ??
        defaultWorkspace;
      if (
        (existingState?.workspaceRoot &&
          existingState.workspaceRoot !== workspaceRoot) ||
        (staged &&
          (staged.profileId !== profileId ||
            staged.workspaceRoot !== workspaceRoot))
      ) {
        replyError(
          socket,
          request.id,
          -32602,
          "Session workspace or profile binding does not match",
        );
        return;
      }
      const state = sessionState(sessionId);
      if (staged) admittedPeers.add(sessionId);
      state.profileId = staged?.profileId ?? profileId;
      state.workspaceRoot = staged?.workspaceRoot ?? workspaceRoot;
      // A peer-control Session carries ONE synthetic LIVE turn: the control
      // seat's target identity requires the selected record's live turn to be a
      // protocol UUID (`peerControlTargetFor`). Peer-owned with no socket, so a
      // transport close never fabricates an interrupted terminal for it, and
      // `resumePendingTurn` cannot re-dispatch it (hash is already attempted via
      // reconcileFromHydrate). Seeded once per Session, not on reopen.
      // (Dispatched peer Sessions are EXCLUDED: their live turn is the
      // receipt's adopted_turn_id, so seeding the control seat's synthetic
      // turn here would contradict the adopted identity.)
      if (
        isPeerControlState(state) &&
        !peerControlVariant(state).startsWith("handover") &&
        !state.sessionId.includes("#peer-") &&
        state.activeTurn === null
      ) {
        state.activeTurn = {
          turnId: PEER_CONTROL_ACTIVE_TURN_ID,
          threadId: PEER_CONTROL_ACTIVE_TURN_ID,
          ownerSocket: null,
          ownerKind: "peer",
          emitSeq: { value: 0 },
          holdTerminal: false,
        };
      }
      state.sockets.add(socket);
      const openedSessions = openedSessionsBySocket.get(socket);
      if (openedSessions) {
        openedSessions.add(sessionId);
      } else {
        openedSessionsBySocket.set(socket, new Set([sessionId]));
      }
      openedWorkspaceBySocket.set(socket, workspaceRoot);
      openedProfileBySocket.set(socket, profileId);
      const workspaceSessions = sessionsByWorkspace.get(workspaceRoot) ?? [];
      if (!workspaceSessions.some((session) => session.id === sessionId)) {
        sessionsByWorkspace.set(workspaceRoot, [
          {
            id: sessionId,
            message_count: 0,
            title: "New coding session",
            updated_at: new Date().toISOString(),
          },
          ...workspaceSessions,
        ]);
      }
      reply(socket, request.id, {
        opened: {
          session_id: sessionId,
          active_profile_id: profileId,
          workspace_root: workspaceRoot,
          cursor: {
            stream: sessionId,
            seq: state.log.seq,
          },
          capabilities: capabilitiesFor(socket, state),
        },
      });
      for (const event of state.log.events) {
        if (
          !request.params.after ||
          event.cursor.seq > request.params.after.seq
        ) {
          notifyRpc(socket, "projection/envelope", event);
        }
      }
      return;
    }
    if (request.method === "session/hydrate") {
      const openedSessionIds = openedSessionsBySocket.get(socket);
      if (!openedSessionIds || !openedSessionIds.has(sessionId)) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown session: ${sessionId}`,
        );
        return;
      }
      const heldForSession =
        heldTurnStart?.socket === socket &&
        heldTurnStart.sessionId === sessionId
          ? heldTurnStart
          : null;
      const state = sessionStateBySessionId.get(sessionId);
      if (!state) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown session: ${sessionId}`,
        );
        return;
      }
      // Adopt a question the previous owner left parked when it disconnected
      // (see the close handler): the hydrating client becomes its owner, so a
      // restored takeover can actually be answered.
      if (state.interaction?.ownerSocket === null) {
        state.interaction.ownerSocket = socket;
        if (state.activeTurn && state.activeTurn.ownerSocket === null)
          state.activeTurn.ownerSocket = socket;
      }
      const replayedEvents = isDurableSessionId(sessionId)
        ? state.log.events
        : [];
      const parkedInteraction = state.interaction ?? null;
      const demoTranscript = isDurableSessionId(sessionId)
        ? state.messages.map((message) => ({ ...message }))
        : [
            {
              seq: 1,
              role: "user",
              content: MARKDOWN_TRANSCRIPT_PROMPT,
              turn_id: "fixture-turn",
              persisted_at: "2026-08-26T00:00:00Z",
              media: [],
            },
            {
              seq: 2,
              role: "assistant",
              content: MARKDOWN_TRANSCRIPT_ANSWER,
              turn_id: "fixture-turn",
              thread_id: "fixture-thread",
              message_id: "fixture-message",
              persisted_at: "2026-08-26T00:00:01Z",
              media: [],
            },
          ];
      const result = {
        session_id: sessionId,
        cursor: { stream: sessionId, seq: state.log.seq },
        messages: demoTranscript,
        turns: [
          ...state.completedTurns,
          ...(state.activeTurn
            ? [
                {
                  turn_id: state.activeTurn.turnId,
                  state: "active",
                  thread_id: state.activeTurn.threadId,
                },
              ]
            : []),
          ...(!isDurableSessionId(sessionId) &&
          !state.activeTurn &&
          state.completedTurns.length === 0
            ? [
                {
                  turn_id: "fixture-turn",
                  state: "completed",
                  thread_id: "fixture-thread",
                },
              ]
            : []),
        ],
        pending_approvals:
          (heldForSession?.text === "Request approval fixture" ||
            heldForSession?.text ===
              "Resolve approval during recovery fixture") &&
          !parkedInteraction
            ? [approvalRequest(sessionId, heldForSession.turnId)]
            : parkedInteraction?.kind === "approval"
              ? [approvalRequest(sessionId, parkedInteraction.turnId)]
              : [],
        pending_questions:
          parkedInteraction?.kind === "question"
            ? [
                {
                  session_id: sessionId,
                  question_id: parkedInteraction.id,
                  turn_id: parkedInteraction.turnId,
                  title: "Choose verification depth",
                  body: "Octos needs one product decision.",
                  questions: [
                    {
                      header: "Checks",
                      question: "Which checks should run?",
                      options: [
                        { label: "Fast", description: "Unit tests only" },
                        { label: "Full", description: "All product gates" },
                      ],
                      multi_select: false,
                      allow_free_text: false,
                    },
                  ],
                },
              ]
            : [],
        // Core hydrates persisted messages/turns separately from tool replay;
        // ordinary message deltas and terminals are not a second transcript.
        ...(replayedEvents.length
          ? {
              replayed_tool_envelopes: replayedEvents
                .filter((event) =>
                  ["tool_start", "tool_progress", "tool_end"].includes(
                    event.payload.type,
                  ),
                )
                .map((event) => ({
                  session_id: sessionId,
                  thread_id: event.thread_id,
                  seq: event.seq,
                  cursor: event.cursor,
                  turn_id: event.turn_id,
                  payload: event.payload,
                })),
            }
          : {}),
        // Native context state is an estimate, not billed input usage and
        // not a fabricated model-window occupancy percentage.
        context_state: {
          session_id: sessionId,
          generation: 1,
          token_estimate: 10_000,
          item_count: state.messages.length,
          recovery_state: "ready",
        },
      };
      if (nativeHolds.get(sessionId)?.has("session/hydrate")) {
        nativeReply(socket, request, result);
      } else if (state.holdHydrate) {
        state.holdHydrate = false;
        heldHistoryHydrates.set(sessionId, {
          socket,
          release: () => reply(socket, request.id, result),
        });
      } else if (delayedHydrateSockets.delete(socket)) {
        if (
          heldForSession?.text === "Buffer approval during recovery fixture"
        ) {
          setTimeout(
            () =>
              notifyRpc(
                socket,
                "approval/requested",
                approvalRequest(sessionId, heldForSession.turnId),
              ),
            50,
          );
        }
        if (
          heldForSession?.text === "Resolve approval during recovery fixture"
        ) {
          setTimeout(
            () =>
              notifyRpc(socket, "approval/decided", {
                session_id: sessionId,
                approval_id: `approval-${heldForSession.turnId}`,
                turn_id: heldForSession.turnId,
                decision: "allow",
              }),
            50,
          );
        }
        setTimeout(() => reply(socket, request.id, result), 150);
      } else {
        reply(socket, request.id, result);
      }
      return;
    }
    if (request.method === "turn/state/get") {
      // Generic (non-native) turn lookup. Native-workflow Sessions answer
      // through handleNativeRequest; every Session must still be opened on
      // this socket before its turns can be queried.
      if (!openedSessionsBySocket.get(socket)?.has(sessionId)) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown session: ${sessionId}`,
        );
        return;
      }
      const turnId = request.params?.turn_id;
      if (typeof turnId !== "string" || !turnId) {
        replyError(socket, request.id, -32602, "turn_id is required");
        return;
      }
      const held =
        heldTurnStart?.sessionId === sessionId &&
        heldTurnStart.turnId === turnId;
      const turnState = sessionStateBySessionId.get(sessionId);
      const completed = turnState?.completedTurns.find(
        (turn) => turn.turn_id === turnId,
      );
      const active = held || turnState?.activeTurn?.turnId === turnId;
      const remembered = turnStateBySession.get(sessionId)?.get(turnId);
      // A remembered "active" without a live active turn is stale (its
      // terminal was authored outside notify), so it stays unknown.
      const settled = remembered === "active" ? undefined : remembered;
      reply(socket, request.id, {
        session_id: sessionId,
        turn_id: turnId,
        state: active
          ? "active"
          : (completed?.state ??
            settled ??
            (turnId === "fixture-turn" ? "completed" : "unknown")),
      });
      return;
    }
    if (
      [
        "session/fork",
        "session/rollback",
        "snapshot/list",
        "snapshot/restore",
      ].includes(request.method)
    ) {
      const state = sessionState(sessionId);
      if (
        request.method !== "snapshot/list" &&
        (state.activeTurn || state.interaction)
      ) {
        replyError(
          socket,
          request.id,
          -32_050,
          "Settle the owning Session before changing history",
        );
        return;
      }
      if (request.method === "snapshot/list") {
        reply(socket, request.id, {
          session_id: sessionId,
          enabled: true,
          available: true,
          snapshots: fixtureSnapshots,
        });
      } else if (request.method === "snapshot/restore") {
        if (
          !fixtureSnapshots.some(
            (snapshot) => snapshot.id === request.params.snapshot_id,
          )
        ) {
          replyError(socket, request.id, -32602, "Unknown workspace snapshot");
          return;
        }
        holdHistoryRefreshAfterMutation(sessionId);
        reply(socket, request.id, {
          session_id: sessionId,
          restored: request.params.snapshot_id,
          snapshots: fixtureSnapshots,
        });
      } else if (request.method === "session/fork") {
        const name = request.params.new_chat_id;
        if (
          typeof name !== "string" ||
          !name ||
          Buffer.byteLength(name) > 50 ||
          /[#:/\p{Cc}]/u.test(name) ||
          name.toLowerCase() === "default"
        ) {
          replyError(
            socket,
            request.id,
            -32602,
            "Invalid conversation fork name",
          );
          return;
        }
        const childId = sessionId.split("#")[0] + "#" + name;
        if (sessionStateBySessionId.has(childId)) {
          replyError(
            socket,
            request.id,
            -32602,
            "Conversation fork already exists",
          );
          return;
        }
        const child = sessionState(childId);
        child.workspaceRoot = state.workspaceRoot;
        child.profileId = state.profileId;
        child.messages = structuredClone(state.messages);
        child.completedTurns = structuredClone(state.completedTurns);
        child.startedTurnIds = new Set(state.startedTurnIds);
        forkedSessions.add(childId);
        holdHistoryRefreshAfterMutation(sessionId);
        reply(socket, request.id, {
          new_session_id: childId,
          parent_session_id: sessionId,
          copied_messages: child.messages.length,
        });
      } else {
        const count = request.params.num_turns;
        const threads = [
          ...new Set(
            state.messages
              .filter((message) => message.role === "user" && message.thread_id)
              .map((message) => message.thread_id),
          ),
        ];
        if (
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > threads.length
        ) {
          replyError(socket, request.id, -32602, "Invalid rewind turn count");
          return;
        }
        const dropped = new Set(threads.slice(-count));
        state.messages = state.messages.filter(
          (message) => !dropped.has(message.thread_id),
        );
        state.completedTurns = state.completedTurns.filter(
          (turn) => !dropped.has(turn.thread_id),
        );
        state.log.events = state.log.events.filter(
          (event) => !dropped.has(event.thread_id),
        );
        holdHistoryRefreshAfterMutation(sessionId);
        reply(socket, request.id, {
          dropped_turns: count,
          thread: {
            session_id: sessionId,
            cursor: { stream: sessionId, seq: state.log.seq },
            messages: state.messages,
            turns: state.completedTurns,
            pending_approvals: [],
            pending_questions: [],
          },
        });
      }
      return;
    }
    if (request.method === "turn/start") {
      const state = sessionState(sessionId);
      // UX4-4020 §5.2: while this Session's driver mode is external-held, the
      // Core refuses chat admission with ExternalMasterHeld. The refusal
      // mirrors the Core's shape (a JSON-RPC error whose message names the
      // admission error; the client maps it to the §6 bounded copy).
      if (
        isPeerControlState(state) &&
        peerDriverMode(sessionId) === "external"
      ) {
        replyError(
          socket,
          request.id,
          -32_060,
          "turn admission refused for this session: ExternalMasterHeld",
        );
        return;
      }
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          request.params?.turn_id ?? "",
        ) ||
        state.activeTurn ||
        heldTurnStart?.sessionId === sessionId ||
        state.startedTurnIds.has(request.params.turn_id)
      ) {
        replyError(
          socket,
          request.id,
          -32_050,
          "Turn UUID is invalid, duplicate, or the Session is already active",
        );
        return;
      }
      let admitted = false;
      const admit = () => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        if (admitted) return true;
        if (state.activeTurn) return false;
        admitted = true;
        state.startedTurnIds.add(request.params.turn_id);
        // Canonical per-thread sequence: ONE monotonic counter shared by
        // every event of this turn (user_message, assistant_delta,
        // assistant_persisted, turn_terminal). The terminal authored by a
        // disconnect or an interrupt reads the SAME counter, so no two
        // events of a thread ever carry the same seq.
        const emitSeq = { value: 0 };
        const peerOwned =
          peerHoldNextSessions.delete(sessionId) || holdPeerNextTurn > 0;
        if (peerOwned && holdPeerNextTurn > 0) holdPeerNextTurn -= 1;
        state.activeTurn = {
          turnId: request.params.turn_id,
          threadId: request.params.turn_id,
          ownerSocket: socket,
          ownerKind: peerOwned ? "peer" : "socket",
          emitSeq,
          holdTerminal: holdNextTerminal > 0,
        };
        if (state.activeTurn.holdTerminal) holdNextTerminal -= 1;
        const interaction = streamTurn(
          socket,
          sessionId,
          request.params,
          () => ++projectionCursor,
        );
        if (interaction) {
          // Attach the owner socket to the SAME interaction object the socket
          // handler holds, so respond-side identity comparisons stay exact and
          // a parked record can never be resolved twice or by another session.
          Object.assign(interaction, { ownerSocket: socket });
          interaction.emitSeq = emitSeq;
          state.interaction = interaction;
        }
        return true;
      };
      const accept = () => {
        if (!admit()) return false;
        reply(socket, request.id, { accepted: true });
        return true;
      };
      const reject = () => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        replyError(
          socket,
          request.id,
          -32_050,
          "Fixture rejected turn/start before acceptance",
        );
        return true;
      };
      if (holdNextTurnStartAcknowledgement) {
        holdNextTurnStartAcknowledgement = false;
        heldTurnStart = {
          socket,
          sessionId,
          turnId: request.params.turn_id,
          text: request.params.input?.[0]?.text ?? "",
          accept,
          admit,
          reject,
        };
        return;
      }
      accept();
      return;
    }
    if (request.method === "peer/prepare") {
      const master = sessionStateBySessionId.get(sessionId);
      const count = request.params.n ?? 1;
      if (
        !master ||
        typeof request.params.brief !== "string" ||
        !request.params.brief.trim() ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 8
      ) {
        replyError(socket, request.id, -32602, "Invalid peer fleet request");
        return;
      }
      const staged = stagePeers(
        count,
        master.profileId,
        request.params.cwd ?? master.workspaceRoot,
        sessionId,
        request.params.brief,
      );
      const peers = staged.map(
        ({ slug, topic, profile_id, cwd, brief_path }) => ({
          slug,
          topic,
          profile_id,
          cwd,
          brief_path,
        }),
      );
      reply(socket, request.id, { ...peers[0], peers });
      for (const peer of peers) {
        const event = {
          ...peer,
          session_id: sessionId,
          brief: request.params.brief,
        };
        for (const recipient of master.sockets) {
          if (recipient.readyState !== WebSocket.OPEN) continue;
          notifyRpc(recipient, "peer/staged", event);
          // Replayed delivery must not create a second peer open or kickoff.
          notifyRpc(recipient, "peer/staged", event);
        }
      }
      return;
    }
    if (request.method === "peer/gather") {
      const profileId = sessionStateBySessionId.get(sessionId)?.profileId;
      const slugs = request.params.slugs;
      if (
        slugs !== undefined &&
        (!Array.isArray(slugs) ||
          slugs.some((slug) => typeof slug !== "string"))
      ) {
        replyError(socket, request.id, -32602, "Invalid peer gather filter");
        return;
      }
      const peers = [...stagedPeers]
        .filter(
          ([, peer]) =>
            peer.profileId === profileId &&
            (slugs === undefined || slugs.includes(peer.slug)),
        )
        .map(([id, peer]) => ({
          slug: peer.slug,
          topic: `peer-${peer.slug}`,
          brief: peer.brief,
          brief_truncated: false,
          result: sessionStateBySessionId.get(id)?.completedTurns.length
            ? "Fixture peer completed"
            : null,
          result_truncated: false,
          result_updated_unix: null,
          has_worktree: false,
          closed: peer.closed ?? false,
        }));
      const release = () =>
        reply(socket, request.id, { profile_id: profileId, peers });
      if (gatherRepliesArmed.delete(sessionId))
        heldGatherReplies.set(sessionId, { socket, release });
      else release();
      return;
    }
    if (request.method === "approval/respond") {
      // Strict resolution: the response must name the exact approval id that
      // this Session's canonical record holds. There is no socket-local
      // fallback and no cross-session acceptance.
      const state = sessionStateBySessionId.get(sessionId);
      const parked = state?.interaction ?? null;
      const approvalId = request.params?.approval_id;
      if (
        !parked ||
        parked.kind !== "approval" ||
        parked.id !== approvalId ||
        parked.ownerSocket.readyState !== WebSocket.OPEN ||
        !state.sockets.has(socket)
      ) {
        replyError(
          socket,
          request.id,
          -32_602,
          "No matching approval is pending for this Session",
        );
        return;
      }
      state.interaction = null;
      state.activeTurn = null;
      reply(socket, request.id, {
        approval_id: approvalId,
        accepted: true,
        status: request.params.decision === "approve" ? "approved" : "denied",
        runtime_resumed: true,
      });
      finishInteraction(socket, parked);
      return;
    }
    if (request.method === "user_question/respond") {
      const state = sessionStateBySessionId.get(sessionId);
      const parked = state?.interaction ?? null;
      const questionId = request.params?.question_id;
      if (
        !parked ||
        parked.kind !== "question" ||
        parked.id !== questionId ||
        parked.ownerSocket.readyState !== WebSocket.OPEN ||
        !state.sockets.has(socket)
      ) {
        replyError(
          socket,
          request.id,
          -32_602,
          "No matching question is pending for this Session",
        );
        return;
      }
      state.interaction = null;
      state.activeTurn = null;
      reply(socket, request.id, {
        question_id: questionId,
        accepted: true,
        runtime_resumed: true,
      });
      finishInteraction(socket, parked);
      return;
    }
    if (request.method === "turn/interrupt") {
      // A real interrupt cancels only this Session's active turn:
      // its completion tail is suppressed and an interrupted terminal is
      // persisted + broadcast, exactly like an owner disconnect.
      const state = sessionStateBySessionId.get(sessionId);
      const active = state?.activeTurn ?? null;
      if (
        active &&
        active.ownerSocket === socket &&
        active.ownerKind !== "peer"
      ) {
        if (!active.emitSeq) active.emitSeq = { value: 1 };
        cancelledTurns.add(active.turnId);
        const params = {
          session_id: sessionId,
          thread_id: active.threadId,
          seq: (active.emitSeq.value += 1),
          cursor: { stream: sessionId, seq: 0 },
          turn_id: active.turnId,
          payload: {
            // Structured `turn_terminal.error` (see the disconnect terminal
            // above): v0.10.0's payload guard rejects a bare code string.
            type: "turn_terminal",
            data: {
              outcome: "interrupted",
              error: {
                code: "interrupted_by_user",
                message: "The turn was interrupted by the user.",
              },
            },
          },
        };
        const recorded = recordProjection(sessionId, params) ?? params;
        state.completedTurns.push({
          turn_id: active.turnId,
          thread_id: active.threadId,
          state: "interrupted",
          error: "interrupted_by_user",
        });
        state.activeTurn = null;
        state.interaction = null;
        for (const openSocket of state.sockets) {
          if (openSocket.readyState === WebSocket.OPEN) {
            openSocket.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "projection/envelope",
                params: recorded,
              }),
            );
          }
        }
      }
      if (active && active.ownerKind === "peer") {
        // Fence (audit 0550 G2): a peer-owned turn may not be interrupted from
        // the shared master socket. Refuse the RPC and broadcast a
        // machine-readable fence notice; the turn is left untouched.
        const notice =
          "peer turn fenced: interrupt refused (owned by another Session)";
        replyError(socket, request.id, -32_043, notice);
        for (const openSocket of state.sockets) {
          if (openSocket.readyState === WebSocket.OPEN) {
            notifyRpc(openSocket, "peer/fence", {
              session_id: sessionId,
              turn_id: active.turnId,
              reason: notice,
            });
          }
        }
        return;
      }
      reply(socket, request.id, { accepted: true });
      return;
    }
    if (request.method === "permission/profile/list") {
      reply(socket, request.id, {
        session_id: sessionId,
        current: permission,
        profiles: [
          { mode: "read_only", network: "deny" },
          { mode: "workspace_write", network: "deny" },
          { mode: "workspace_write", network: "allow" },
          { mode: "danger_full_access", network: "allow" },
        ],
      });
      return;
    }
    if (request.method === "permission/profile/set") {
      const updated = { ...permission, ...request.params?.update };
      sessionState(sessionId).permission = updated;
      reply(socket, request.id, {
        session_id: sessionId,
        current: updated,
        applied: true,
      });
      return;
    }
    if (request.method === "diff/preview/get") {
      reply(
        socket,
        request.id,
        diffPreview(sessionId, request.params.preview_id),
      );
      return;
    }
    if (request.method === "session/status/read") {
      const profileId = profileIdFor(socket, request.params);
      const runtimeModel =
        effectiveRuntimeModelByProfile.get(profileId) ?? defaultRuntimeModel;
      reply(socket, request.id, {
        session_id: sessionId,
        runtime_mode: "solo",
        profile_id: profileId,
        workspace_root:
          sessionStateBySessionId.get(sessionId)?.workspaceRoot ??
          defaultWorkspace,
        model: { ...runtimeModel, selected: true },
        sandbox: permission.mode,
        network: permission.network === "allow" ? "allowed" : "blocked",
        approval_policy: "on-request",
        mcp_servers: [],
        runtime_policy_stamp: runtimePolicyStamp(
          profileId,
          runtimeModel,
          permission,
        ),
        usage: {
          input_tokens: 128000,
          output_tokens: 340,
          cached_input_tokens: 64000,
          estimated_cost_micros_usd: 120000,
        },
        health: { status: "ok" },
        cursor: {
          cursor: { stream: sessionId, seq: 10 },
          healthy: true,
          replay_supported: true,
        },
      });
      return;
    }
    if (request.method === "session/list") {
      const workspaceRoot =
        request.params?.cwd ??
        openedWorkspaceBySocket.get(socket) ??
        defaultWorkspace;
      const sessions = sessionsByWorkspace.get(workspaceRoot) ?? [];
      const listedProfile =
        request.params?.profile_id ?? openedProfileBySocket.get(socket);
      reply(
        socket,
        request.id,
        request.params?.cwd &&
          scopedListingWorkspaces.has(workspaceRoot) &&
          listedProfile
          ? {
              sessions,
              workspace_root: workspaceRoot,
              profile_id: listedProfile,
            }
          : { sessions },
      );
      return;
    }
    if (request.method === "session/delete") {
      for (const [workspaceRoot, sessions] of sessionsByWorkspace) {
        sessionsByWorkspace.set(
          workspaceRoot,
          sessions.filter(
            (session) => session.id !== request.params.session_id,
          ),
        );
      }
      const deletedState = sessionStateBySessionId.get(
        request.params.session_id,
      );
      if (deletedState) {
        for (const openSocket of deletedState.sockets) {
          const openedSessions = openedSessionsBySocket.get(openSocket);
          openedSessions?.delete(request.params.session_id);
        }
        sessionStateBySessionId.delete(request.params.session_id);
      }
      reply(socket, request.id, {});
      return;
    }
    if (request.method === "session/files.list") {
      reply(socket, request.id, {
        files: [
          {
            filename: "check.txt",
            path: "pf/coding/reports/check.txt",
            size_bytes: 12400,
            modified_at: "2026-08-26T00:00:00Z",
          },
          {
            filename: "diff.patch",
            path: "pf/coding/reports/diff.patch",
            size_bytes: 8100,
            modified_at: "2026-08-25T23:58:00Z",
          },
        ],
      });
      return;
    }
    if (request.method === "task/list") {
      reply(socket, request.id, {
        session_id: request.params.session_id,
        tasks: [mockTask(taskState)],
      });
      return;
    }
    if (request.method === "task/cancel") {
      sessionState(sessionId).taskState = "cancelled";
      reply(socket, request.id, {
        task_id: request.params.task_id,
        status: "cancelled",
      });
      return;
    }
    if (request.method === "task/output/read") {
      const fullText = [
        "Inspecting changed files…\n",
        "Running pnpm check\n",
        "68 tests passed\n",
      ].join("");
      const offset = request.params.cursor?.offset ?? 0;
      const text = Buffer.from(fullText).subarray(offset).toString("utf8");
      const bytesRead = Buffer.byteLength(text);
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        source: "runtime_projection",
        cursor: request.params.cursor ?? { offset: 0 },
        next_cursor: { offset: offset + bytesRead },
        text,
        bytes_read: bytesRead,
        total_bytes: Buffer.byteLength(fullText),
        truncated: false,
        complete: true,
        live_tail_supported: true,
        is_snapshot_projection: false,
        task_status: taskState,
        runtime_state: taskState,
        lifecycle_state: taskState,
        output_files: ["reports/check.txt"],
        limitations: [],
      });
      return;
    }
    if (request.method === "task/artifact/list") {
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        artifacts: [
          {
            id: "check-report",
            title: "Check report",
            kind: "text",
            status: "ready",
            path: "reports/check.txt",
          },
        ],
      });
      return;
    }
    if (request.method === "task/artifact/read") {
      const pages = ["pnpm check\n68 tests passed\n", "build completed"];
      const page = request.params.cursor?.offset ? 1 : 0;
      const cursor = pages
        .slice(0, page)
        .reduce((offset, content) => offset + Buffer.byteLength(content), 0);
      const nextCursor = cursor + Buffer.byteLength(pages[page]);
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        artifact: {
          id: request.params.artifact_id,
          title: "Check report",
          kind: "text",
          status: "ready",
          path: "reports/check.txt",
        },
        content: pages[page],
        cursor: { offset: cursor },
        next_cursor: { offset: nextCursor },
        has_more: page < pages.length - 1,
      });
      return;
    }
    reply(socket, request.id, { accepted: true });
  });
});

function streamTurn(socket, sessionId, params, nextCursor) {
  const turnId = params.turn_id;
  rememberTurnState(sessionId, turnId, "active");
  const threadId = turnId;
  const text = params.input?.[0]?.text ?? "Fixture prompt";
  const completionDelayMs = text.startsWith(
    "Continue this turn while I open another Session",
  )
    ? 1_500
    : 350;
  // Peer-session activity producer (audit 0550 row 5, see
  // `emitPeerActivityFrame`): a ROOT-composer trigger steers a staged peer's
  // OWN Session frame onto its dock row. The root turn still streams and
  // terminates normally — the peer frame rides the SAME shared owner socket,
  // so nothing about the root Session is perturbed. `turn` -> live,
  // `approval` -> blocked, `resolve` -> clears the block, `complete` -> done.
  const peerTrigger = PEER_ACTIVITY_TRIGGER.exec(text);
  if (peerTrigger)
    emitPeerActivityFrame(socket, peerTrigger[1], peerTrigger[2]);
  notify(socket, sessionId, threadId, turnId, 1, nextCursor(), "user_message", {
    text,
    files: [],
  });
  // plan.todos.v1: only the plan fixture streams a checklist, so every other
  // spec keeps a composer with nothing pinned above it.
  if (planFixtureSockets.has(socket) && text.startsWith(PLAN_FIXTURE_PROMPT)) {
    planFixtureTurn = { socket, sessionId, turnId, step: 0 };
    sendPlanStep(PLAN_FIXTURE_STEPS[0]);
    planFixtureTurn.step = 1;
  }
  if (text === "Request approval fixture") {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "approval/requested",
        params: approvalRequest(sessionId, turnId),
      }),
    );
    return {
      kind: "approval",
      id: `approval-${turnId}`,
      sessionId,
      threadId,
      turnId,
      nextCursor,
    };
  }
  if (
    text === "Topic scope approval fixture" ||
    text === "Topic scope question fixture"
  ) {
    const kind =
      text === "Topic scope approval fixture" ? "approval" : "question";
    // Admit and park the real owner interaction, but leave its notification
    // under the scoped fixture control so foreign traffic can arrive first.
    return {
      kind,
      id: `${kind}-${turnId}`,
      sessionId,
      threadId,
      turnId,
      nextCursor,
      topicScopeProbe: true,
    };
  }
  if (text === "Request question fixture") {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "user_question/requested",
        params: questionRequest(sessionId, turnId),
      }),
    );
    return {
      kind: "question",
      id: `question-${turnId}`,
      sessionId,
      threadId,
      turnId,
      nextCursor,
    };
  }
  if (
    text === "Fixture native persisted-before-delta first" ||
    text === "Fixture native persisted-before-delta second"
  ) {
    streamCapturedPersistedOrder(
      socket,
      sessionId,
      turnId,
      text.endsWith("first"),
    );
    return null;
  }
  const reasoningOffset = isNativeState(sessionStateBySessionId.get(sessionId))
    ? 1
    : 0;
  if (reasoningOffset) {
    notify(
      socket,
      sessionId,
      threadId,
      turnId,
      2,
      nextCursor(),
      "reasoning_delta",
      {
        text: `Native workflow reasoning for ${turnId}`,
      },
    );
  }
  notify(
    socket,
    sessionId,
    threadId,
    turnId,
    2 + reasoningOffset,
    nextCursor(),
    "assistant_delta",
    {
      text: "Working on **Markdown**…",
      assistant_segment_id: "segment-1",
    },
  );
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "progress/updated",
      params: {
        session_id: sessionId,
        turn_id: turnId,
        timestamp: new Date().toISOString(),
        metadata: {
          kind: "token_cost_update",
          token_cost: {
            input_tokens: 128000,
            output_tokens: 340,
            session_cost: 0.12,
            currency: "USD",
            model: "deepseek-v4",
            context_window: 1000000,
          },
        },
      },
    }),
  );
  setTimeout(() => {
    // Core rc.11 kills connection-owned turns when the owner disconnects. A
    // fixture turn must therefore NOT fabricate a recorded success after its
    // owner socket closed (durable disconnect, explicit disconnect, or an
    // interrupted turn). Parked sockets stay open, so their late terminals
    // still land; a closed owner simply stops mid-turn with no phantom
    // assistant_persisted/turn_terminal in the Session log.
    if (socket.readyState !== WebSocket.OPEN || cancelledTurns.has(turnId))
      return;
    const emitTail = () => {
      if (socket.readyState !== WebSocket.OPEN || cancelledTurns.has(turnId))
        return;
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "progress/updated",
          params: {
            session_id: sessionId,
            turn_id: turnId,
            timestamp: new Date().toISOString(),
            metadata: {
              kind: "file_mutation",
              file_mutation: {
                path: "apps/web/src/app/App.tsx",
                operation: "write",
                preview_id: "00000000-0000-4000-8000-000000000042",
              },
            },
          },
        }),
      );
      notify(
        socket,
        sessionId,
        threadId,
        turnId,
        3 + reasoningOffset,
        nextCursor(),
        "assistant_persisted",
        {
          text:
            text === MARKDOWN_TRANSCRIPT_PROMPT
              ? MARKDOWN_TRANSCRIPT_ANSWER
              : "Completed with `pnpm check` and **all tests passing**.",
          assistant_segment_id: "segment-1",
          meta: {
            message_id: `message-${turnId}`,
            persisted_at: new Date().toISOString(),
          },
        },
      );
      notify(
        socket,
        sessionId,
        threadId,
        turnId,
        4 + reasoningOffset,
        nextCursor(),
        "turn_terminal",
        {
          outcome: "completed",
          token_usage: { input_tokens: 12, output_tokens: 9 },
        },
      );
      const settleState = sessionStateBySessionId.get(sessionId);
      if (
        settleState &&
        settleState.activeTurn &&
        settleState.activeTurn.turnId === turnId
      ) {
        settleState.completedTurns.push({
          turn_id: turnId,
          thread_id: threadId,
          state: "completed",
        });
        settleState.activeTurn = null;
      }
    };
    // Controlled terminal-release barrier: each /__test__/terminal/hold-next
    // arms ONE future completion tail. When that single turn's tail fires it
    // parks in heldTerminals (keyed by session) until an explicit
    // per-Session release — never holding later turns, so a queued A2 can
    // drain once A1's terminal is released. Release consumes the hold; a
    // test that releases nothing can disarm with /__test__/terminal/reset.
    if (sessionStateBySessionId.get(sessionId)?.activeTurn?.holdTerminal) {
      heldTerminals.set(sessionId, { turnId, emit: emitTail });
      return;
    }
    emitTail();
  }, completionDelayMs);
  return null;
}

/** Isolated reproduction of browser-stream-order.json from a real Core turn. */
function streamCapturedPersistedOrder(socket, sessionId, turnId, first) {
  const segment = `${turnId}:assistant:iteration:2`;
  let sequence = 1;
  const emit = (type, text) => {
    const state = sessionState(sessionId);
    // Rebase the filtered real capture onto contiguous fixture counters. A
    // fabricated gap would trigger hydrate and mask the live-ordering bug.
    notify(
      socket,
      sessionId,
      turnId,
      turnId,
      ++sequence,
      state.log.seq + 1,
      type,
      type === "turn_terminal"
        ? { outcome: "completed" }
        : {
            text,
            assistant_segment_id: segment,
            ...(type === "assistant_persisted"
              ? {
                  meta: {
                    message_id: `message-${turnId}`,
                    persisted_at: new Date().toISOString(),
                  },
                }
              : {}),
          },
    );
  };
  if (first) {
    for (const text of ["ST", "REAM", "_", "ORDER"]) {
      emit("assistant_delta", text);
    }
  }
  const finish = () => {
    if (socket.readyState !== WebSocket.OPEN || cancelledTurns.has(turnId))
      return;
    if (first) {
      emit("assistant_persisted", "STREAM_ORDER_FIRST_COMPLETE");
      for (const text of ["_F", "IR", "ST", "_COMP", "L", "ETE"]) {
        emit("assistant_delta", text);
      }
      emit("turn_terminal");
    } else {
      for (const text of [
        "ST",
        "REAM",
        "_",
        "ORDER",
        "_SEC",
        "OND",
        "_COMP",
        "L",
        "ETE",
      ]) {
        emit("assistant_delta", text);
      }
      emit("assistant_persisted", "STREAM_ORDER_SECOND_COMPLETE");
      emit("turn_terminal");
    }
    const state = sessionState(sessionId);
    state.completedTurns.push({
      turn_id: turnId,
      thread_id: turnId,
      state: "completed",
    });
    state.activeTurn = null;
  };
  setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN || cancelledTurns.has(turnId))
      return;
    if (sessionState(sessionId).activeTurn?.holdTerminal) {
      heldTerminals.set(sessionId, { turnId, emit: finish });
    } else finish();
  }, 350);
}

function approvalRequest(sessionId, turnId) {
  return {
    session_id: sessionId,
    approval_id: `approval-${turnId}`,
    turn_id: turnId,
    tool_name: "shell",
    title: "Run product checks?",
    body: "The agent wants to run the repository checks.",
    approval_kind: "command",
    risk: "medium",
    typed_details: {
      command: { command_line: "pnpm check" },
    },
  };
}

function questionRequest(sessionId, turnId) {
  return {
    session_id: sessionId,
    question_id: `question-${turnId}`,
    turn_id: turnId,
    title: "Choose verification depth",
    body: "Octos needs one product decision.",
    questions: [
      {
        header: "Checks",
        question: "Which checks should run?",
        options: [
          { label: "Fast", description: "Unit tests only" },
          { label: "Full", description: "All product gates" },
        ],
        multi_select: false,
        allow_free_text: false,
      },
    ],
  };
}

function finishInteraction(socket, interaction) {
  // The terminal is a durable per-Session event: record it once and deliver
  // it to every transport that has the Session open (the responding socket
  // and the parked owner socket that originally streamed the interaction).
  const params = {
    session_id: interaction.sessionId,
    thread_id: interaction.threadId,
    seq: 2,
    cursor: {
      stream: interaction.sessionId,
      seq: interaction.nextCursor(),
    },
    turn_id: interaction.turnId,
    payload: {
      type: "turn_terminal",
      data: {
        outcome: "completed",
        token_usage: { input_tokens: 4, output_tokens: 2 },
      },
    },
  };
  // Send the SAME envelope the durable log stores (cursor watermark
  // allocated once), so live and replay are byte-identical.
  const recorded = recordProjection(interaction.sessionId, params) ?? params;
  const state = sessionStateBySessionId.get(interaction.sessionId);
  const recipients = state
    ? new Set([...state.sockets, socket, interaction.ownerSocket])
    : new Set([socket, interaction.ownerSocket]);
  for (const recipient of recipients) {
    if (recipient && recipient.readyState === WebSocket.OPEN) {
      recipient.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "projection/envelope",
          params: recorded,
        }),
      );
    }
  }
  if (state) {
    state.completedTurns.push({
      turn_id: interaction.turnId,
      thread_id: interaction.threadId,
      state: "completed",
    });
    state.activeTurn = null;
    state.interaction = null;
  }
}

function mockTask(state) {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    tool_name: "spawn_agent",
    tool_call_id: "tool-fixture",
    state,
    status: state === "running" ? "checking workspace" : state,
    lifecycle_state: state,
    runtime_state: state,
    source: "model",
    role: "test_worker",
    summary: "Validate product checks",
    artifact_count: 1,
    started_at: "2026-08-26T00:00:00Z",
    updated_at: new Date().toISOString(),
    output_files: ["reports/check.txt"],
  };
}

function diffPreview(sessionId, previewId) {
  return {
    status: "ready",
    source: "pending_store",
    preview: {
      session_id: sessionId,
      preview_id: previewId,
      title: "Mock coding change",
      files: [
        {
          path: "apps/web/src/app/App.tsx",
          status: "modified",
          hunks: [
            {
              header: "@@ -41,3 +41,4 @@ export function App()",
              lines: [
                {
                  kind: "context",
                  content: "  const session = useOctosSession();",
                  old_line: 41,
                  new_line: 41,
                },
                {
                  kind: "removed",
                  content: "  const ready = false;",
                  old_line: 42,
                },
                {
                  kind: "added",
                  content: "  const ready = session.connected;",
                  new_line: 42,
                },
                {
                  kind: "added",
                  content: "  const review = session.diffReview;",
                  new_line: 43,
                },
              ],
            },
          ],
        },
        {
          path: "packages/client/src/coding.ts",
          status: "added",
          hunks: [],
        },
      ],
    },
  };
}

function authTokenFromRequestUrl(requestUrl) {
  const query = requestUrl?.split("?", 2)[1]?.split("#", 1)[0];
  if (!query) return "";
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (key !== "token" && key !== "_token") continue;
    const encoded = separator < 0 ? "" : pair.slice(separator + 1);
    try {
      // Match Core's RFC 3986 query-token behavior: percent-decode without
      // treating a literal plus as a space.
      return decodeURIComponent(encoded);
    } catch {
      return "";
    }
  }
  return "";
}

function authTokenFromUpgradeRequest(request) {
  const authorization = request.headers.authorization;
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const bearer =
    typeof header === "string" ? header.slice("Bearer ".length) : "";
  return header?.startsWith("Bearer ") && bearer
    ? bearer
    : authTokenFromRequestUrl(request.url);
}

function authenticatedProfileForToken(token) {
  return mockProfileAuthToken && token === mockProfileAuthToken
    ? mockProfileAuthId
    : undefined;
}

function sessionScopeFor(sessionId, params, connectionProfileId) {
  if (typeof sessionId !== "string" || !sessionId) {
    return {
      ok: false,
      message: "session_id must be a non-empty string",
      data: undefined,
      authViolation: false,
    };
  }
  const requested = params?.profile_id;
  if (
    requested !== undefined &&
    (typeof requested !== "string" || !requested)
  ) {
    return {
      ok: false,
      message: "profile_id cannot be empty",
      data: undefined,
      authViolation: false,
    };
  }
  const sessionProfileId = profileIdFromSessionId(sessionId);
  if (connectionProfileId) {
    if (requested !== undefined && requested !== connectionProfileId) {
      return scopeMismatch(
        "profile_id is outside the authenticated profile",
        connectionProfileId,
        requested,
        true,
      );
    }
    if (sessionProfileId && sessionProfileId !== connectionProfileId) {
      return scopeMismatch(
        "session_id is outside the authenticated profile",
        connectionProfileId,
        sessionProfileId,
        true,
      );
    }
    return { ok: true, profileId: connectionProfileId };
  }
  if (requested && sessionProfileId && requested !== sessionProfileId) {
    return scopeMismatch(
      "profile_id does not match session_id profile",
      sessionProfileId,
      requested,
      false,
    );
  }
  return {
    ok: true,
    profileId: requested ?? sessionProfileId ?? defaultProfileId,
  };
}

function profileIdFromSessionId(sessionId) {
  const [base] = sessionId.split("#", 1);
  const segments = base.split(":");
  if (
    segments.length >= 3 &&
    !sessionChannels.has(segments[0]) &&
    sessionChannels.has(segments[1])
  ) {
    return segments[0];
  }
  return undefined;
}

function scopeMismatch(
  message,
  expectedProfileId,
  actualProfileId,
  authViolation,
) {
  return {
    ok: false,
    message,
    data: {
      expected_profile_id: expectedProfileId,
      actual_profile_id: actualProfileId,
      ...(authViolation ? { auth_scope_violation: true } : {}),
    },
    authViolation,
  };
}

function rejectSessionScope(socket, id, scope) {
  if (scope.authViolation) {
    socket.close(1008, "auth_expired");
    return;
  }
  replyError(socket, id, -32602, scope.message, scope.data);
}

function profileIdFor(socket, params) {
  const requested =
    typeof params?.profile_id === "string" ? params.profile_id.trim() : "";
  return (
    requested ||
    (typeof params?.session_id === "string"
      ? sessionStateBySessionId.get(params.session_id)?.profileId
      : undefined) ||
    openedProfileBySocket.get(socket) ||
    authenticatedProfileBySocket.get(socket) ||
    defaultProfileId
  );
}

function runtimePolicyStamp(profileId, runtimeModel, permission) {
  return {
    model: runtimeModel.model,
    provider: runtimeModel.provider,
    profile_id: profileId,
    sandbox: permission.mode,
    network: permission.network === "allow" ? "allowed" : "blocked",
    approval_policy: "on-request",
  };
}

function reply(socket, id, result) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function workspaceBrowseListing(path) {
  const folder = workspaceBrowseTree.get(path);
  const entries = [...folder.dirs]
    .sort((left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()),
    )
    .map((name) => {
      const child = workspaceBrowseJoin(path, name);
      return {
        name,
        path: child,
        writable: workspaceBrowseTree.get(child)?.writable === true,
      };
    });
  return {
    canonical_path: path,
    parent_path: workspaceBrowseParent(path),
    writable: folder.writable,
    entries,
    truncated: folder.truncated === true,
    hidden_skipped: folder.hidden,
  };
}

function handleWorkspaceList(socket, request) {
  const refuse = (kind, data = {}) =>
    replyError(socket, request.id, -32_010, "workspace_list refused", {
      kind,
      ...data,
    });
  const raw = request.params?.path;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    refuse("workspace_list_invalid_path");
    return;
  }
  const resolved = workspaceBrowseResolve(raw);
  if (!resolved.ok) {
    refuse(
      `workspace_list_${resolved.kind}`,
      resolved.bannedRoot ? { banned_root: resolved.bannedRoot } : undefined,
    );
    return;
  }
  const path = resolved.path;
  if (workspaceBrowseFiles.has(path)) {
    refuse("workspace_list_not_a_directory");
    return;
  }
  if (workspaceBrowseUnreadable.has(path)) {
    refuse("workspace_list_permission_denied");
    return;
  }
  if (!workspaceBrowseTree.has(path)) {
    refuse("workspace_list_not_found");
    return;
  }
  reply(socket, request.id, workspaceBrowseListing(path));
}

/** Exactly the §2 name rules the real server enforces. */
function workspaceBrowseNameIsValid(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (name !== name.trim()) return false;
  if (Buffer.byteLength(name, "utf8") > 255) return false;
  return ![...name].some((character) => {
    const code = character.codePointAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function handleWorkspaceCreate(socket, request) {
  const refuse = (kind, data = {}) =>
    replyError(socket, request.id, -32_010, "workspace_create refused", {
      kind,
      ...data,
    });
  const name = request.params?.name;
  if (!workspaceBrowseNameIsValid(name)) {
    refuse("workspace_create_invalid_name");
    return;
  }
  const resolved = workspaceBrowseResolve(request.params?.parent);
  if (!resolved.ok) {
    refuse(
      resolved.kind === "root_escape"
        ? "workspace_create_root_escape"
        : "workspace_create_parent_not_found",
      resolved.bannedRoot ? { banned_root: resolved.bannedRoot } : undefined,
    );
    return;
  }
  const parent = resolved.path;
  if (workspaceBrowseFiles.has(parent)) {
    refuse("workspace_create_parent_not_a_directory");
    return;
  }
  const folder = workspaceBrowseTree.get(parent);
  if (!folder) {
    refuse("workspace_create_parent_not_found");
    return;
  }
  if (!folder.writable) {
    refuse("workspace_create_permission_denied");
    return;
  }
  const created = workspaceBrowseJoin(parent, name);
  if (workspaceBrowseFiles.has(created)) {
    refuse("workspace_create_exists_not_directory");
    return;
  }
  if (workspaceBrowseTree.has(created)) {
    // Idempotent success, not an error.
    reply(socket, request.id, { canonical_path: created, created: false });
    return;
  }
  folder.dirs = [...folder.dirs, name];
  workspaceBrowseTree.set(created, {
    writable: true,
    dirs: [],
    hidden: 0,
    truncated: false,
  });
  reply(socket, request.id, { canonical_path: created, created: true });
}

function replyError(socket, id, code, message, data) {
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    }),
  );
}

function takeHeldTurnStart() {
  const controlled = heldTurnStart;
  heldTurnStart = null;
  return controlled;
}

function rememberTurnState(sessionId, turnId, state) {
  let turns = turnStateBySession.get(sessionId);
  if (!turns) {
    turns = new Map();
    turnStateBySession.set(sessionId, turns);
  }
  turns.set(turnId, state);
}

function notify(socket, sessionId, threadId, turnId, seq, cursor, type, data) {
  if (type === "turn_terminal") {
    const outcome = data.outcome;
    rememberTurnState(
      sessionId,
      turnId,
      outcome === "completed"
        ? "completed"
        : outcome === "interrupted"
          ? "interrupted"
          : "errored",
    );
  }
  const active = sessionStateBySessionId.get(sessionId)?.activeTurn;
  if (active?.turnId === turnId)
    active.emitSeq.value = Math.max(active.emitSeq.value, seq);
  const params = {
    session_id: sessionId,
    thread_id: threadId,
    seq,
    cursor: { stream: sessionId, seq: cursor },
    turn_id: turnId,
    payload: { type, data },
  };
  // Store and send the SAME envelope: the durable record allocates the
  // session watermark cursor, so a replay is byte-identical to the live event.
  const recorded = recordProjection(sessionId, params);
  const onWire = recorded ?? params;
  const recipients =
    sessionStateBySessionId.get(sessionId)?.sockets ?? new Set([socket]);
  for (const recipient of recipients)
    if (recipient.readyState === WebSocket.OPEN)
      recipient.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "projection/envelope",
          params: onWire,
        }),
      );
}

function notifyRpc(socket, method, params) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

http.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Octoscode AppUI fixture listening on 127.0.0.1:${port}\n`,
  );
});

const shutdown = () => {
  sockets.close();
  http.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
