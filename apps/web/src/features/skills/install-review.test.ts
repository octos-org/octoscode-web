import { describe, expect, it, vi } from "vitest";
import type { SkillPackage } from "@octos-org/octoscode-client/skills";
import {
  findPackage,
  isServerPath,
  readInstallReview,
  skillErrorText,
  withoutCredentials,
} from "./install-review.ts";

const pack = (overrides: Partial<SkillPackage> = {}): SkillPackage => ({
  name: "sample",
  description: "A sample",
  repo: "example/sample",
  version: "1.0.0",
  author: "Example",
  license: "MIT",
  skills: ["sample"],
  requires: ["git"],
  providesTools: true,
  tags: ["demo"],
  installed: false,
  installedSkills: [],
  ...overrides,
});

describe("isServerPath", () => {
  it.each([
    "/srv/skills/a",
    "~/skills/a",
    "./a",
    "../a",
    ".",
    "..",
    ".\\a",
    "..\\a",
    "\\\\host\\a",
    "C:\\skills\\a",
    "c:/skills/a",
  ])("treats %s as a path on the server, as Core does", (repo) => {
    expect(isServerPath(repo)).toBe(true);
  });
  it.each([
    "example/sample",
    "example/sample/sub",
    "https://example.com/a.git",
    "git@example.com:a/b.git",
    ".hidden/repo",
  ])("treats %s as something to clone", (repo) => {
    expect(isServerPath(repo)).toBe(false);
  });
});

describe("findPackage", () => {
  it("matches the exact source and, when reviewing a package, its name", () => {
    const item = pack();
    expect(findPackage([item], { repo: "example/sample", branch: "" })).toBe(
      item,
    );
    expect(findPackage([item], { repo: "example/sample/", branch: "" })).toBe(
      null,
    );
    expect(
      findPackage([item], {
        repo: "example/sample",
        branch: "",
        packageName: "other",
      }),
    ).toBe(null);
  });
  it("lets no entry speak for a repo several entries share", () => {
    const a = pack({ name: "a" });
    const b = pack({ name: "b" });
    expect(findPackage([a, b], { repo: "example/sample", branch: "" })).toBe(
      null,
    );
    expect(
      findPackage([a, b], {
        repo: "example/sample",
        branch: "",
        packageName: "b",
      }),
    ).toBe(b);
  });
});

describe("readInstallReview", () => {
  const source = { repo: "example/sample", branch: "" };
  it("says what the registry says, or that it has nothing", async () => {
    await expect(
      readInstallReview(source, async () => [pack()]),
    ).resolves.toMatchObject({
      standing: "listed",
      package: { name: "sample" },
    });
    await expect(
      readInstallReview(source, async () => []),
    ).resolves.toMatchObject({ standing: "unlisted", package: null });
    await expect(readInstallReview(source, null)).resolves.toMatchObject({
      standing: "not-offered",
      package: null,
    });
  });
  it("doesn't turn an unreadable registry into an unlisted source", async () => {
    await expect(
      readInstallReview(source, async () => {
        throw new Error("registry down");
      }),
    ).rejects.toThrow("registry down");
  });
  it("doesn't need the registry for a path on the server", async () => {
    const read = vi.fn(async () => [pack()]);
    await expect(
      readInstallReview({ repo: "/srv/a", branch: "" }, read),
    ).resolves.toMatchObject({ standing: "server-path", package: null });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("credentials in sources", () => {
  it("are kept out of what the page shows", () => {
    expect(withoutCredentials("https://me:secret@example.com/a.git")).toBe(
      "https://[redacted]@example.com/a.git",
    );
    expect(withoutCredentials("git@example.com:a/b.git")).toBe(
      "git@example.com:a/b.git",
    );
    expect(
      skillErrorText(
        new Error("git clone failed. Check the source: https://tok@x.io/a"),
      ),
    ).toBe("git clone failed. Check the source: https://[redacted]@x.io/a");
  });
});
