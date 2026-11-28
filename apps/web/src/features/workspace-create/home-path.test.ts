import { describe, expect, it } from "vitest";
import { isUserHomeRoot } from "./home-path.ts";

describe("isUserHomeRoot", () => {
  it("matches platform home roots, never project look-alikes", () => {
    for (const path of ["/home/alice", "/Users/alice/", "C:\\Users\\Bob Smith"])
      expect(isUserHomeRoot(path), path).toBe(true);
    for (const path of ["/home", "/home/alice/projects", "/srv/home/alice", "C:\\Users", "/tmp/work", ""])
      expect(isUserHomeRoot(path), path).toBe(false);
  });
});
