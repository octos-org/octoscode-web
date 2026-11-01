import { describe, expect, it } from "vitest";
import { isRemoteViewUrl, withRemoteView } from "./remote-url.ts";

describe("remote view url", () => {
  it("reads and toggles ?view=remote without touching other params", () => {
    expect(isRemoteViewUrl("https://host:18044/?view=remote")).toBe(true);
    expect(isRemoteViewUrl("https://host:18044/?s=x")).toBe(false);
    expect(withRemoteView("https://host/?s=abc", true)).toBe(
      "https://host/?s=abc&view=remote",
    );
    expect(withRemoteView("https://host/?s=abc&view=remote", false)).toBe(
      "https://host/?s=abc",
    );
  });
});
