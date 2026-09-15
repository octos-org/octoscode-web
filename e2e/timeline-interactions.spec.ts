import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

test("keeps activity and reader-controlled disclosures correct across ten streamed turns", async ({
  page,
}) => {
  let emit: ((type: string, data: Record<string, unknown>) => void) | undefined;
  let cursor = 10;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as {
        id: string | number;
        method?: string;
        params?: { session_id?: string; turn_id?: string };
      };
      if (request.method !== "turn/start") {
        server.send(message);
        return;
      }
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { accepted: true },
        }),
      );
      let seq = 0;
      emit = (type, data) =>
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "projection/envelope",
            params: {
              session_id: request.params?.session_id,
              turn_id: request.params?.turn_id,
              thread_id: `timeline-${request.params?.turn_id}`,
              seq: ++seq,
              cursor: { stream: request.params?.session_id, seq: ++cursor },
              payload: { type, data },
            },
          }),
        );
    });
  });

  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/timeline-interactions");
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await expect(composer).toBeVisible();

  for (let round = 1; round <= 10; round += 1) {
    emit = undefined;
    await composer.fill(`Inspect file ${round}`);
    await composer.press("Enter");
    await expect.poll(() => Boolean(emit)).toBe(true);
    emit!("user_message", { text: `Inspect file ${round}` });
    emit!("reasoning_delta", { text: `Inspecting file ${round}` });
    const thought = page.locator("details").filter({
      has: page.getByText(`Inspecting file ${round}`, { exact: true }),
    });
    await expect(thought).not.toHaveAttribute("open");
    if (round === 1) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(thought.locator('[data-status="running"]')).toHaveCSS(
        "animation-name",
        "none",
      );
      await thought.locator("summary").focus();
      await expect(thought.locator("summary")).toBeFocused();
      await expect(thought.locator("summary")).toHaveCSS(
        "outline-style",
        "solid",
      );
      await thought.locator("summary").press("Enter");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    } else {
      await thought.locator("summary").click();
    }
    await expect(thought).toHaveAttribute("open");

    emit!("tool_start", {
      tool_call_id: `read-${round}`,
      name: `read_file_${round}`,
    });
    const tool = page
      .locator("details")
      .filter({ has: page.getByText(`read_file_${round}`, { exact: true }) });
    await expect(tool).not.toHaveAttribute("open");
    await tool.locator("summary").focus();
    await tool.locator("summary").press("Space");
    emit!("tool_end", {
      tool_call_id: `read-${round}`,
      status: "complete",
      output_preview: `File ${round} contents`,
    });
    await expect(tool).toHaveAttribute("open");
    await expect(thought).toHaveAttribute("open");
    await expect(
      page.getByRole("status").filter({ hasText: "Preparing next step…" }),
    ).toBeVisible();

    emit!("assistant_persisted", {
      assistant_segment_id: "empty-preamble",
      text: "",
      meta: { message_id: `empty-${round}` },
    });
    emit!("assistant_persisted", {
      assistant_segment_id: "answer",
      text: `File ${round} is ready.`,
      meta: { message_id: `answer-${round}` },
    });
    emit!("assistant_delta", {
      assistant_segment_id: "answer",
      text: " is ready.",
    });
    emit!("turn_terminal", {
      outcome: round === 10 ? "interrupted" : "completed",
    });
    emit!("reasoning_delta", {
      text: "Late reasoning must not reopen the turn.",
    });
    await expect(
      page.getByText(`File ${round} is ready.`, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('details[data-live="true"]')).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Preparing next step…" }),
    ).toHaveCount(0);
    await expect(page.getByText("No output yet", { exact: true })).toHaveCount(
      0,
    );
    await expect(thought).toHaveAttribute("open");
    await expect(tool).toHaveAttribute("open");
  }
  await page.screenshot({
    path: test.info().outputPath("timeline-completed.png"),
  });
});
