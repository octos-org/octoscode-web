#!/usr/bin/env node
/**
 * peer-controller-fixtures.probe.mjs — exercises the peer/dispatch STAGING
 * fixture arms (a)-(e) of `mock-ui-server.mjs` (brief DEEPSEEK-WEB-PC-P3A-
 * MOCK-2820) by speaking the raw ui-protocol wire on ONE socket, with no
 * browser in the loop.
 *
 *   (a) unknown `model` (not an advertised sub_provider key) => typed
 *       `driver_model_unavailable` BEFORE any staging;
 *   (b) repeated `operation_id` + same digest => the SAME receipt with
 *       `duplicate:true`; same id + DIFFERENT digest => `driver_operation_conflict`;
 *   (c) a `peer-control-*` workspace advertises + answers
 *       `profile/sub_providers/list` with >= 2 lanes, and accepts only those keys;
 *   (d) an accepted dispatch stages `<master base>#peer-<slug>` that the SAME
 *       socket can `session/open`, and the existing peer-activity trigger still
 *       emits that peer Session's frames;
 *   (e) `peer/control` / `peer/dispatch` with a fence (epoch/control_token) that
 *       does not match the last acquire => `driver_fence_stale`.
 *
 * Usage: node peer-controller-fixtures.probe.mjs [path/to/mock-ui-server.mjs]
 * Exit 0 when every check matches; exit 1 listing the failures otherwise.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const MOCK_PATH =
  process.argv[2] ??
  fileURLToPath(new URL("./mock-ui-server.mjs", import.meta.url));
const PORT = Number(process.env.OCTOSCODE_MOCK_PORT ?? 50_981);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/api/ui-protocol/ws`;

/** Master wire session on a `peer-control-*` workspace (default = accepted). */
const MASTER = "coding:local:tui";
const WORKSPACE = "/srv/work/peer-control-";
const LANE = "lane-primary";

