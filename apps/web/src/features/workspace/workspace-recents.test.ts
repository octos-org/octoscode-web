import { describe, expect, it } from "vitest";
import {
  clearRecentWorkspaces,
  loadRecentWorkspaces,
  rememberWorkspace,
  workspaceName,
} from "./workspace-recents.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    dump: () => [...values.values()].join("\n"),
  };
}

describe("workspace recents", () => {
  it("remembers only a server workspace descriptor", () => {
    const storage = memoryStorage();
    rememberWorkspace(
      storage,
      "https://octos.example",
      "/srv/projects/octoscode",
      42,
    );

    expect(loadRecentWorkspaces(storage, "https://octos.example")).toEqual([
      {
        id: "/srv/projects/octoscode",
        name: "octoscode",
        path: "/srv/projects/octoscode",
        lastOpenedAt: 42,
      },
    ]);
    expect(storage.dump()).not.toContain("Fix auth");
  });

  it("keeps deployments isolated and fails closed on malformed storage", () => {
    const storage = memoryStorage();
    rememberWorkspace(storage, "https://one.example", "/srv/one", 1);
    expect(loadRecentWorkspaces(storage, "https://two.example")).toEqual([]);
    storage.setItem(
      "octoscode.product.workspace-recents.v2:https%3A%2F%2Ftwo.example",
      "not-json",
    );
    expect(loadRecentWorkspaces(storage, "https://two.example")).toEqual([]);
  });

  it("derives a human workspace name from host paths", () => {
    expect(workspaceName("/srv/projects/octoscode/")).toBe("octoscode");
    expect(workspaceName("C:\\work\\octoscode")).toBe("octoscode");
  });

  it("forgets the server-scoped navigation cache", () => {
    const storage = memoryStorage();
    rememberWorkspace(storage, "https://octos.example", "/srv/work", 1);
    clearRecentWorkspaces(storage, "https://octos.example");
    expect(loadRecentWorkspaces(storage, "https://octos.example")).toEqual([]);
  });

  it("removes the legacy cache that contained session metadata", () => {
    const storage = memoryStorage();
    storage.setItem(
      "octoscode.product.workspace-recents.v1:https%3A%2F%2Foctos.example",
      '[{"path":"/srv/work","sessions":[{"id":"secret","title":"private"}]}]',
    );
    clearRecentWorkspaces(storage, "https://octos.example");
    expect(
      storage.getItem(
        "octoscode.product.workspace-recents.v1:https%3A%2F%2Foctos.example",
      ),
    ).toBeNull();
  });
});
