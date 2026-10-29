import { describe, expect, it, vi } from "vitest";
import {
  blobApiUrl,
  createMediaCommands,
  uploadedHandleForProfile,
} from "../src/media.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";
import { OctosUiClient } from "../src/client.ts";
const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["turn/start", "session/files.list"],
  supported_notifications: [],
};
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
  it("uses bearer/header scope, omits cookies and refuses redirects", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([handle("p1")]), { status: 200 }),
    );
    const commands = createMediaCommands({ ...options, fetch: fetchMock });
    const media = await commands.upload(
      new File(["example"], "note.txt", { type: "text/plain" }),
    );
    expect(media).toEqual({
      path: handle("p1"),
      mime: "text/plain",
      size_bytes: 7,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.href).toBe("https://example.invalid/api/upload");
    expect((init.headers as Headers).get("Authorization")).toBe(
      "Bearer synthetic-blob-token",
    );
    expect((init.headers as Headers).get("X-Profile-Id")).toBe("p1");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeInstanceOf(FormData);
  });
  it("rejects wrong-owner/malformed responses and never echoes a response body", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([handle("p2")])),
    );
    const commands = createMediaCommands({ ...options, fetch: fetchMock });
    const file = new File(["example"], "note.txt");
    await expect(commands.upload(file)).rejects.toThrow("wrong-Profile");
    fetchMock.mockResolvedValueOnce(new Response("synthetic-blob-token"));
    await expect(commands.upload(file)).rejects.toThrow("invalid JSON");
    const disabled = createMediaCommands({
      ...options,
      fetch: fetchMock,
      capabilities: { ...capabilities, supported_methods: [] },
    });
    await expect(disabled.upload(file)).rejects.toThrow("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
