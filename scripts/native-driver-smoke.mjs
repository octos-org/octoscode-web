#!/usr/bin/env node
/**
 * SYNTHETIC native-driver smoke for the corrective fixture additions:
 *   - /__test__/native/generation  (E goal-generation audit driver)
 *   - monitor/create|list|pause|resume|delete
 *   - loop/fire_now
 * Pure harness, model-free, credential-free (fixture token only), no browser,
 * no live Core. The fixture is spawned by THIS driver on a disposable port;
 * readiness is proven from the child's own stdout (bind succeeded => the child
 * owns the port) before any RPC, with a bounded deadline. A single `finally`
 * owns teardown: the WebSocket client is closed, then the child is SIGTERMed
 * and awaited (SIGKILL only as a bounded fallback). Failures never exit before
 * owned shutdown and never mutate a pre-existing fixture on the port.
 * Run: node scripts/native-driver-smoke.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { WebSocket } = require("ws");
const PORT = Number(process.env.OCTOSCODE_MOCK_PORT ?? 62_431);
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("OCTOSCODE_MOCK_PORT must be a valid TCP port");
}
const origin = `http://127.0.0.1:${PORT}`;
// Resolve the fixture path from THIS module, never the caller's cwd.
const fixtureScript = fileURLToPath(
  new URL("../apps/web/scripts/mock-ui-server.mjs", import.meta.url),
);
let checks = 0;
function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks += 1;
  console.log(`PASS ${name}`);
}
async function control(path, method = "POST", timeoutMs = 3_000) {
  // Bounded abort covers the WHOLE fetch exchange: headers AND body read,
  // so a hung/stalled fixture control can never wedge this driver.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(origin + "/__test__/" + path, {
      method,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Control ${path}: ${response.status}`);
    if (response.status === 204) return null;
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Control ${path}: DEADLINE after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function connect(timeoutMs = 6_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ui-protocol/ws`);
    const pending = new Map();
    const notifications = [];
    let nextId = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        // already closed
      }
      reject(new Error("WS_HANDSHAKE_TIMEOUT"));
    }, timeoutMs);
    ws.on("message", (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.method) {
        notifications.push(frame);
        return;
      }
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.error) entry.reject(new Error(frame.error.message));
      else entry.resolve(frame.result);
    });
    ws.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("WS_ERROR"));
    });
    ws.once("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("WS_CLOSED_BEFORE_OPEN"));
    });
    ws.once("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ws,
        notifications,
        call(method, params = {}) {
          const id = String(++nextId);
          return new Promise((resolveCall, rejectCall) => {
            const callTimer = setTimeout(() => {
              pending.delete(id);
              rejectCall(new Error(`timeout ${method}`));
            }, 8_000);
            pending.set(id, {
              resolve: resolveCall,
              reject: rejectCall,
              timer: callTimer,
            });
            ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
          });
        },
      });
    });
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Spawn the fixture and wait for its own readiness line with a bounded
// deadline. Early exit (e.g. EADDRINUSE from a pre-existing fixture) or a
// spawn error rejects BEFORE any connection is attempted, so this driver
// never connects to or mutates a fixture it does not own.
const server = spawn(process.execPath, [fixtureScript], {
  env: { ...process.env, OCTOSCODE_MOCK_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let childStderr = "";
server.stderr.on("data", (chunk) => {
  childStderr += chunk.toString();
});
let exitInfo = null;
const exited = new Promise((resolve) => {
  server.once("exit", (code, signal) => {
    exitInfo = { code, signal };
    resolve(exitInfo);
  });
  server.once("error", (error) => {
    exitInfo = { code: null, signal: null, error: error.message };
    resolve(exitInfo);
  });
});
function waitForReady(timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let out = "";
    let done = false;
    const ready = new RegExp(`listening on 127\\.0\\.0\\.1:${PORT}`);
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error(`FIXTURE_READY_TIMEOUT stderr=${childStderr}`));
      }
    }, timeoutMs);
    server.stdout.on("data", (chunk) => {
      out += chunk.toString();
      if (ready.test(out) && !done) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    });
    exited.then((info) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(
          new Error(
            `FIXTURE_EXITED_BEFORE_READY code=${info.code} signal=${info.signal}${
              info.error ? ` error=${info.error}` : ""
            } stderr=${childStderr}`,
          ),
        );
      }
    });
  });
}
function terminateOwnedChild() {
  if (exitInfo) return Promise.resolve(exitInfo);
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 3_000);
    exited.then((info) => {
      clearTimeout(killTimer);
      resolve(info);
    });
    try {
      server.kill("SIGTERM");
    } catch {
      // already gone
    }
  });
}

let client = null;
try {
  await waitForReady();
  client = await connect();
  const sessionId = "dev:local:tui#native-driver-smoke";
  const open = await client.call("session/open", {
    session_id: sessionId,
    cwd: "/srv/work/native-workflows-smoke",
    profile_id: "dev",
  });
  check(
    "session/open returns the native session",
    open?.opened?.session_id === sessionId,
  );

  // --- E goal-generation audit driver ---
  const set = await client.call("session/goal/set", {
    session_id: sessionId,
    objective: "driver base goal",
    status: "active",
    transition_actor: "user",
  });
  check("goal set returns generation >= 1", Number(set?.generation) >= 1);
  const baseGen = Number(set?.generation);

  const before = client.notifications.length;
  await control(
    `native/generation?session_id=${encodeURIComponent(sessionId)}&to=37&objective=arbitrary-37`,
  );
  await sleep(150);
  const genEvents = client.notifications
    .slice(before)
    .filter((n) => n.method === "session/goal/updated");
  check(
    "generation driver emits a session/goal/updated",
    genEvents.length === 1,
  );
  check(
    "driver stamps the requested arbitrary generation",
    genEvents[0]?.params?.generation === 37,
  );
  check(
    "driver event carries the objective override",
    genEvents[0]?.params?.goal?.objective === "arbitrary-37",
  );

  const beforeForeign = client.notifications.length;
  await control(
    `native/generation?session_id=${encodeURIComponent(sessionId)}&to=5000&foreign=1`,
  );
  await sleep(150);
  const foreignEvents = client.notifications
    .slice(beforeForeign)
    .filter((n) => n.method === "session/goal/updated");
  check(
    "foreign generation driver emits one event",
    foreignEvents.length === 1,
  );
  check(
    "foreign event is stamped with the other session id",
    foreignEvents[0]?.params?.session_id === `${sessionId}-other`,
  );
  check(
    "foreign event advances the scalar (next genuine user set is higher)",
    Number(foreignEvents[0]?.params?.generation) === 5000,
  );

  // A genuine user transition after an arbitrary base must still be admitted:
  // Core maps the shared scalar to the scoped goal, so generation keeps rising.
  const resume = await client.call("session/goal/set", {
    session_id: sessionId,
    objective: "after arbitrary base",
    status: "active",
    transition_actor: "user",
  });
  check(
    "user set after arbitrary base has a strictly-greater generation",
    Number(resume?.generation) > 5000,
  );
  check(
    "base was at least the original set generation",
    Number(resume?.generation) > baseGen,
  );

  // --- monitor lifecycle: exact typed receipts, list must be an Array ---
  // Core echoes the authenticated profile: this Session is `dev`-scoped, so
  // EVERY outer reply and nested record must carry session_id === sessionId
  // and profile_id === "dev" — no arbitrary nonempty profile is accepted —
  // and nested IDs must be nonempty and EXACTLY the created ids.
  const expectedProfile = "dev";
  const created = await client.call("monitor/create", {
    session_id: sessionId,
    name: "watch-build",
    argv: ["./scripts/watch.sh", "--verbose"],
    mode: "poll",
  });
  check(
    "monitor/create returns an exact ok/created/active receipt",
    created?.ok === true &&
      created?.created === true &&
      created?.status === "active" &&
      created?.session_id === sessionId &&
      created?.profile_id === expectedProfile &&
      typeof created?.monitor_id === "string" &&
      created.monitor_id.length > 0 &&
      created?.monitor?.status === "active" &&
      created?.monitor?.monitor_id === created?.monitor_id &&
      created?.monitor?.session_id === sessionId &&
      created?.monitor?.profile_id === expectedProfile &&
      typeof created?.monitor?.batch_ms === "number" &&
      created.monitor.batch_ms === 200 &&
      created.monitor.max_events_per_hour === 60 &&
      created.monitor.persistent === false &&
      created.monitor.fires_used === 0,
  );
  check(
    "poll monitor defaults interval_seconds to the Core minimum (1)",
    created?.monitor?.interval_seconds === 1,
  );
  const monitorId = created?.monitor_id;
  const listed = await client.call("monitor/list", { session_id: sessionId });
  check(
    "monitor/list is an Array of exact-owner records containing the created monitor",
    Array.isArray(listed?.monitors) &&
      listed?.session_id === sessionId &&
      listed?.profile_id === expectedProfile &&
      listed.monitors.some(
        (m) =>
          m.monitor_id === monitorId &&
          m.monitor_id.length > 0 &&
          m.session_id === sessionId &&
          m.profile_id === listed.profile_id &&
          m.status === "active",
      ),
  );
  const paused = await client.call("monitor/pause", {
    session_id: sessionId,
    monitor_id: monitorId,
  });
  check(
    "monitor/pause returns ok with paused status and user pause_reason",
    paused?.ok === true &&
      paused?.status === "paused" &&
      paused?.session_id === sessionId &&
      paused?.profile_id === expectedProfile &&
      paused?.monitor_id === monitorId &&
      paused?.monitor?.monitor_id === monitorId &&
      paused?.monitor?.session_id === sessionId &&
      paused?.monitor?.profile_id === expectedProfile &&
      paused?.monitor?.status === "paused" &&
      paused?.monitor?.pause_reason === "user",
  );
  const resumed = await client.call("monitor/resume", {
    session_id: sessionId,
    monitor_id: monitorId,
  });
  check(
    "monitor/resume returns ok with active status and cleared pause_reason",
    resumed?.ok === true &&
      resumed?.status === "active" &&
      resumed?.session_id === sessionId &&
      resumed?.profile_id === expectedProfile &&
      resumed?.monitor_id === monitorId &&
      resumed?.monitor?.monitor_id === monitorId &&
      resumed?.monitor?.session_id === sessionId &&
      resumed?.monitor?.profile_id === expectedProfile &&
      resumed?.monitor?.status === "active" &&
      resumed?.monitor?.pause_reason === null,
  );
  const deleted = await client.call("monitor/delete", {
    session_id: sessionId,
    monitor_id: monitorId,
  });
  check(
    "monitor/delete reports deleted with ok true",
    deleted?.ok === true &&
      deleted?.deleted === true &&
      deleted?.session_id === sessionId &&
      deleted?.profile_id === expectedProfile &&
      deleted?.monitor_id === monitorId &&
      deleted?.monitor?.monitor_id === monitorId &&
      deleted?.monitor?.session_id === sessionId &&
      deleted?.monitor?.profile_id === expectedProfile,
  );
  const afterDelete = await client.call("monitor/list", {
    session_id: sessionId,
  });
  check(
    "monitor/list is an Array omitting the deleted monitor",
    Array.isArray(afterDelete?.monitors) &&
      afterDelete?.session_id === sessionId &&
      afterDelete?.profile_id === expectedProfile &&
      !afterDelete.monitors.some((m) => m.monitor_id === monitorId),
  );

  // --- manual loop fire-now: exact Core-shaped receipt ---
  const loop = await client.call("loop/create", {
    session_id: sessionId,
    prompt: "driver fire loop",
    mode: "fixed_interval",
    interval_seconds: 300,
  });
  const expectedLoopProfile = "dev";
  check(
    "loop/create returns an exact fixed_interval receipt",
    loop?.ok === true &&
      loop?.created === true &&
      loop?.status === "active" &&
      loop?.session_id === sessionId &&
      loop?.profile_id === expectedLoopProfile &&
      typeof loop?.loop_id === "string" &&
      loop?.loop_id.length > 0 &&
      loop?.loop?.loop_id === loop?.loop_id &&
      loop?.loop?.session_id === sessionId &&
      loop?.loop?.profile_id === expectedLoopProfile &&
      loop?.loop?.status === "active" &&
      loop?.loop?.interval_seconds === 300,
  );
  const loopId = loop?.loop_id;
  const fireStartedAt = Date.now();
  const fired = await client.call("loop/fire_now", {
    session_id: sessionId,
    loop_id: loopId,
  });
  check(
    "loop/fire_now returns ok:queued with a queued fire outcome",
    fired?.ok === true &&
      fired?.status === "queued" &&
      fired?.session_id === sessionId &&
      fired?.profile_id === expectedLoopProfile &&
      fired?.loop_id === loopId &&
      fired?.loop?.loop_id === loopId &&
      fired?.loop?.session_id === sessionId &&
      fired?.loop?.profile_id === expectedLoopProfile &&
      fired?.fire?.queued === true &&
      fired?.fire?.duplicate === false &&
      typeof fired?.fire?.continuation_id === "number",
  );
  check(
    "loop/fire_now keeps the nested loop active and records last_run_at_ms",
    fired?.loop?.status === "active" &&
      typeof fired?.loop?.last_run_at_ms === "number",
  );
  check(
    "loop/fire_now receipt ids are exact, nonempty and owner-scoped",
    typeof fired?.loop_id === "string" &&
      fired.loop_id.length > 0 &&
      fired.loop_id === loopId &&
      typeof fired?.loop?.loop_id === "string" &&
      fired.loop.loop_id === loopId &&
      fired?.loop?.session_id === sessionId &&
      typeof fired?.loop?.profile_id === "string" &&
      fired.loop.profile_id.length > 0 &&
      fired?.loop?.last_run_at_ms >= fireStartedAt,
  );
  const afterFire = await client.call("loop/list", { session_id: sessionId });
  check(
    "loop/list is an Array still showing the fired loop active with fire timestamps",
    Array.isArray(afterFire?.loops) &&
      afterFire?.session_id === sessionId &&
      afterFire?.profile_id === expectedLoopProfile &&
      afterFire.loops.some(
        (entry) =>
          entry.loop_id === loopId &&
          entry.session_id === sessionId &&
          entry.status === "active" &&
          typeof entry.last_run_at_ms === "number" &&
          entry.last_run_at_ms >= fireStartedAt &&
          // fires_used is Core-internal (UiLoopRecord has no such field) and
          // must NEVER leak onto the loop wire record.
          !("fires_used" in entry),
      ),
  );

  client.ws.close();
  client = null;
  const finalExit = await terminateOwnedChild();
  check(
    "fixture exits cleanly on SIGTERM",
    // The fixture installs a SIGTERM handler that closes and exits 0, so the
    // child reports code 0 (signal null) — a clean owned shutdown.
    finalExit?.code === 0 && finalExit?.signal === null,
  );
  console.log(
    `\nSYNTHETIC DRIVER PASS: ${checks} assertions; no browser or live Core exercised.`,
  );
} catch (error) {
  console.error(childStderr);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    client?.ws?.close();
  } catch {
    // already closed
  }
  await terminateOwnedChild();
}
