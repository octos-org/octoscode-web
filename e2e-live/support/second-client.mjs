/**
 * A minimal UI Protocol v1 client over the same WebSocket endpoint the TUI and
 * the browser client use (`/api/ui-protocol/ws`). Used to hold a turn open and
 * to inspect raw frames, so the assertions are against real server behaviour
 * rather than a mock.
 */
const [, , command, sessionId] = process.argv;
const PORT = process.env.PORT ?? "55081";
const TOKEN = process.env.TOKEN ?? "";
const CWD = process.env.WS_CWD ?? "";
const url = `ws://127.0.0.1:${PORT}/api/ui-protocol/ws?token=${encodeURIComponent(TOKEN)}`;

const ws = new WebSocket(url);
let next = 1;
const pending = new Map();

function call(method, params) {
  const id = `c${next++}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

ws.addEventListener("message", (event) => {
  const frame = JSON.parse(event.data);
  if (frame.id && pending.has(frame.id)) {
    pending.get(frame.id)(frame);
    pending.delete(frame.id);
    return;
  }
  if (frame.method) console.log(`NOTIFY ${frame.method}`);
});

ws.addEventListener("error", (e) => {
  console.error("WS ERROR", e.message ?? e);
  process.exit(1);
});

ws.addEventListener("open", async () => {
  // Negotiate the same feature set the real clients ask for, so cwd-scoped
  // session/open and session/list behave exactly as they do in the product.
  const hello = await call("client_hello", {
    transport: "websocket",
    features: [
      "session.workspace_cwd.v1",
      "auxiliary.rest_to_ws.v1",
      "state.session_hydrate.v1",
    ],
  });
  if (hello.error) {
    console.log("HELLO ERROR " + JSON.stringify(hello.error));
    process.exit(1);
  }
  if (command === "list") {
    const res = await call("session/list", CWD ? { cwd: CWD } : {});
    const rows = res.result?.sessions ?? [];
    console.log(
      JSON.stringify(
        rows.map((r) => ({ id: r.id, active_turn: r.active_turn })),
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const opened = await call("session/open", {
    session_id: sessionId,
    profile_id: process.env.PROFILE ?? "main",
    ...(CWD ? { cwd: CWD } : {}),
  });
  if (opened.error) {
    console.log("OPEN ERROR " + JSON.stringify(opened.error));
    process.exit(1);
  }
  console.log(`OPENED ${sessionId}`);

  const turnId = crypto.randomUUID();
  const started = await call("turn/start", {
    session_id: sessionId,
    turn_id: turnId,
    input: [
      {
        kind: "text",
        text:
          command === "warm"
            ? "warm up this session"
            : "HOLD-THIS-TURN keep the session busy",
      },
    ],
  });

  if (command === "collide") {
    console.log("COLLIDE RESULT:");
    console.log(JSON.stringify(started, null, 2));
    process.exit(0);
  }

  if (started.error) {
    console.log("HOLD FAILED " + JSON.stringify(started.error));
    process.exit(1);
  }
  if (command === "warm") {
    // Wait for the turn to reach terminal so the session persists and becomes
    // listable, then exit.
    await new Promise((resolve) => {
      const onMessage = (event) => {
        const frame = JSON.parse(event.data);
        if (
          frame.method === "turn/completed" ||
          frame.method === "turn/error"
        ) {
          ws.removeEventListener("message", onMessage);
          resolve();
        }
      };
      ws.addEventListener("message", onMessage);
      setTimeout(resolve, 30000);
    });
    console.log(`WARMED ${sessionId}`);
    process.exit(0);
  }
  process.stdin.once("data", async () => {
    const interrupted = await call("turn/interrupt", {
      session_id: sessionId,
      turn_id: turnId,
    });
    if (interrupted.error) {
      console.error("INTERRUPT FAILED " + JSON.stringify(interrupted.error));
      process.exit(1);
    }
  });
  console.log(`HOLDING turn ${turnId}`);
});
