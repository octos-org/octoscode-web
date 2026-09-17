import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
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
const holderScript = required("OCTOSCODE_LIVE_HOLDER");
const corePort = required("OCTOSCODE_LIVE_CORE_PORT");
const stubPort = required("OCTOSCODE_LIVE_STUB_PORT");
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the collision gate`);
  return value;
}

function sessionIdsOnDisk(): string[] {
  try {
    return (
      readdirSync(`${cwd}/.octos/main/sessions`)
        .filter((name) => name.endsWith(".jsonl"))
        // Store filenames are percent-encoded; the WIRE key is what the
        // active-turn registry is keyed by, so decode before reusing it.
        .map((name) => decodeURIComponent(name.slice(0, -".jsonl".length)))
    );
  } catch {
    return [];
  }
}

test("discloses the other client's turn instead of claiming it", async ({
  page,
}) => {
  const before = new Set(sessionIdsOnDisk());
  let holder: ChildProcess | undefined;

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

    // One completed turn so the session persists and its id is discoverable.
    await composer.fill("say ok");
    await page.getByRole("button", { name: "Send prompt" }).click();

    let sessionId: string | undefined;
    for (let attempt = 0; attempt < 120 && !sessionId; attempt += 1) {
      sessionId = sessionIdsOnDisk().find((id) => !before.has(id));
      if (!sessionId) await page.waitForTimeout(500);
    }
    expect(
      sessionId,
      "the browser's session must reach the store",
    ).toBeTruthy();
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
    holder = spawn(process.execPath, [holderScript, "hold", sessionId!], {
      env: {
        ...process.env,
        PORT: corePort,
        TOKEN: token,
        WS_CWD: cwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    mark("holder spawned");
    let holdingResolve: (() => void) | undefined;
    const holding = new Promise<void>((resolve) => (holdingResolve = resolve));
    holder.stdout?.on("data", (d) => {
      const line = `${d}`.trimEnd();
      console.log(`[holder] ${line}`);
      if (line.includes("HOLDING turn")) holdingResolve?.();
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

    // 3. When their turn ends, ours runs. Nothing was lost.
    // The other client's BLOCKING TOOL must actually be running before we can
    // end it: `turn/start` returning only means the turn was admitted, and a
    // release sent before the tool spawns kills nothing and leaves the session
    // held forever.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = await (
        await fetch(`http://127.0.0.1:${stubPort}/status`)
      ).json();
      if (status.holdsIssued > 0) break;
      await page.waitForTimeout(500);
    }
    mark("asserted queued; releasing the other client's turn");
    await fetch(`http://127.0.0.1:${stubPort}/release`, { method: "POST" });
    await expect(page.getByText("1 queued")).toHaveCount(0, {
      timeout: 60_000,
    });
    mark("released");
    await expect(strip).not.toContainText(
      "Another client is working in this session",
      { timeout: 60_000 },
    );
  } finally {
    holder?.kill("SIGTERM");
  }
});
