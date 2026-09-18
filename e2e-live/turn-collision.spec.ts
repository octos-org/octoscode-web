import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * Two clients, one live session, against a REAL `octos serve`.
 *
 * A second UI Protocol connection opens the session this browser just created
 * and starts a turn that never finishes. Everything asserted here is the
 * client's honesty about that fact: the strip must name the other client
 * rather than claim the turn as ours, and a send that the server refuses must
 * keep the operator's text.
 */
const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = required("OCTOSCODE_LIVE_TOKEN");
const cwd = required("OCTOSCODE_LIVE_WORKSPACE");
const holderScript = fileURLToPath(
  new URL("./support/second-client.mjs", import.meta.url),
);
const corePort = required("OCTOSCODE_LIVE_CORE_PORT");
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the collision gate`);
  return value;
}

test("discloses the other client's turn instead of claiming it", async ({
  page,
}) => {
  let holder: ChildProcess | undefined;
  let sessionId: string | undefined;
  let warmTurnId: string | undefined;
  let queuedTurnId: string | undefined;
  let occupyingTurnId: string | undefined;
  const completed = new Set<string>();
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "session/open") sessionId = frame.params.session_id;
      if (
        frame.method === "turn/start" &&
        frame.params.input?.[0]?.text === "say ok"
      )
        warmTurnId = frame.params.turn_id;
      if (
        frame.method === "turn/start" &&
        frame.params.input?.[0]?.text === "my queued message"
      )
        queuedTurnId = frame.params.turn_id;
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (
        frame.method === "projection/envelope" &&
        frame.params.payload.type === "turn_terminal" &&
        frame.params.payload.data.outcome === "completed"
      )
        completed.add(frame.params.turn_id);
    });
  });

  try {
    await page.goto("/");
    await page.getByLabel("Server origin").fill(endpoint);
    await page.getByLabel("Auth token").fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    const addWorkspace = page.getByRole("region", { name: "Add workspace" });
    await expect(addWorkspace).toBeVisible({ timeout: 30_000 });
    await addWorkspace.getByLabel("Server workspace path").fill(cwd);
    await addWorkspace.getByRole("button", { name: "Start session" }).click();

    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await expect(composer).toBeEnabled({ timeout: 60_000 });

    // Prove the isolated provider works before introducing a second client.
    await composer.fill("say ok");
    await page.getByRole("button", { name: "Send prompt" }).click();

    await expect
      .poll(() => Boolean(warmTurnId && completed.has(warmTurnId)), {
        timeout: 60_000,
      })
      .toBe(true);
    expect(sessionId, "the browser opened its owning Session").toBeTruthy();
    const mark = (what: string) =>
      console.log(`${new Date().toISOString().slice(11, 23)} [gate] ${what}`);
    mark(`browser session id: ${sessionId}`);

    const strip = page.getByRole("button", { name: "Session settings" });
    await expect(strip).toContainText("Ready", { timeout: 60_000 });
    // Baseline: nothing queued and nobody else in the session, so a later
    // assertion cannot pass on leftover state.
    await expect(page.getByText("1 queued")).toHaveCount(0);
    await expect(strip).not.toContainText(
      "Another client is working in this session",
    );

    // A SECOND client takes the session's only turn slot and holds it.
    const holderEnv = {
      ...process.env,
      PORT: corePort,
      TOKEN: token,
      WS_CWD: cwd,
    };
    holder = spawn(process.execPath, [holderScript, "hold", sessionId!], {
      env: holderEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    mark("holder spawned");
    let holdingResolve: (() => void) | undefined;
    const holding = new Promise<void>((resolve) => (holdingResolve = resolve));
    holder.stdout?.on("data", (d) => {
      const line = `${d}`.trimEnd();
      console.log(`[holder] ${line}`);
      const holdingTurn = /HOLDING turn ([0-9a-f-]+)/.exec(line);
      if (holdingTurn) {
        occupyingTurnId = holdingTurn[1];
        holdingResolve?.();
      }
    });
    holder.stderr?.on("data", (d) => console.log(`[holder!] ${d}`.trimEnd()));

    // Do not assert until the other client's turn actually EXISTS: without
    // this the disclosure checks can pass against a stale screen before the
    // holder has started anything, which is a green test proving nothing.
    await Promise.race([
      holding,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("holder never reported HOLDING")),
          60_000,
        ),
      ),
    ]);
    mark("other client is holding the turn");

    // 1. The strip names the other client — never "Responding", which would
    //    present their turn as this browser's own.
    await expect(strip).toContainText(
      "Another client is working in this session",
      { timeout: 60_000 },
    );
    await expect(strip).not.toContainText("Responding");

    // A competing native start must disclose the same occupying UUID through
    // the typed Core contract that the browser's refusal recovery consumes.
    const collision = await promisify(execFile)(
      process.execPath,
      [holderScript, "collide", sessionId!],
      {
        env: holderEnv,
        timeout: 30_000,
      },
    );
    const refused = JSON.parse(collision.stdout.split("COLLIDE RESULT:\n")[1]!);
    expect(refused.error.data).toEqual({
      kind: "turn_in_progress",
      turn_id: occupyingTurnId,
    });

    // 2. A message typed while they hold the slot is QUEUED behind their
    //    turn, not dispatched into a refusal and not discarded. This is the
    //    behaviour the disclosure makes legible: you can see whose turn it is
    //    and still line yours up.
    await composer.fill("my queued message");
    // Submit with Enter, not the send button: while a turn is live the button
    // is the Stop control, so clicking "Send prompt" would silently wait for
    // the other client's turn to end and test nothing.
    await composer.press("Enter");
    await expect(page.getByText("1 queued")).toBeVisible({ timeout: 30_000 });
    // Never the old failure copy: a busy session is not a rejected turn.
    await expect(page.getByText("Turn rejected")).toHaveCount(0);

    // Core cancels only this holder's turn and its tool process. Do not kill
    // host processes by command-name patterns to make a test finish.
    holder.stdin!.write("interrupt\n");
    await expect(page.getByText("1 queued")).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect
      .poll(() => Boolean(queuedTurnId && completed.has(queuedTurnId)), {
        timeout: 60_000,
      })
      .toBe(true);
    mark("queued browser turn completed");
    await expect(strip).not.toContainText(
      "Another client is working in this session",
      { timeout: 60_000 },
    );
  } finally {
    holder?.kill("SIGTERM");
  }
});
