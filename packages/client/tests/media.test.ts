import { describe, expect, it, vi } from "vitest";
import { blobApiUrl, uploadedHandleForProfile } from "../src/media.ts";

import { OctosUiClient } from "../src/client.ts";
import { makeCaps } from "./fixtures/caps.ts";
const capabilities = makeCaps({
  methods: ["turn/start", "session/files.list"],
});
const handle = (owner: string) =>
  "up/" + btoa(owner + "/unique_note.txt").replace(/=+$/, "") + "/note.txt";
const options = {
  endpoint: "wss://example.invalid/api/ui-protocol/ws?token=must-not-keep",
  token: "synthetic-blob-token",
  profileId: "p1",
  sessionId: "p1:local:tui#A",
  capabilities,
};
describe("authenticated blob transport candidate", () => {
  it("obtains transfer credentials from the client without placing them in URLs", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([handle("p1")])),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new OctosUiClient(options);
      const commands = await client.mediaCommands(
        options.sessionId,
        options.profileId,
        capabilities,
      );
      await commands.upload(new File(["candidate"], "note.txt"));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(url.search).toBe("");
      expect((init.headers as Headers).get("Authorization")).toBe(
        "Bearer synthetic-blob-token",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps routing prefixes, rejects ambiguous endpoints and strips URL credentials/parameters", () => {
    expect(
      blobApiUrl(
        "wss://example.invalid/prefix/api/ui-protocol/ws?token=x",
        "upload",
      ).href,
    ).toBe("https://example.invalid/prefix/api/upload");
    expect(() => blobApiUrl("wss://example.invalid/custom", "upload")).toThrow(
      "custom",
    );
    expect(() =>
      blobApiUrl("https://user:password@example.invalid", "files"),
    ).toThrow("credentials");
  });
  it("requires the upload handle to belong to the selected Profile", () => {
    expect(uploadedHandleForProfile(handle("p1"), "p1")).toBe(true);
    expect(uploadedHandleForProfile(handle("p2"), "p1")).toBe(false);
    expect(uploadedHandleForProfile(handle("p1/.."), "p1")).toBe(false);
    expect(uploadedHandleForProfile("/private/key", "p1")).toBe(false);
  });
});
