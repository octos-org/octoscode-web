import { describe, expect, it } from "vitest";
import {
  bindWebSessionIdToProfile,
  freshWebSessionId,
} from "./session-identity.ts";

describe("Web session identity", () => {
  it("keeps a fresh launch intent neutral until Core resolves the profile", () => {
    expect(freshWebSessionId(() => "1234-abcd")).toBe("web-1234-abcd");
  });

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
