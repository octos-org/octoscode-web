import { expect, test } from "@playwright/test";
import { holdTerminals } from "./fixture-controls";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session";

test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

test("stopping a turn returns its prompt and files, and sending again needs no upload", async ({
  page,
  request,
}) => {
  const starts: { text: string; media: { path: string }[] }[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start")
        starts.push({
          text: frame.params.input[0].text,
          media: frame.params.media ?? [],
        });
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  let uploads = 0;
  await page.route("**/api/upload", async (route) => {
    const profile = route.request().headers()["x-profile-id"];
    uploads += 1;
    const id = Buffer.from(`${profile}/sales`).toString("base64url");
    await route.fulfill({ json: [`up/${id}/sales.csv`] });
  });
  await startSession(page, `/workspace/stop-attachments-${Date.now()}`);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();

  const attached = page.getByRole("list", { name: "Attached files" });
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("region,sales\nnorth,870\n"),
  });
  await expect(attached.locator('li[data-status="ready"]')).toHaveCount(1);
  await holdTerminals(request);
  await composer.fill("Summarize this file");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(attached).toHaveCount(0);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(composer).toHaveValue("Summarize this file");
  await expect(attached.locator('li[data-status="ready"]')).toContainText(
    "sales.csv",
  );

  await composer.press("Enter");
  await expect.poll(() => starts.length).toBe(2);
  expect(starts[1]!.text).toBe("Summarize this file");
  expect(starts[1]!.media.map((item) => item.path)).toEqual(
    starts[0]!.media.map((item) => item.path),
  );
  expect(starts[1]!.media).toHaveLength(1);
  expect(uploads).toBe(1);
});
