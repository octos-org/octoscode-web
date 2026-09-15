#!/usr/bin/env node
/**
 * SYNTHETIC fixture contract check, not browser or live Core evidence.
 * Uses loopback JSON-RPC only: no provider, credentials, or server workspaces.
 * Browser-native peer kickoff is proved by e2e/capacity-and-peers.spec.ts.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { WebSocket } = require("ws");
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  const value = Number(index < 0 ? fallback : args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${name}`);
  return value;
}
const rounds = option("--rounds", 4);
const sessionsPerRound = option("--sessions", 4);
const port = option("--port", 62111);
const origin = `http://127.0.0.1:${port}`;
const sockets = new Set();
let checks = 0;
function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks += 1;
  console.log(`PASS ${name}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function waitFor(predicate, label) {
  const deadline = Date.now() + 8000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function control(path, method = "POST") {
  const response = await fetch(origin + "/__test__/" + path, { method });
  if (!response.ok) throw new Error(`Control ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ui-protocol/ws`);
  sockets.add(ws);
  const pending = new Map();
  const notifications = [];
  let nextId = 0;
  const closed = new Promise((resolve) =>
    ws.once("close", () => {
      sockets.delete(ws);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("connection_closed"));
      }
      pending.clear();
      resolve();
    }),
  );
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
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    ws,
    closed,
    notifications,
    call(method, params = {}) {
      const id = String(++nextId);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }, 8000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    envelopes(sessionId) {
      return notifications
        .filter(
          (frame) =>
            frame.method === "projection/envelope" &&
            (!sessionId || frame.params.session_id === sessionId),
        )
        .map((frame) => frame.params);
    },
  };
}
async function rejected(client, method, params, label) {
  let didReject = false;
  try {
    await client.call(method, params);
  } catch {
    didReject = true;
  }
  check(label, didReject);
}
function fresh(profile = "coding", cwd = "/srv/work/synthetic-soak") {
  return {
    session_id: `${profile}:api:web-${randomUUID()}`,
    profile_id: profile,
    cwd,
  };
}
const start = (scope, turnId, text) => ({
  ...scope,
  turn_id: turnId,
  input: [{ kind: "text", role: "user", text }],
});
const hydrate = (client, scope) =>
  client.call("session/hydrate", {
    session_id: scope.session_id,
    profile_id: scope.profile_id,
    include: { messages: true, turns: true, pending_approvals: true },
  });
const terminal = (client, scope) =>
  client
    .envelopes(scope.session_id)
    .filter((event) => event.payload.type === "turn_terminal");

const fixture = spawn(
  process.execPath,
  ["apps/web/scripts/mock-ui-server.mjs"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      OCTOSCODE_MOCK_PORT: String(port),
      OCTOSCODE_MOCK_AUTH_MODE: "optional",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let stderr = "";
fixture.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const exited = new Promise((resolve) => fixture.once("exit", resolve));
try {
  await waitFor(async () => {
    try {
      return (await fetch(origin + "/health")).ok;
    } catch {
      return false;
    }
  }, "fixture health");
  for (let round = 0; round < rounds; round += 1) {
    const owner = await connect();
    const cohort = Array.from({ length: sessionsPerRound }, (_, index) => ({
      scope: fresh(
        index % 2 ? "review" : "coding",
        `/srv/work/synthetic-soak/r${round}/w${index % 2}`,
      ),
      turnId: randomUUID(),
      text: `round-${round}-session-${index}-unique`,
    }));
    for (const { scope } of cohort) {
      const opened = (await owner.call("session/open", scope)).opened;
      check(
        "exact opened scope",
        opened.session_id === scope.session_id &&
          opened.active_profile_id === scope.profile_id &&
          opened.workspace_root === scope.cwd,
      );
      await control("terminal/hold-next");
    }
    await Promise.all(
      cohort.map(({ scope, turnId, text }) =>
        owner.call("turn/start", start(scope, turnId, text)),
      ),
    );
    await waitFor(
      async () =>
        (await control("terminal/state", "GET")).held.length === cohort.length,
      "cohort barrier",
    );
    const diagnostics = await control("diagnostics/state", "GET");
    check(
      "whole cohort active on socket owners",
      cohort.every(({ scope, turnId }) => {
        const active = diagnostics.activeBySession[scope.session_id];
        return (
          active?.turn_id === turnId &&
          active.owner === "socket" &&
          active.profile_id === scope.profile_id &&
          active.workspace_root === scope.cwd
        );
      }),
    );
    const first = cohort[0];
    const observer = await connect();
    await observer.call("session/open", first.scope);
    await waitFor(() => observer.envelopes().length === 2, "observer replay");
    check(
      "canonical replay byte-identical",
      same(observer.envelopes(), owner.envelopes(first.scope.session_id)),
    );
    await rejected(
      owner,
      "session/hydrate",
      { ...first.scope, profile_id: "wrong" },
      "wrong profile rejected",
    );
    await rejected(
      owner,
      "session/open",
      { ...first.scope, cwd: "/different" },
      "wrong workspace rejected",
    );
    await rejected(
      owner,
      "turn/start",
      start(first.scope, randomUUID(), "overlap"),
      "concurrent same-Session start rejected",
    );
    await rejected(
      owner,
      "turn/start",
      start(first.scope, "not-a-uuid", "invalid"),
      "non-UUID turn rejected",
    );
    if (cohort[1]) {
      await rejected(
        observer,
        "session/hydrate",
        cohort[1].scope,
        "unopened Session rejected on foreign socket",
      );
    }
    for (const { scope, turnId, text } of cohort) {
      const snapshot = await hydrate(owner, scope);
      check(
        "mid-turn hydrate has only its persisted prompt",
        snapshot.messages.length === 1 &&
          snapshot.messages[0].content === text &&
          snapshot.messages[0].thread_id === turnId,
      );
      check(
        "mid-turn hydrate is active without phantom terminal",
        same(snapshot.turns, [
          { turn_id: turnId, state: "active", thread_id: turnId },
        ]) && !snapshot.replayed_envelopes,
      );
    }
    await control("terminal/reset");
    await waitFor(
      () => cohort.every(({ scope }) => terminal(owner, scope).length === 1),
      "cohort terminals",
    );
    await waitFor(
      () => terminal(observer, first.scope).length === 1,
      "observer live terminal",
    );
    check(
      "observer receives no unopened Session output",
      observer
        .envelopes()
        .every((event) => event.session_id === first.scope.session_id),
    );
    const snapshots = [];
    for (const { scope, turnId, text } of cohort) {
      const snapshot = await hydrate(owner, scope);
      snapshots.push(snapshot);
      check(
        "hydrated transcript exactly once",
        snapshot.messages.length === 2 &&
          snapshot.messages[0].content === text &&
          snapshot.messages[1].role === "assistant" &&
          new Set(snapshot.messages.map((message) => message.message_id))
            .size === 2,
      );
      check(
        "completed exact turn",
        snapshot.turns.length === 1 &&
          snapshot.turns[0].turn_id === turnId &&
          snapshot.turns[0].state === "completed",
      );
      const envelopes = owner.envelopes(scope.session_id);
      check(
        "canonical cursor and thread sequence unique",
        same(
          envelopes.map((event) => event.seq),
          [1, 2, 3, 4],
        ) &&
          same(
            envelopes.map((event) => event.cursor.seq),
            [1, 2, 3, 4],
          ),
      );
      await rejected(
        owner,
        "turn/start",
        start(scope, turnId, text),
        "completed UUID never replayed",
      );
    }
    owner.ws.close();
    await owner.closed;
    const recovered = await connect();
    for (const [index, { scope }] of cohort.entries()) {
      await recovered.call("session/open", {
        ...scope,
        after: snapshots[index].cursor,
      });
      const snapshot = await hydrate(recovered, scope);
      check(
        "reconnect preserves exact transcript and turns",
        same(snapshot.messages, snapshots[index].messages) &&
          same(snapshot.turns, snapshots[index].turns),
      );
    }
    check(
      "resume cursor suppresses already-seen replay",
      recovered.envelopes().length === 0,
    );
    await recovered.call("session/delete", first.scope);
    await recovered.call("session/open", first.scope);
    const deleted = await hydrate(recovered, first.scope);
    check(
      "delete prunes transcript and turns",
      deleted.messages.length === 0 && deleted.turns.length === 0,
    );
    observer.ws.close();
    recovered.ws.close();
    await Promise.all([observer.closed, recovered.closed]);
  }

  const lostOwner = await connect();
  const lost = [
    fresh(),
    fresh("review", "/srv/work/synthetic-soak/review"),
  ].map((scope) => ({
    scope,
    turnId: randomUUID(),
  }));
  for (const { scope, turnId } of lost) {
    await lostOwner.call("session/open", scope);
    await control("terminal/hold-next");
    await lostOwner.call("turn/start", start(scope, turnId, "owner-loss"));
  }
  lostOwner.ws.close();
  await lostOwner.closed;
  const recovery = await connect();
  for (const { scope, turnId } of lost) {
    await recovery.call("session/open", scope);
    const snapshot = await hydrate(recovery, scope);
    check(
      "loss interrupts every shared-socket owner",
      snapshot.turns.length === 1 &&
        snapshot.turns[0].turn_id === turnId &&
        snapshot.turns[0].state === "interrupted" &&
        snapshot.turns[0].error === "connection_closed",
    );
    check(
      "loss never fabricates assistant success",
      snapshot.messages.length === 1 &&
        terminal(recovery, scope).length === 1 &&
        terminal(recovery, scope)[0].payload.data.outcome === "interrupted",
    );
    await rejected(
      recovery,
      "turn/start",
      start(scope, turnId, "owner-loss"),
      "interrupted UUID never replayed",
    );
  }

  const approval = fresh();
  const question = fresh();
  await recovery.call("session/open", approval);
  await recovery.call("session/open", question);
  const approvalTurn = randomUUID();
  const questionTurn = randomUUID();
  await recovery.call(
    "turn/start",
    start(approval, approvalTurn, "Request approval fixture"),
  );
  await recovery.call(
    "turn/start",
    start(question, questionTurn, "Request question fixture"),
  );
  const approvalSnapshot = await hydrate(recovery, approval);
  const questionSnapshot = await hydrate(recovery, question);
  check(
    "approval restores full exact owner tuple",
    approvalSnapshot.pending_approvals.length === 1 &&
      approvalSnapshot.pending_approvals[0].session_id ===
        approval.session_id &&
      approvalSnapshot.pending_approvals[0].turn_id === approvalTurn &&
      approvalSnapshot.pending_approvals[0].typed_details.command
        .command_line === "pnpm check",
  );
  check(
    "question restores full exact owner tuple",
    questionSnapshot.pending_questions.length === 1 &&
      questionSnapshot.pending_questions[0].session_id ===
        question.session_id &&
      questionSnapshot.pending_questions[0].turn_id === questionTurn &&
      questionSnapshot.pending_questions[0].questions.length === 1,
  );
  const approvalId = approvalSnapshot.pending_approvals[0].approval_id;
  const questionId = questionSnapshot.pending_questions[0].question_id;
  await rejected(
    recovery,
    "approval/respond",
    { ...question, approval_id: approvalId, decision: "approve" },
    "approval cannot resolve another Session",
  );
  await rejected(
    recovery,
    "user_question/respond",
    { ...approval, question_id: questionId, answers: [] },
    "question cannot resolve another Session",
  );
  await recovery.call("approval/respond", {
    ...approval,
    approval_id: approvalId,
    decision: "approve",
    scope: "once",
  });
  await recovery.call("user_question/respond", {
    ...question,
    question_id: questionId,
    answers: [{ selected_labels: ["Full"] }],
  });
  await waitFor(
    () =>
      terminal(recovery, approval).length === 1 &&
      terminal(recovery, question).length === 1,
    "interaction terminals",
  );
  check(
    "interaction resolution produces only exact owner terminals",
    terminal(recovery, approval)[0].turn_id === approvalTurn &&
      terminal(recovery, question)[0].turn_id === questionTurn,
  );
  await rejected(
    recovery,
    "approval/respond",
    { ...approval, approval_id: approvalId, decision: "approve" },
    "resolved request not answerable twice",
  );
  check("fixture stderr clean", stderr.length === 0);
  console.log(
    `SYNTHETIC PASS: ${checks} assertions; ${rounds} rounds x ${sessionsPerRound} concurrent Sessions. Browser and live Core were not exercised.`,
  );
} catch (error) {
  console.error(error);
  if (stderr) console.error(stderr);
  process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.terminate();
  fixture.kill();
  await exited;
}
