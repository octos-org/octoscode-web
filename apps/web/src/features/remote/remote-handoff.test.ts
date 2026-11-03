import { describe, expect, it } from "vitest";
import { createRemoteHandoffUrl, readRemoteHandoff } from "./remote-handoff.ts";

describe("phone handoff boundary", () => {
  it("copies only the server and distinct folders, dropping all source URL credentials and session state", () => {
    const link = createRemoteHandoffUrl(
      "https://user:secret@web.test/app/?token=secret&s=private&pair=secret#secret",
      "https://core.test/",
      ["/srv/中文 project", "/srv/中文 project", "C:\\work\\demo"],
    );
    const url = new URL(link);
    expect(url.search).toBe("?view=remote");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(link).not.toContain("secret");
    expect(readRemoteHandoff(link)).toEqual({
      kind: "valid",
      endpoint: "https://core.test",
      folders: ["/srv/中文 project", "C:\\work\\demo"],
    });
  });
  it.each([
    "https://u:p@core.test",
    "https://core.test/?token=secret",
    "https://core.test/#secret",
    "javascript:alert(1)",
  ])("rejects a credential-bearing or non-server endpoint %s", (endpoint) => {
    expect(() =>
      createRemoteHandoffUrl("https://web.test", endpoint, ["/srv/a"]),
    ).toThrow();
  });
  it("rejects malformed or oversized handoffs without silently importing a subset", () => {
    for (const payload of [
      "oops",
      JSON.stringify({ endpoint: "https://core.test", folders: ["/srv/a", 4] }),
      JSON.stringify({
        endpoint: "https://core.test",
        folders: Array(21).fill("/srv/a"),
      }),
      JSON.stringify({
        endpoint: "https://core.test",
        folders: ["x".repeat(4097)],
      }),
    ]) {
      expect(
        readRemoteHandoff(
          `https://web.test/?view=remote#handoff=${encodeURIComponent(payload)}`,
        ).kind,
      ).toBe("invalid");
    }
    expect(readRemoteHandoff("https://web.test/?view=remote")).toEqual({
      kind: "none",
    });
  });
});
