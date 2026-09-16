import { describe, expect, it } from "vitest";
import {
  WORKSPACE_LIST_REFUSAL_KINDS,
  WORKSPACE_CREATE_REFUSAL_KINDS,
} from "@octos-org/octoscode-client/protocol";
import zh from "../preferences/zh.ts";
import {
  IDLE_WORKSPACE_BROWSE,
  canCreateWorkspaceFolder,
  joinWorkspacePath,
  parentWorkspacePath,
  validateWorkspaceFolderName,
  workspaceBrowseCopy,
  workspaceBrowseOpenPath,
  workspaceBrowseReducer,
  workspaceBrowseRetryPath,
  workspaceFolderNameCopy,
  workspaceListingNotices,
  type WorkspaceBrowseFailure,
  type WorkspaceFolderListing,
  type WorkspaceFolderNameProblem,
} from "./workspace-browse.ts";

const LISTING: WorkspaceFolderListing = {
  canonicalPath: "/Users/me/projects",
  parentPath: "/Users/me",
  writable: true,
  entries: [{ name: "app", path: "/Users/me/projects/app", writable: true }],
  truncated: false,
  hiddenSkipped: 0,
};

describe("path arithmetic", () => {
  it.each([
    ["/Users/me/projects", "/Users/me"],
    ["/Users/me/projects/", "/Users/me"],
    ["/Users", "/"],
    ["/Users/", "/"],
    ["/", null],
    ["", null],
    ["   ", null],
    ["~", null],
    ["~/", null],
    ["~/projects", "~"],
  ])("derives the parent of %s", (path, parent) => {
    expect(parentWorkspacePath(path)).toBe(parent);
  });

  it("joins one component onto a canonical path", () => {
    expect(joinWorkspacePath("/Users/me/projects", "new-app")).toBe(
      "/Users/me/projects/new-app",
    );
    expect(joinWorkspacePath("/Users/me/projects/", "new-app")).toBe(
      "/Users/me/projects/new-app",
    );
    expect(joinWorkspacePath("/", "new-app")).toBe("/new-app");
  });

  it("opens on the server working directory only for an empty box", () => {
    expect(workspaceBrowseOpenPath("")).toBeNull();
    expect(workspaceBrowseOpenPath("   ")).toBeNull();
    expect(workspaceBrowseOpenPath("  /srv/projects  ")).toBe("/srv/projects");
    expect(workspaceBrowseOpenPath("~/projects")).toBe("~/projects");
  });

  it("walks up to the nearest ancestor, then to the working directory", () => {
    // A typed path that does not exist resolves to its nearest listable
    // ancestor; the last step is `null` = the server's working directory.
    expect(
      workspaceBrowseRetryPath("/srv/a/b", "workspace_list_not_found"),
    ).toBe("/srv/a");
    expect(workspaceBrowseRetryPath("/srv", "workspace_list_not_found")).toBe(
      "/",
    );
    expect(
      workspaceBrowseRetryPath("/", "workspace_list_not_found"),
    ).toBeNull();
    expect(
      workspaceBrowseRetryPath("/srv/a", "workspace_list_not_a_directory"),
    ).toBe("/srv");
    expect(
      workspaceBrowseRetryPath("/srv/a", "workspace_list_invalid_path"),
    ).toBe("/srv");
    // A refusal that ascending cannot fix stops immediately.
    for (const failure of [
      "workspace_list_permission_denied",
      "workspace_list_root_escape",
      "profile_local_unsupported",
      "unknown",
    ] as const)
      expect(workspaceBrowseRetryPath("/srv/a", failure)).toBeUndefined();
    // Nothing is left to try once the working directory itself refused.
    expect(
      workspaceBrowseRetryPath(null, "workspace_list_not_found"),
    ).toBeUndefined();
  });
});

describe("folder name rules mirror the server's", () => {
  it.each([
    ["", "empty"],
    ["a/b", "separator"],
    ["/abs", "separator"],
    ["a\\b", "separator"],
    [".", "relative"],
    ["..", "relative"],
    [`a${String.fromCodePoint(0)}b`, "control"],
    ["a\nb", "control"],
    [`a${String.fromCodePoint(0x7f)}b`, "control"],
    [" leading", "surrounding_whitespace"],
    ["trailing ", "surrounding_whitespace"],
    ["   ", "surrounding_whitespace"],
    ["a".repeat(256), "too_long"],
    // 255 bytes is the limit in BYTES, not characters.
    ["é".repeat(128), "too_long"],
  ])("rejects %j", (name, problem) => {
    expect(validateWorkspaceFolderName(name)).toBe(problem);
  });

  it.each(["new-app", "a", "a".repeat(255), "é".repeat(127), "项目", "a b"])(
    "accepts %j",
    (name) => {
      expect(validateWorkspaceFolderName(name)).toBeNull();
    },
  );
});

