/**
 * T-0707 (r9 F-01): deleting the selected Session and reloading BEFORE the
 * delete receipt must not resurrect the id or park on unknown_session.
 *
 * The fixture deletes immediately but holds the receipt, exactly like the r9
 * race: after the reload the remembered Session is already gone on the
 * server, so session/open answers Core's typed `unknown_session`. The app
 * must drop the stale selection, reload the authoritative listing, and land
 * on a safe state with the other Sessions' real titles — never loop the
 * failed open or show the id again.
 */
import { expect, test } from "@playwright/test";
import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  runFolder,
} from "./fixture-session.ts";
import {
  composer,
  newSessionIn,
  productNavigation,
  sendPrompt,
} from "./sessions.ts";

test("a reload before the delete receipt recovers without the deleted Session", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const folder = runFolder("delete-reload-race");
  // Attested scoped listing, like the real Core's session/list {cwd}.
  await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
  );
  await connectAndStartWorkspace(page, folder);
  const navigation = productNavigation(page);
  const workspaceName = folder.split("/").pop()!;
  // Two Sessions with real titles; the second is the one being deleted.
  const rename = async (name: string) => {
    const row = navigation
      .getByRole("treeitem", { name: /New coding session/ })
      .first();
    await row.hover();
    await row.getByRole("button", { name: /^More actions for/ }).click();
    await page.getByRole("menuitem", { name: /^Rename/ }).click();
    await page.getByRole("textbox", { name: /title/i }).fill(name);
    await page.keyboard.press("Enter");
    await expect(
      navigation.getByRole("treeitem", { name: new RegExp(name) }),
    ).toBeVisible();
  };
  await sendPrompt(page, "First session fixture");
  await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
  await rename("First session fixture");
  await newSessionIn(navigation, workspaceName);
  await sendPrompt(page, "Second session fixture");
  await expect(composer(page)).toBeEnabled({ timeout: 30_000 });

  // Delete the selected (second) Session while the receipt is held, then
  // reload before it arrives — the r9 F-01 race.
  await request.post(`${FIXTURE_ORIGIN}/__test__/delete/hold-next`);
  const doomed = navigation
    .getByRole("treeitem", { name: /New coding session/ })
    .first();
  await doomed.hover();
  await doomed.getByRole("button", { name: /^More actions for/ }).click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.reload();

  // Recovery: no unknown-session error, no resurrected row, the surviving
  // Session keeps its real title, and the app lands on a usable state.
  await expect(
    navigation.getByRole("treeitem", { name: /First session fixture/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/unknown session/i)).toHaveCount(0);
  await expect(
    navigation.getByRole("treeitem", { name: /New (coding )?session/ }),
  ).toHaveCount(0);
  await request.post(`${FIXTURE_ORIGIN}/__test__/delete/release`);
});
