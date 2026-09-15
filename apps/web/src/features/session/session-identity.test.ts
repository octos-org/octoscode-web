import { describe, expect, it } from "vitest";
import { bindWebSessionIdToProfile } from "./session-identity.ts";

describe("Web session identity", () => {
  it("binds a fresh intent to a profile-routable API identity", () => {
    expect(bindWebSessionIdToProfile("web-1234-abcd", " coding ")).toBe(
      "coding:api:web-1234-abcd",
    );
  });

  it("does not rewrite an existing server-authored session id", () => {
    expect(
      bindWebSessionIdToProfile("review:local:main#coding", "coding"),
    ).toBe("review:local:main#coding");
  });
});