describe("bounded copy for every typed kind", () => {
  const failures: WorkspaceBrowseFailure[] = [
    ...WORKSPACE_LIST_REFUSAL_KINDS,
    ...WORKSPACE_CREATE_REFUSAL_KINDS,
    "unknown",
  ];

  it("gives each kind a message and a next step, in English and Chinese", () => {
    const seen = new Set<string>();
    for (const failure of failures) {
      const copy = workspaceBrowseCopy(failure);
      expect(copy.message, failure).toBeTruthy();
      expect(copy.nextStep, failure).toBeTruthy();
      // A next step is a sentence telling the operator what to do, not a
      // restatement of the failure.
      expect(copy.nextStep, failure).not.toBe(copy.message);
      expect(zh[copy.message], `zh: ${copy.message}`).toBeTruthy();
      expect(zh[copy.nextStep], `zh: ${copy.nextStep}`).toBeTruthy();
      seen.add(`${copy.message}|${copy.nextStep}`);
    }
    // profile_local_unsupported is shared by both families; every other kind
    // reads distinctly so the operator can tell them apart.
    expect(seen.size).toBe(failures.length - 1);
  });

  it("translates every name rule and every listing notice", () => {
    const problems: WorkspaceFolderNameProblem[] = [
      "empty",
      "separator",
      "relative",
      "control",
      "surrounding_whitespace",
      "too_long",
    ];
    for (const problem of problems) {
      const source = workspaceFolderNameCopy(problem);
      expect(source, problem).toBeTruthy();
      expect(zh[source], `zh: ${source}`).toBeTruthy();
    }
    for (const notice of workspaceListingNotices({
      ...LISTING,
      truncated: true,
      hiddenSkipped: 3,
    }))
      expect(zh[notice.source], `zh: ${notice.source}`).toBeTruthy();
  });

  it("never renders a raw server string", () => {
    // An unrecognized kind falls into the client's own bucket rather than
    // reaching for the server's prose.
    expect(
      workspaceBrowseCopy("workspace_list_future" as WorkspaceBrowseFailure),
    ).toEqual(workspaceBrowseCopy("unknown"));
  });
});

describe("truncated and hidden_skipped are reported honestly", () => {
  it("says nothing when the server set neither", () => {
    expect(workspaceListingNotices(LISTING)).toEqual([]);
  });

  it("reports the page cap and the skipped dot-directories", () => {
    expect(
      workspaceListingNotices({
        ...LISTING,
        truncated: true,
        hiddenSkipped: 3,
      }),
    ).toEqual([
      {
        source: "Only the first {value0} folders are shown.",
        params: { value0: 1 },
      },
      {
        source: "{value0} hidden folders aren't shown.",
        params: { value0: 3 },
      },
    ]);
  });
});

describe("browse reducer", () => {
  it("keeps the last good listing visible when a step is refused", () => {
    const ready = workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
      type: "listed",
      listing: LISTING,
    });
    const refused = workspaceBrowseReducer(
      workspaceBrowseReducer(ready, { type: "loading" }),
      { type: "failed", failure: "workspace_list_permission_denied" },
    );
    expect(refused.listing).toEqual(LISTING);
    expect(refused.failure).toBe("workspace_list_permission_denied");
    expect(refused.loading).toBe(false);
  });

  it("clears the refusal when the next step starts", () => {
    const refused = workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
      type: "failed",
      failure: "unknown",
    });
    expect(
      workspaceBrowseReducer(refused, { type: "loading" }).failure,
    ).toBeNull();
  });

  it("pre-validates the new folder name before any request", () => {
    const naming = workspaceBrowseReducer(
      workspaceBrowseReducer(
        workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
          type: "listed",
          listing: LISTING,
        }),
        { type: "new-folder-open" },
      ),
      { type: "new-folder-name", name: "a/b" },
    );
    const rejected = workspaceBrowseReducer(naming, { type: "create" });
    expect(rejected.nameProblem).toBe("separator");
    expect(rejected.creating).toBe(false);

    const valid = workspaceBrowseReducer(naming, {
      type: "new-folder-name",
      name: "new-app",
    });
    const accepted = workspaceBrowseReducer(valid, { type: "create" });
    expect(accepted.nameProblem).toBeNull();
    expect(accepted.creating).toBe(true);
  });

  it("closes the name form once the new folder is listed", () => {
    const creating = workspaceBrowseReducer(
      workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
        type: "new-folder-open",
      }),
      { type: "create" },
    );
    const created = workspaceBrowseReducer(creating, { type: "created" });
    expect(created.creating).toBe(false);
    expect(created.newFolderOpen).toBe(false);
    const listed = workspaceBrowseReducer(created, {
      type: "listed",
      listing: { ...LISTING, canonicalPath: "/Users/me/projects/new-app" },
    });
    expect(listed.listing?.canonicalPath).toBe("/Users/me/projects/new-app");
    expect(listed.newFolderName).toBe("");
  });

  it("surfaces a create refusal without losing the folder or the name form", () => {
    const creating = workspaceBrowseReducer(
      workspaceBrowseReducer(
        workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
          type: "listed",
          listing: LISTING,
        }),
        { type: "new-folder-open" },
      ),
      { type: "create" },
    );
    const failed = workspaceBrowseReducer(creating, {
      type: "create-failed",
      failure: "workspace_create_permission_denied",
    });
    expect(failed.creating).toBe(false);
    expect(failed.newFolderOpen).toBe(true);
    expect(failed.listing).toEqual(LISTING);
    expect(failed.failure).toBe("workspace_create_permission_denied");
  });

  it("resets to idle when browsing closes", () => {
    expect(
      workspaceBrowseReducer(
        workspaceBrowseReducer(IDLE_WORKSPACE_BROWSE, {
          type: "listed",
          listing: LISTING,
        }),
        { type: "reset" },
      ),
    ).toEqual(IDLE_WORKSPACE_BROWSE);
  });

  it("offers New folder only where the server says it is writable", () => {
    expect(canCreateWorkspaceFolder(LISTING)).toBe(true);
    expect(canCreateWorkspaceFolder({ ...LISTING, writable: false })).toBe(
      false,
    );
    expect(canCreateWorkspaceFolder(null)).toBe(false);
  });
});
