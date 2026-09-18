/**
 * A stub OpenAI-compatible server for the two-client collision gate.
 *
 * Ordinary prompts complete instantly. A prompt carrying HOLD-THIS-TURN gets a
 * tool call that blocks for a long time, which holds the SESSION's single turn
 * slot without holding an HTTP request open — a held response just trips the
 * provider timeout and the retry layer ends the turn, which is not what a real
 * long turn looks like. The holder interrupts its own turn through Core.
 */
import { createServer } from "node:http";
const ts = () => new Date().toISOString().slice(11, 23);

const PORT = Number(process.argv[2] ?? 8791);
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS ?? 600);
const SLEEP = `sleep ${HOLD_SECONDS}`;

const chunk = (delta, finish) =>
  `data: ${JSON.stringify({
    id: "stub",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "stub-model",
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })}\n\n`;

const sse = (res) =>
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = req.url ?? "";
    console.log(`${ts()} [stub] ${req.method} ${url}`);

    if (req.method === "GET" && url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "stub-model", object: "model", owned_by: "stub" }],
        }),
      );
      return;
    }

    if (!url.includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }

    let streaming = false;
    let hold = false;
    try {
      const parsed = JSON.parse(body || "{}");
      streaming = parsed.stream === true;
      // Hold only on the FIRST round of a turn that asked for it: the LAST
      // message must be the user's hold request. On the next round the last
      // message is the tool result, so the turn is allowed to finish instead
      // of looping on `sleep` forever. Checking the whole history instead
      // would both re-hold old turns and, once the call is in the
      // transcript, refuse to hold new ones.
      const messages = parsed.messages ?? [];
      const last = messages[messages.length - 1];
      hold =
        last?.role === "user" &&
        JSON.stringify(last?.content ?? "").includes("HOLD-THIS-TURN");
    } catch {
      /* fall through to a normal completion */
    }

    if (hold) {
      console.log(
        `${ts()} [stub] holding the TURN via ${SLEEP} (stream=${streaming})`,
      );
      const call = {
        id: "call_hold_1",
        type: "function",
        function: {
          name: "shell",
          // The shell tool's own default timeout is 120s; without raising it
          // the "held" turn quietly ends mid-assertion.
          arguments: JSON.stringify({
            command: SLEEP,
            timeout_secs: HOLD_SECONDS,
          }),
        },
      };
      if (streaming) {
        sse(res);
        res.write(chunk({ role: "assistant", content: "" }));
        res.write(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: call.id,
                type: "function",
                function: call.function,
              },
            ],
          }),
        );
        res.write(chunk({}, "tool_calls"));
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "stub",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "stub-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [call],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
      return;
    }

    console.log(`${ts()} [stub] completing normally (stream=${streaming})`);
    if (streaming) {
      sse(res);
      res.write(chunk({ role: "assistant", content: "" }));
      res.write(chunk({ content: "ok" }));
      res.write(chunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "stub",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "stub-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }
  });
}).listen(PORT, "127.0.0.1", () =>
  console.log(`${ts()} [stub] listening on http://127.0.0.1:${PORT}/v1`),
);
