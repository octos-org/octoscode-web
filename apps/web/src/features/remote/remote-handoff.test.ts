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
});
