import { describe, expect, it } from "vitest";
import { knownSessionKey } from "../session/known-session-registry.ts";
import {
  createSavedSessionUrl,
  parseSavedSessionReference,
  type SavedSessionReference,
} from "./saved-session-link.ts";

const reference: SavedSessionReference = {
  workspaceRoot: "/srv/projects/项目 with spaces",
  profileId: "developer",
  sessionId: "developer:api:web-abc#coding",
};

describe("saved session links", () => {
  it("preserves an exact confirmed routing tuple without inventing metadata", () => {
    expect(parseSavedSessionReference(knownSessionKey(reference))).toEqual(
      reference,
    );
    expect(
      parseSavedSessionReference(
        JSON.stringify(["C:\\Projects\\应用", "dev", "dev:api:web-1"]),
      )?.workspaceRoot,
    ).toBe("C:\\Projects\\应用");
    expect(
      parseSavedSessionReference(
        JSON.stringify(["\\\\server\\share\\project", "dev", "web-1"]),
      )?.workspaceRoot,
    ).toBe("\\\\server\\share\\project");
  });

  it.each([
    null,
    "",
    "broken JSON",
    "null",
    "{}",
    '["/srv/project", "dev"]',
    '["/srv/project", "dev", "web-1", "extra"]',
    '["/srv/project", {"profile":"dev"}, "web-1"]',
    '["relative/project", "dev", "web-1"]',
    '["/srv/project", "", "web-1"]',
    '["/srv/project", "dev", " web-1"]',
    JSON.stringify(["/srv/project\nother", "dev", "web-1"]),
    JSON.stringify(["/srv/project", "de\u202ev", "web-1"]),
    JSON.stringify(["/srv/project", "dev", "web-\u0000secret"]),
    JSON.stringify([`/${"p".repeat(4_096)}`, "dev", "web-1"]),
    JSON.stringify(["/srv/project", "p".repeat(513), "web-1"]),
    JSON.stringify(["/srv/project", "dev", "s".repeat(1_025)]),
    " ".repeat(12_001),
  ])("rejects malformed or misleading routing input: %s", (value) => {
    expect(parseSavedSessionReference(value)).toBeNull();
  });

  it("replaces only the saved reference and removes connection credentials", () => {
    const url = new URL(
      createSavedSessionUrl(
        "https://user:password@octos.example/app?theme=dark&s=old&token=secret&ACCESS_TOKEN=secret2#chat",
        reference,
      ),
    );
    expect(url.origin).toBe("https://octos.example");
    expect(url.pathname).toBe("/app");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("token")).toBeNull();
    expect(url.searchParams.get("ACCESS_TOKEN")).toBeNull();
    expect(parseSavedSessionReference(url.searchParams.get("s"))).toEqual(
      reference,
    );
    expect(url.hash).toBe("#chat");
    expect(url.href).not.toMatch(/secret|password/);
  });

  it("refuses non-web links and incomplete references", () => {
    expect(() =>
      createSavedSessionUrl("javascript:alert(1)", reference),
    ).toThrow();
    expect(() =>
      createSavedSessionUrl("https://octos.example", {
        ...reference,
        profileId: "",
      }),
    ).toThrow();
  });
});
