import { expect, test } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session";
import { sessionRow } from "./sessions";
import { sendError } from "./wire";

test("a new session gets the saved permission default once, under its own id, and a refused one is reported on that session", async ({
  page,
}) => {
  // Frames pass through; while `refuse` is set, the server never sees a set
  // and the page gets an error for it.
  const sets: { session_id?: string; update?: Record<string, unknown> }[] = [];
  const opens: string[] = [];
  const starts: string[] = [];
  let refuse = false;
  // While set, the server advertises no launch/resolve, as an older Core: a
  // new session then opens under its bare launch id, bound to no profile.
  let noLaunchResolve = false;
  const strip = (capabilities?: { supported_methods?: string[] }) => {
    if (capabilities?.supported_methods)
      capabilities.supported_methods = capabilities.supported_methods.filter(
        (method) => method !== "launch/resolve",
      );
  };
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (!noLaunchResolve) return socket.send(message);
      const frame = JSON.parse(String(message));
      strip(frame.result?.capabilities);
      strip(frame.result?.opened?.capabilities);
      socket.send(JSON.stringify(frame));
    });
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "session/open") opens.push(frame.params.session_id);
      if (frame.method === "turn/start") starts.push(frame.params.session_id);
      if (frame.method === "permission/profile/set") {
        sets.push(frame.params);
        if (refuse) {
          sendError(socket, frame.id, {
            code: -32603,
            message: "Permission profile is locked",
          });
          return;
        }
      }
      server.send(message);
    });
  });
  const { repeatEachIndex, retry } = test.info();
  const name = `unfinished-defaults-apply-${repeatEachIndex}-${retry}`;
  await connectAndStartWorkspace(page, `/workspace/${name}`);
  const opened = () =>
    (JSON.parse(new URL(page.url()).searchParams.get("s")!) as string[])[2]!;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("region", { name: "Defaults", exact: true })
    .locator('[data-defaults-field="permission-mode"]')
    .getByRole("combobox")
    .selectOption("read_only");
  await page.keyboard.press("Escape");
  expect(sets).toHaveLength(0);

  const sidebar = page.locator("aside");
  const newSession = async () => {
    const before = opened();
    await sidebar
      .locator(`[role="treeitem"][aria-label=${JSON.stringify(name)}]`)
      .getByRole("button", { name, exact: true })
      .hover();
    await sidebar
      .getByRole("button", { name: `New session in ${name}` })
      .click();
    await expect.poll(opened).not.toBe(before);
    return opened();
  };
  const permissions = async () => {
    await page.getByRole("button", { name: /Session settings/ }).click();
    return page
      .getByRole("dialog", { name: "Session settings", exact: true })
      .getByRole("region", { name: "Permissions", exact: true });
  };
  const closePane = () =>
    page.getByRole("button", { name: "Close", exact: true }).click();

  // The set goes to the id the session was opened with, once.
  const created = await newSession();
  const createdRow = new URL(page.url()).searchParams.get("s")!;
  await expect.poll(() => sets.length).toBe(1);
  expect(sets[0]).toMatchObject({
    session_id: created,
    update: { mode: "read_only" },
  });
  expect(opens.at(-1)).toBe(created);

  // A refused default fails closed on its own session, which keeps what the
  // server says it has: nothing is sent there until a retry is confirmed.
  refuse = true;
  const refused = await newSession();
  const refusedRow = new URL(page.url()).searchParams.get("s")!;
  await expect.poll(() => sets.length).toBe(2);
  expect(sets[1]!.session_id).toBe(refused);
  const blocked = page
    .getByRole("alert")
    .filter({ hasText: "sending is blocked in this session" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(blocked).toBeVisible();
  await composer.fill("Only once the default applies");
  await composer.press("Enter");
  let section = await permissions();
  await expect(section.getByRole("alert")).toContainText(
    "Couldn't apply the new-session permission default",
  );
  await expect(
    section.getByRole("button", { name: /^Permission: Write/ }),
  ).toBeVisible();
  await closePane();
  await expect(composer).toHaveValue("Only once the default applies");
  await sessionRow(sidebar, createdRow).click();
  // The other session shows its default and is not blocked.
  await expect.poll(opened).toBe(created);
  await expect(blocked).toHaveCount(0);
  section = await permissions();
  await expect(
    section.getByRole("button", { name: /^Permission: Read/ }),
  ).toBeVisible();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await closePane();

  refuse = false;
  await sessionRow(sidebar, refusedRow).click();
  await expect.poll(opened).toBe(refused);
  await blocked
    .getByRole("button", { name: "Retry permission default" })
    .click();
  await expect(blocked).toHaveCount(0);
  expect(sets.slice(2)).toMatchObject([
    { session_id: refused, update: { mode: "read_only" } },
  ]);
  expect(starts).not.toContain(refused);
  await composer.press("Enter");
  await expect
    .poll(() => starts.filter((id) => id === refused))
    .toHaveLength(1);
  await expect(composer).toHaveValue("");

  // A session opened under its bare launch id is not bound to the profile it
  // runs under: the default is never sent to that id, and it stays blocked.
  noLaunchResolve = true;
  await page.reload();
  const other = await newSession();
  expect(other).toMatch(/^web-/);
  await expect(
    page.getByRole("alert").filter({ hasText: "was not sent" }),
  ).toBeVisible();
  await composer.fill("Never under the wrong profile");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Retry permission default" }),
  ).toHaveCount(0);
  await expect(composer).toHaveValue("Never under the wrong profile");
  expect(sets).toHaveLength(3);
  expect(starts).not.toContain(other);
});
