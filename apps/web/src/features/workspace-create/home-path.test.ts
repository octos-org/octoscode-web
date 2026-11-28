import { describe, expect, it } from "vitest";
import { isUserHomeRoot } from "./home-path.ts";

describe("isUserHomeRoot", () => {
  it("matches the platform home roots", () => {
    for (const path of [
      "/home/alice",
      "/home/alice/",
      "/Users/alice",
      "/Users/alice/",
      "C:\\Users\\alice",
      "c:/Users/alice/",
      "D:\\Users\\Bob Smith",
    ]) {
      expect(isUserHomeRoot(path), path).toBe(true);
    }
  });
  it("never matches project folders that merely look similar", () => {
    for (const path of [
      "/home",
      "/Users",
      "/home/alice/projects",
      "/Users/alice/Documents",
      "/srv/home/alice",
      "/opt/home/alice",
      "C:\\Users",
      "C:\\home\\alice",
      "/tmp/work",
      "/data/projects/app",
      "",
    ]) {
      expect(isUserHomeRoot(path), path).toBe(false);
    }
  });
});
