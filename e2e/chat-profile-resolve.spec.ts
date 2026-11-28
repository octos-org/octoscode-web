/**
 * T-0731 (T-0720 F-02): two-modes on, no Code session opened — "New chat"
 * must resolve the server's profile and actually create the chat, never a
 * silent zero-RPC no-op; a server with no profile gets guidance instead.
 */
import { expect, test } from "@playwright/test";
import { connect } from "./fixture-session.ts";
import { observeFrames } from "./turn-observers.ts";
import { interceptRequests, sendResult } from "./wire.ts";
import { modeButton, turnFlagOn } from "./two-modes.ts";

async function newChatFromHome(page: import("@playwright/test").Page) {
  await turnFlagOn(page);
  await connect(page, "/", "two-modes-browse-e2e-token");
  await modeButton(page, "Chat").click();
  await page.getByRole("button", { name: "New chat" }).first().click();
}

test("new chat before any Code session resolves the profile and opens", async ({
  page,
}) => {
  // A dedicated resolved profile keeps this created chat out of the shared
  // fixture's `_main` catalog that other specs assert on.
  await interceptRequests(page, (request, socket) => {
    if (request.method !== "launch/resolve") return;
    sendResult(socket, request.id, {
      decision: "resume",
      resolved_profile: "chat-resolve-e2e",
    });
    return true;
  });
  const frames = observeFrames(page);
  await newChatFromHome(page);
  await expect(page.getByPlaceholder("Ask Octos anything…")).toBeEnabled();
  const creates = frames.calls("session/chat/create");
  expect(creates).toHaveLength(1);
  expect(creates[0]!.params!.profile_id).toBe("chat-resolve-e2e");
  // Routed-away requests do not emit `framesent`; the intercepted resolve
  // proves itself: no Session was opened before the create, and the profile
  // above is only obtainable through launch/resolve.
  expect(frames.calls("session/open").length).toBe(1);
});

test("a server with no profile gets guidance, not a silent no-op", async ({
  page,
}) => {
  await interceptRequests(page, (request, socket) => {
    if (request.method !== "launch/resolve") return;
    sendResult(socket, request.id, {
      decision: "no_profile",
      existing_profiles: [],
    });
    return true;
  });
  const frames = observeFrames(page);
  await newChatFromHome(page);
  await expect(
    page.getByText(
      "No usable model setup yet. Open a Code session once to finish setup, then start a chat.",
    ),
  ).toBeVisible();
  expect(frames.calls("session/chat/create")).toHaveLength(0);
});
