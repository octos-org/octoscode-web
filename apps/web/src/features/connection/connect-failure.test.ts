import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyConnectFailure,
  connectFailureCopy,
  probeRejectedToken,
} from "./connect-failure.ts";

afterEach(() => vi.unstubAllGlobals());

describe("§5.1 connect failure classification", () => {
  it("classifies an unreachable server from the handshake error", () => {
    const failure = classifyConnectFailure(
      "Could not open the Octos UI Protocol connection",
    );
    expect(failure?.kind).toBe("unreachable");
  });

  it("classifies a rejected token", () => {
    expect(classifyConnectFailure("The server refused this token")?.kind).toBe(
      "rejected-token",
    );
  });

  it("classifies an origin the server does not allow", () => {
    expect(classifyConnectFailure("Origin not allowed")?.kind).toBe(
      "origin-not-allowed",
    );
  });

  it("leaves an unrelated error unclassified (no false copy)", () => {
    expect(
      classifyConnectFailure("Server protocol contract is incompatible"),
    ).toBeNull();
  });
});

describe("§5.1 connect failure copy", () => {
  it("unreachable: names the origin with check-address + Retry actions", () => {
    const copy = connectFailureCopy(
      { kind: "unreachable" },
      "https://octos.example.com",
    );
    expect(copy.message).toBe("Can't reach https://octos.example.com");
    expect(copy.actions).toContain("check the address");
    expect(copy.actions).toContain("Retry");
  });

  it("rejected token: says the server refused it and focuses the field", () => {
    const copy = connectFailureCopy({ kind: "rejected-token" }, "https://x");
    expect(copy.message).toBe("The server refused this token");
    expect(copy.focusTokenField).toBe(true);
  });

  it("origin not allowed: says the site isn't allowed to talk to the server", () => {
    const copy = connectFailureCopy(
      { kind: "origin-not-allowed" },
      "https://x",
      "https://app.example.com",
    );
    expect(copy.message).toBe(
      "This site isn't allowed to talk to that server — ask the server owner to allow https://app.example.com",
    );
    expect(copy.focusTokenField).not.toBe(true);
  });
});

describe("rejected-token probe", () => {
  it("recognizes only an actual 401 from auth/me", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      probeRejectedToken(
        "wss://octos.example.com/api/ui-protocol/ws",
        " secret ",
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://octos.example.com/api/auth/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
        credentials: "omit",
      }),
    );
  });

  it("keeps network failures and non-401 responses unclassified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      probeRejectedToken(
        "ws://127.0.0.1:1/api/ui-protocol/ws",
        "secret",
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403 }));
    await expect(
      probeRejectedToken(
        "ws://localhost/api/ui-protocol/ws",
        "secret",
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });
});
