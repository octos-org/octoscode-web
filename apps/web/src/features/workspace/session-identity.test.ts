import { describe, expect, it } from "vitest";
import { freshWebSessionId } from "./session-identity.ts";

describe("freshWebSessionId", () => {
  it("keeps profile routing in the durable session identity", () => {
    expect(freshWebSessionId("coding", () => "1234-abcd")).toBe(
      "coding:api:web-1234-abcd",
    );
  });

  it("uses Core's raw SPA convention only without a resolved profile", () => {
    expect(freshWebSessionId("", () => "1234-abcd")).toBe("web-1234-abcd");
  });
});
