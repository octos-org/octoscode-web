import { expect, test, type Page } from "@playwright/test";

import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { composer, productNavigation } from "./sessions";
import { observeFrames } from "./turn-observers";

const historyDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Resume historical conversation" });
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send prompt" }).click();
}

const control = (name: string, sessionId: string, method?: string) =>
  `${FIXTURE_ORIGIN}/__test__/native/${name}?${new URLSearchParams({ session_id: sessionId, ...(method ? { method } : {}) })}`;

test("resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history", async ({
  page,
  request,
}) => {
  const rpc = observeFrames(page).calls;
  await connectAndStartWorkspace(page, "/srv/work/native-workflows-resume");
  const owner = rpc("session/open").at(-1)!.params!.session_id;
  const seed = await request.post(control("seed-history", owner));
  expect(seed.status()).toBe(200);
  const { sessions } = (await seed.json()) as {
    sessions: { id: string; title: string }[];
  };
  const target = sessions.find(
    (item) => item.title === "Native historical Session A",
  )!;
  expect(target).toBeDefined();
  const opens = rpc("session/open").length;
  const hydrates = rpc("session/hydrate").length;
  await send(page, "/resume Native");
  const dialog = historyDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Unscoped native history (not resumable)",
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: target.title, exact: true }).click();
  const verify = dialog.getByRole("button", {
    name: "Verify history and resume",
  });
  await expect(verify).toBeDisabled();
  expect(rpc("session/open")).toHaveLength(opens);
  expect(rpc("session/hydrate")).toHaveLength(hydrates);
  await dialog
    .getByRole("checkbox", {
      name: /I confirm this Session should open in Profile/,
    })
    .check();
  await verify.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Historical native answer A", { exact: true }),
  ).toBeVisible();
  expect(
    rpc("session/open")
      .slice(opens)
      .map((call) => call.params!.session_id),
  ).toEqual([target.id]);
  expect(
    rpc("session/hydrate")
      .slice(hydrates)
      .map((call) => call.params!.session_id),
  ).toEqual([target.id]);
  expect(rpc("turn/start")).toHaveLength(0);
  await expect(
    productNavigation(page).getByText(
      "Unscoped native history (not resumable)",
    ),
  ).toHaveCount(0);
});