const failures = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isUuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v ?? "",
  );

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/health`);
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    await delay(100);
  }
  return false;
}

function connect() {
  const socket = new WebSocket(WS_URL);
  const pending = new Map();
  const notifications = [];
  let seq = 0;
  socket.on("message", (bytes) => {
    let frame;
    try {
      frame = JSON.parse(bytes.toString());
    } catch {
      return;
    }
    if (frame.id && pending.has(frame.id)) {
      const settle = pending.get(frame.id);
      pending.delete(frame.id);
      settle(frame);
      return;
    }
    if (frame.method) notifications.push(frame);
  });
  const ready = new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  const rpc = (method, params) => {
    const id = `probe-${++seq}`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  };
  return { ready, rpc, notifications, socket };
}

const refusalKind = (reply) => reply?.error?.data?.kind ?? null;
const result = (reply) => reply?.result ?? null;

async function main() {
  const child = spawn(process.execPath, [MOCK_PATH], {
    env: { ...process.env, OCTOSCODE_MOCK_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const stop = () => {
    if (!child.killed) child.kill("SIGKILL");
  };
  try {
    if (!(await waitForHealth()))
      throw new Error(`mock never listened: ${stderr}`);

    const wire = connect();
    await wire.ready;
    const { rpc, notifications } = wire;

    // ---- open the master on the peer-control workspace -------------------
    const opened = result(
      await rpc("session/open", { session_id: MASTER, cwd: WORKSPACE }),
    );
    const caps = opened?.opened?.capabilities;
    const methods = caps?.supported_methods ?? [];
    const features = caps?.supported_features ?? [];
    check(
      "(c) peer-control workspace advertises the driver family",
      methods.includes("peer/dispatch") &&
        methods.includes("peer/control") &&
        features.includes("external_driver_v1"),
    );
    check(
      "(c) and the sanctioned lane source",
      methods.includes("profile/sub_providers/list"),
    );

    // ---- (c) lane source ------------------------------------------------
    const lanes = result(
      await rpc("profile/sub_providers/list", { profile_id: "coding" }),
    );
    const rows = Array.isArray(lanes?.sub_providers) ? lanes.sub_providers : [];
    const keys = rows.map((row) => row.key);
    check(
      "(c) >= 2 lanes with keys + models",
      rows.length >= 2 &&
        rows.every(
          (row) => typeof row.key === "string" && typeof row.model === "string",
        ),
      `keys=${JSON.stringify(keys)}`,
    );
    check("(c) lane keys are the advertised set", keys.includes(LANE));

    // ---- acquire the fence ----------------------------------------------
    const acquired = result(
      await rpc("session/driver/acquire", {
        session_id: MASTER,
        driver_id: "probe-driver",
        expected_revision: 0,
        lease_seconds: 60,
      }),
    );
    const token = acquired?.control_token;
    const epoch = acquired?.binding?.epoch;
    const pendingWork = acquired?.pending_work;
    check(
      "acquire mints a control_token + binding epoch",
      typeof token === "string" && typeof epoch === "number",
      `token=${typeof token} epoch=${epoch}`,
    );
    check(
      "acquire reports exactly one pending operation",
      Array.isArray(pendingWork) && pendingWork.length === 1,
    );

    const fence = {
      session_id: MASTER,
      driver_id: "probe-driver",
      epoch,
      control_token: token,
    };
    const brief = (text) => ({
      kind: "new_brief",
      brief: text,
      title: "probe-brief",
    });
    const dispatch = (model, operationId, text, override = {}) => ({
      ...fence,
      ...override,
      operation_id: operationId,
      model,
      dispatch: brief(text),
    });

    // ---- (a) unknown lane: typed refusal BEFORE any staging --------------
    const refused = await rpc(
      "peer/dispatch",
      dispatch("lane-ghost", "probe-op-refused", "Unknown lane brief."),
    );
    check(
      "(a) unknown lane => driver_model_unavailable",
      refusalKind(refused) === "driver_model_unavailable",
      `kind=${refusalKind(refused)}`,
    );
    const afterRefusal = result(
      await rpc("peer/gather", { session_id: MASTER }),
    );
    check(
      "(a) refused dispatch staged NO peer",
      Array.isArray(afterRefusal?.peers) && afterRefusal.peers.length === 0,
      `peers=${afterRefusal?.peers?.length}`,
    );
    // NOTE: the test hook answers a BARE JSON body ({calls, kinds}), not a
    // JSON-RPC envelope — it must not be unwrapped with `result()`.
    const dispatchState = await fetch(
      `${ORIGIN}/__test__/peer-control/dispatch-state?session_id=${encodeURIComponent(MASTER)}`,
    ).then((response) => response.json());
    check(
      "(a) the refusal was recorded as model_unavailable",
      Array.isArray(dispatchState?.kinds) &&
        dispatchState.kinds.includes("model_unavailable"),
      `kinds=${JSON.stringify(dispatchState?.kinds)}`,
    );

    // ---- (d) accepted dispatch -> adopted session + staging --------------
    const acceptedReply = await rpc(
      "peer/dispatch",
      dispatch(LANE, "probe-op-1", "Stage the probe peer."),
    );
    const receipt = result(acceptedReply);
    check(
      "(d) accepted receipt carries state/model_lane/duplicate",
      receipt?.state === "accepted" &&
        receipt?.model_lane === LANE &&
        receipt?.duplicate === false,
      `state=${receipt?.state} lane=${receipt?.model_lane}`,
    );
    const adoptedSession = receipt?.adopted_session_id;
    const adoptedTurn = receipt?.adopted_turn_id;
    check(
      "(d) adopted identity is <master base>#peer-<slug>",
      adoptedSession === `${MASTER}#peer-${receipt?.slug}` &&
        isUuid(adoptedTurn),
      `adopted=${adoptedSession} turn=${adoptedTurn}`,
    );

    const adoptedOpen = result(
      await rpc("session/open", { session_id: adoptedSession }),
    );
    check(
      "(d) the SAME socket can open the adopted peer session",
      adoptedOpen?.opened?.session_id === adoptedSession,
      `opened=${adoptedOpen?.opened?.session_id}`,
    );

    // ---- (d) existing per-peer trigger still emits the peer frames -------
    const before = notifications.filter(
      (frame) =>
        frame.method === "turn/started" &&
        frame.params?.session_id === adoptedSession,
    ).length;
    await rpc("session/open", {
      session_id: "coding:local:main",
      cwd: "/workspace/octoscode-web",
    });
    await rpc("turn/start", {
      session_id: "coding:local:main",
      turn_id: crypto.randomUUID(),
      input: [{ kind: "text", text: `Peer turn fixture ${receipt?.slug}` }],
    });
    await delay(250);
    const emitted = notifications.filter(
      (frame) =>
        frame.method === "turn/started" &&
        frame.params?.session_id === adoptedSession,
    ).length;
    check(
      "(d) existing trigger emits the adopted peer's frames",
      emitted > before,
      `turn/started frames=${emitted}`,
    );

    // ---- (b) idempotent replay vs operation conflict ---------------------
    const replay = result(
      await rpc(
        "peer/dispatch",
        dispatch(LANE, "probe-op-1", "Stage the probe peer."),
      ),
    );
    check(
      "(b) equal replay returns the SAME receipt as duplicate:true",
      replay?.duplicate === true &&
        replay?.adopted_session_id === adoptedSession &&
        replay?.adopted_turn_id === adoptedTurn,
      `duplicate=${replay?.duplicate} adopted=${replay?.adopted_session_id}`,
    );

    const conflict = await rpc(
      "peer/dispatch",
      dispatch(LANE, "probe-op-1", "A DIFFERENT brief digest."),
    );
    check(
      "(b) same id + different digest => driver_operation_conflict",
      refusalKind(conflict) === "driver_operation_conflict",
      `kind=${refusalKind(conflict)}`,
    );

    // ---- (e) stale fence on both leaves ---------------------------------
    const staleDispatch = await rpc(
      "peer/dispatch",
      dispatch(LANE, "probe-op-2", "Stale fence brief.", { epoch: epoch + 1 }),
    );
    check(
      "(e) peer/dispatch with a stale epoch => driver_fence_stale",
      refusalKind(staleDispatch) === "driver_fence_stale",
      `kind=${refusalKind(staleDispatch)}`,
    );

    // ---- (e) the `stale` WORKSPACE refuses dispatch symmetrically ---------
    // The `stale` variant is the dispatch mirror of the control arm: BOTH
    // leaves answer with the typed `driver_fence_stale` ERROR (never a refused
    // receipt), exactly as the Core's `driver_store_error_to_rpc` maps
    // StaleEpoch/LeaseExpired/BadProof (ui_protocol_transport.rs:19222-19224).
    const STALE_MASTER = "coding:local:stale";
    await rpc("session/open", {
      session_id: STALE_MASTER,
      cwd: `${WORKSPACE}stale`,
    });
    const staleVariant = await rpc("peer/dispatch", {
      session_id: STALE_MASTER,
      driver_id: "probe-driver",
      epoch,
      control_token: token,
      operation_id: "probe-op-stale-variant",
      model: LANE,
      dispatch: brief("Stale variant brief."),
    });
    check(
      "(e) the `stale` workspace refuses dispatch as driver_fence_stale, with NO result",
      refusalKind(staleVariant) === "driver_fence_stale" &&
        result(staleVariant) === null,
      `kind=${refusalKind(staleVariant)}`,
    );

    const staleControl = await rpc("peer/control", {
      ...fence,
      control_token: `${token}-stale`,
      operation_id: "probe-control-stale",
      target_operation_id: "probe-op-1",
      expected_turn_id: adoptedTurn,
      command: { kind: "steer", input: [{ kind: "text", text: "continue" }] },
    });
    check(
      "(e) peer/control with a stale token => driver_fence_stale",
      refusalKind(staleControl) === "driver_fence_stale",
      `kind=${refusalKind(staleControl)}`,
    );

    // ---- the live fence still works (no over-refusal) --------------------
    const liveControl = result(
      await rpc("peer/control", {
        ...fence,
        operation_id: "probe-control-1",
        target_operation_id: "probe-op-1",
        expected_turn_id: adoptedTurn,
        command: { kind: "steer", input: [{ kind: "text", text: "continue" }] },
      }),
    );
    check(
      "a live fence still accepts peer/control",
      liveControl?.state === "accepted",
      `state=${liveControl?.state}`,
    );

    wire.socket.close();
  } finally {
    stop();
  }
}

try {
  await main();
} catch (error) {
  failures.push(`probe crashed: ${error?.message ?? error}`);
}

for (const entry of checks) {
  process.stdout.write(
    `${entry.ok ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? ` [${entry.detail}]` : ""}\n`,
  );
}
process.stdout.write(
  `\n${checks.length - failures.length}/${checks.length} checks passed\n`,
);
if (failures.length > 0) {
  process.stdout.write(
    `\nFAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("PROBE_OK\n");
process.exit(0);
