/**
 * T-0695 (N4-F04/F05): a Chat's file area and plan card tell the truth.
 *
 * F04: the Outputs drawer lists the folder's user-supplied inputs apart from
 * what the Session produced, and previews them through the workspace route.
 * F05: a completed turn with unticked plan items shows the item count, never
 * a misleading "1 of 3 done" beside "Turn ended".
 */
import { expect, test } from "@playwright/test";
import { observeFrames } from "./turn-observers.ts";
import { composer, newChat, turnFlagOn } from "./two-modes.ts";
import { FIXTURE_ORIGIN } from "./fixture-session.ts";

/** A genuine one-page PDF, so the in-page viewer renders rather than erroring. */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1)
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "binary");
}

test("the outputs drawer lists and previews a folder input the model never wrote", async ({
  page,
  request,
}) => {
  await turnFlagOn(page);
  const frames = observeFrames(page);
  await newChat(page);
  const chatId = frames.calls("session/chat/create")[0]!.params!.session_id;
  // The user dropped an input document into this chat's folder beforehand.
  await request.post(`${FIXTURE_ORIGIN}/__test__/chat-folder/stage`, {
    data: {
      session_id: chatId,
      path: "季度产品评审简报.pdf",
      content: minimalPdf("Q4 Review 42 teams").toString("base64"),
      encoding: "base64",
    },
  });

  // The model's own output rides the draft fixture's write.
  await page
    .getByRole("button", { name: "Allow file outputs" })
    .first()
    .click();
  await expect(page.getByText("File outputs on").first()).toBeVisible();
  await composer(page).fill("Chat draft fixture as a file");
  await composer(page).press("Enter");
  await expect(page.getByRole("heading", { name: "Next week" })).toBeVisible();

  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  // Model output and user input live in clearly separate sections.
  await expect(
    page.getByRole("heading", { name: "Written in this folder" }),
  ).toBeVisible();
  const writtenSection = page.locator("section", {
    has: page.getByRole("heading", { name: "Written in this folder" }),
  });
  const outputRow = writtenSection.getByRole("button", { name: /report\.md/ });
  await expect(outputRow).toBeVisible();
  await outputRow.click();
  await expect(
    page.getByText("Saved into this chat's own folder."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /All outputs|Back/ })
    .first()
    .click();
  const folder = page.getByRole("heading", { name: "Already in this folder" });
  await expect(folder).toBeVisible();
  const folderSection = page.locator("section", {
    has: page.getByRole("heading", { name: "Already in this folder" }),
  });
  const inputRow = folderSection.getByRole("button", {
    name: /季度产品评审简报\.pdf/,
  });
  await expect(inputRow).toContainText("Not written by Octos");
  // The input previews through the workspace read route, in-page.
  await inputRow.click();
  await expect(
    page.getByText("The PDF couldn't be rendered.", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText("PDF", { exact: true }).first()).toBeVisible();
});

test("an ended plan with unticked items shows the count, not a misleading fraction", async ({
  page,
}) => {
  await turnFlagOn(page);
  await newChat(page);
  await composer(page).fill("Chat plan fixture");
  await composer(page).press("Enter");
  await expect(
    page.getByText("All done — 清洗后客户台账.csv is saved."),
  ).toBeVisible();

  const plan = page.locator("[data-plan-block]");
  await expect(plan).toContainText("Turn ended");
  await expect(plan).toContainText("3 plan items");
  await expect(plan).not.toContainText("1 of 3");
  // The real per-item state survives inside the fold.
  await plan.locator("summary").click();
  await expect(plan.getByText("Clean the rows")).toBeVisible();
});
