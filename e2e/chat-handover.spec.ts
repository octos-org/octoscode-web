import { expect, test, type Page } from "@playwright/test";
import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  openSessionId,
} from "./fixture-session";
import { composer, sendPrompt, stopButton } from "./sessions";
import { observeFrames } from "./turn-observers";

// Contract fixture coverage: the current Core does not advertise external_driver_v1.
// The handover workspace starts idle with a parked external binding, so a
// refused send reaches admission and an explicit acquire can resume chat.
const CWD = "/srv/work/peer-control-";
const RELEASE_METHOD = "session/driver/release";
const START_METHOD = "turn/start";

const strip = (page: Page) =>
  page.getByRole("button", { name: /Session settings/ });

/** Open the pane's Advanced section (the seat's only product home, §4.2). */
async function openAdvanced(page: Page) {
  await strip(page).click();
  const pane = page.getByRole("dialog", {
    name: /Session settings/,
  });
  await expect(pane).toBeVisible();
  const advanced = pane.locator("details.session-config-advanced");
  if ((await advanced.getAttribute("open")) === null) {
    await advanced.locator(":scope > summary").click();
  }
  return pane;
}

test.describe("§5.2 composer handover (external-held session)", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${FIXTURE_ORIGIN}/__test__/driver/reset-all`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
    await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reset`);
  });

  test("a refused Resume chat can be retried, and Resume chat and an owned seat release control before sending once", async ({
    page,
    request,
  }) => {
    const w = observeFrames(page);
    await connectAndStartWorkspace(page, `${CWD}handover-resume`);
    await sendPrompt(page, "hand back and send once");
    await expect(composer(page)).toHaveValue("hand back and send once");
    const master = await openSessionId(page);
    expect(
      (
        await request.post(
          `${FIXTURE_ORIGIN}/__test__/peer-control/variant?session_id=${encodeURIComponent(master)}&variant=acquire-refused-once`,
        )
      ).status(),
    ).toBe(204);
    const pane = await openAdvanced(page);
    const resume = pane
      .locator('[data-session-config-action="resume-chat"]')
      .first();
    await expect(resume).toBeEnabled();
    // The seat is still held: the failure is shown, nothing is sent, the draft
    // stays, and Resume chat is offered again.
    const refused = pane.getByRole("alert").filter({
      hasText: "Couldn't hand back control — your message wasn't sent",
    });
    await expect(refused).toHaveCount(0);
    await resume.click();
    await expect(refused).toBeVisible();
    expect(w.calls(START_METHOD)).toHaveLength(0);
    await expect(composer(page)).toHaveValue("hand back and send once");
    await expect(resume).toBeEnabled();
    await resume.click();

    await expect.poll(() => w.calls(START_METHOD).length).toBe(1);
    expect(
      w.sent
        .filter((frame) =>
          ["session/driver/acquire", RELEASE_METHOD, START_METHOD].includes(
            frame.method ?? "",
          ),
        )
        .map((frame) => frame.method),
    ).toEqual([
      "session/driver/acquire",
      "session/driver/acquire",
      RELEASE_METHOD,
      START_METHOD,
    ]);
    expect(w.calls(RELEASE_METHOD)[0]?.params?.next).toBe("internal");
    expect(w.calls(START_METHOD)[0]?.params?.input[0].text).toBe(
      "hand back and send once",
    );
    await expect(composer(page)).toHaveValue("");

    // Acquiring our own seat is a separate path: the next ordinary send must
    // release that proof, without another acquire or an admission refusal.
    await expect(stopButton(page)).toHaveCount(0);
    await pane
      .getByRole("button", { name: "Acquire seat", exact: true })
      .click();
    await expect(
      pane.getByRole("button", { name: "Release seat", exact: true }),
    ).toBeEnabled();
    await pane.getByRole("button", { name: "Close", exact: true }).click();
    const before = w.sent.length;
    await sendPrompt(page, "send from my seat");
    await expect.poll(() => w.calls(START_METHOD).length).toBe(2);
    expect(
      w.sent
        .slice(before)
        .filter((frame) =>
          ["session/driver/acquire", RELEASE_METHOD, START_METHOD].includes(
            frame.method ?? "",
          ),
        )
        .map((frame) => [frame.method, frame.params?.next ?? null]),
    ).toEqual([
      [RELEASE_METHOD, "internal"],
      [START_METHOD, null],
    ]);
    expect(w.calls(START_METHOD)[1]?.params?.input[0].text).toBe(
      "send from my seat",
    );
    await expect(composer(page)).toHaveValue("");
  });
});
