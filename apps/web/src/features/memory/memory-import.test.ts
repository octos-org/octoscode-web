import { describe, expect, it, vi } from "vitest";
import type { MemoryRecord } from "@octos-org/octoscode-client/memory";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import { createUiText } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";
import { memoryExportJson, memoryExportMarkdown } from "./memory-export.ts";
import {
  IMPORT_BATCH,
  IMPORT_MAX_BYTES,
  decodeImport,
  fingerprinted,
  importBatches,
  importFileProblem,
  ingestFailure,
  parseMemoryImport,
  readBack,
  readBackVerdict,
  storedAsSent,
  type ImportRecord,
} from "./memory-import.ts";

const at = new Date("2026-11-05T21:00:00.000Z");
const stored: MemoryRecord = {
  id: "doc:octoscode-web:abc",
  kind: "document",
  source: "octoscode-web",
  title: "京都 <b>行程</b> #1",
  abstract: "has ``` three",
  body: "第一天 ✈️\n<script>alert(1)</script>\n```js\nboom()\n```",
  timestamp: "2026-11-05T20:00:00Z",
  trust: "untrusted",
  visits: 3,
  lastVisit: "2026-11-05T20:10:00Z",
  promoted: false,
  updatedAt: "2026-11-05T20:00:01Z",
};
const recordExport = {
  kind: "record" as const,
  profileId: "coding",
  loaded: { record: stored, pageTruncated: false },
};
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "doc:mail:1",
  kind: "document",
  source: "mail",
  timestamp: "2026-11-05T20:00:00Z",
  title: "t",
  abstract: "a",
  body: "b",
  ...overrides,
});
const expectedRecord = {
  id: stored.id,
  kind: "document",
  source: stored.source,
  timestamp: stored.timestamp,
  title: stored.title,
  abstract: stored.abstract,
  body: stored.body,
};

describe("importing what the page exports", () => {
  it("reads a JSON record export back to the fields ingest takes", () => {
    const parsed = parseMemoryImport(
      "a.json",
      memoryExportJson(recordExport, at),
    );
    expect(parsed).toMatchObject({
      ok: true,
      plan: { format: "json-export", records: [expectedRecord] },
    });
    if (!parsed.ok) return;
    expect(parsed.plan.ignoredFields).toEqual([
      "last_visit",
      "promoted",
      "trust",
      "updated_at",
      "visits",
    ]);
  });
  it.each([
    ["en", createUiText("en")],
    ["zh", createUiText("zh", zh)],
  ])("reads a %s Markdown record export back the same", (language, t) => {
    const markdown = memoryExportMarkdown(recordExport, at, t);
    expect(
      markdown.startsWith(
        language === "zh" ? "# 记忆导出：" : "# Memory export: ",
      ),
    ).toBe(true);
    const parsed = parseMemoryImport("a.md", markdown);
    expect(parsed).toMatchObject({
      ok: true,
      plan: { format: "markdown-export", records: [expectedRecord] },
    });
  });
  it("refuses a search export, which would empty stored bodies", () => {
    const search = {
      kind: "search" as const,
      profileId: "coding",
      query: "q",
      records: [stored],
      limit: 20,
    };
    for (const parsed of [
      parseMemoryImport("s.json", memoryExportJson(search, at)),
      parseMemoryImport(
        "s.md",
        memoryExportMarkdown(search, at, createUiText("en")),
      ),
    ])
      expect(parsed).toEqual({
        ok: false,
        problems: [{ code: "titles_only" }],
      });
  });
  it("refuses an entity export", () => {
    const entity = {
      kind: "entity" as const,
      profileId: "coding",
      entity: {
        name: "e",
        content: "c",
        contentTruncated: false,
        contentTotalBytes: 1,
      },
    };
    expect(parseMemoryImport("e.json", memoryExportJson(entity, at))).toEqual({
      ok: false,
      problems: [{ code: "entity" }],
    });
    expect(
      parseMemoryImport(
        "e.md",
        memoryExportMarkdown(entity, at, createUiText("en")),
      ),
    ).toEqual({ ok: false, problems: [{ code: "entity" }] });
  });
});

describe("importing a record list", () => {
  it("takes an array or { records } and skips later repeats of an id", () => {
    const parsed = parseMemoryImport(
      "l.json",
      JSON.stringify({
        records: [
          row(),
          row({ id: "episode:x", kind: "episode" }),
          row({ title: "again" }),
        ],
      }),
    );
    expect(parsed.ok && parsed.plan.records.map((r) => r.id)).toEqual([
      "doc:mail:1",
      "episode:x",
    ]);
    expect(parsed.ok && parsed.plan.skippedDuplicates).toEqual([
      { index: 2, id: "doc:mail:1" },
    ]);
  });
  it("fails the whole file over one bad record, naming each problem", () => {
    const parsed = parseMemoryImport(
      "l.json",
      JSON.stringify([
        row(),
        row({ id: "doc:other:1" }),
        row({ id: "doc:mail:2", body: undefined }),
        row({ id: "bank:p", kind: "knowledge" }),
        row({ id: "doc:mail:3", timestamp: "yesterday" }),
        row({ id: "doc:mail:4", title: 5 }),
        "text",
      ]),
    );
    expect(parsed).toEqual({
      ok: false,
      problems: [
        { code: "id", index: 1, id: "doc:other:1", expected: "doc:mail:" },
        { code: "missing", index: 2, field: "body" },
        { code: "kind", index: 3, kind: "knowledge" },
        { code: "timestamp", index: 4, value: "yesterday" },
        { code: "not_text", index: 5, field: "title" },
        { code: "not_object", index: 6 },
      ],
    });
  });
  it("names what the server will shorten", () => {
    const parsed = parseMemoryImport(
      "l.json",
      JSON.stringify([
        row({ title: "长".repeat(41), body: "x".repeat(16 * 1024 + 1) }),
      ]),
    );
    expect(parsed.ok && parsed.plan.trimmed).toEqual([
      { id: "doc:mail:1", fields: ["title", "body"] },
    ]);
  });
  it("refuses an empty list, too many records, other JSON and other Markdown", () => {
    expect(parseMemoryImport("l.json", "[]")).toEqual({
      ok: false,
      problems: [{ code: "empty" }],
    });
    expect(
      parseMemoryImport(
        "l.json",
        JSON.stringify(
          Array.from({ length: 501 }, (_, i) => row({ id: `doc:mail:${i}` })),
        ),
      ),
    ).toEqual({ ok: false, problems: [{ code: "too_many", count: 501 }] });
    expect(parseMemoryImport("l.json", "{")).toEqual({
      ok: false,
      problems: [{ code: "invalid_json" }],
    });
    expect(parseMemoryImport("l.json", JSON.stringify({ hits: [] }))).toEqual({
      ok: false,
      problems: [{ code: "unknown_shape" }],
    });
    expect(parseMemoryImport("n.md", "# My notes\n\nhello")).toEqual({
      ok: false,
      problems: [{ code: "unknown_shape" }],
    });
  });
});

describe("import files", () => {
  it("are bounded by name, type and size", () => {
    expect(
      importFileProblem({ name: "a.json", size: 10, type: "" }),
    ).toBeNull();
    expect(
      importFileProblem({ name: "a.md", size: 10, type: "text/markdown" }),
    ).toBeNull();
    expect(
      importFileProblem({
        name: "a.exe",
        size: 10,
        type: "application/x-msdownload",
      }),
    ).toEqual({ code: "wrong_type" });
    expect(
      importFileProblem({ name: "a.json", size: 10, type: "image/png" }),
    ).toEqual({ code: "wrong_type" });
    expect(
      importFileProblem({
        name: "a.json",
        size: IMPORT_MAX_BYTES + 1,
        type: "",
      }),
    ).toEqual({ code: "too_large", bytes: IMPORT_MAX_BYTES + 1 });
  });
  it("must be UTF-8", () => {
    expect(decodeImport(new TextEncoder().encode("京都").buffer)).toBe("京都");
    expect(decodeImport(new Uint8Array([0xff, 0xfe, 0x00]).buffer)).toBeNull();
  });
  it("go out in batches, in order", () => {
    const records = Array.from({ length: IMPORT_BATCH * 2 + 1 }, (_, i) => ({
      ...row({ id: `doc:mail:${i}` }),
    })) as Parameters<typeof importBatches>[0];
    expect(importBatches(records).map((batch) => batch.length)).toEqual([
      IMPORT_BATCH,
      IMPORT_BATCH,
      1,
    ]);
  });
});

describe("fingerprints", () => {
  it("are the same for the same content however it was written", async () => {
    const base = row() as Parameters<typeof fingerprinted>[0][number];
    const [a, b, c] = await fingerprinted([
      base,
      { ...base, timestamp: "2026-11-05T20:00:00.000Z", title: " t " },
      { ...base, body: "changed" },
    ]);
    expect(a!.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b!.fingerprint).toBe(a!.fingerprint);
    expect(c!.fingerprint).not.toBe(a!.fingerprint);
    expect(a).toMatchObject(base);
  });
});

describe("a batch that fails", () => {
  it.each([
    [-32602, "refused"],
    [-32600, "refused"],
    [-32601, "refused"],
    [-32700, "refused"],
    [-32004, "refused"],
    [-32120, "refused"],
    [-32140, "refused"],
    // Core's index persists after the commit, so an internal error can
    // follow a write.
    [-32603, "uncertain"],
    [-32000, "uncertain"],
  ] as const)("server code %i is %s", (code, kind) => {
    expect(ingestFailure(new OctosUiProtocolError(code, "x"))).toBe(kind);
  });
  it("treats a lost reply or an unreadable one as uncertain", () => {
    const timeout = new Error("memory/ingest timed out");
    timeout.name = "OctosUiRequestTimeoutError";
    expect(ingestFailure(timeout)).toBe("uncertain");
    expect(
      ingestFailure(new Error("Octos UI Protocol client disconnected")),
    ).toBe("uncertain");
    expect(ingestFailure(new Error("Invalid memory ingest result"))).toBe(
      "uncertain",
    );
    expect(ingestFailure("odd")).toBe("uncertain");
  });
});

describe("reading a batch back", () => {
  const sent: ImportRecord = {
    id: "doc:octoscode-web:r1",
    kind: "document",
    source: "octoscode-web",
    timestamp: "2026-11-05T21:00:00Z",
    title: "  Title  ",
    abstract: "Summary",
    body: "Body",
    fingerprint: "sha256:aa",
  };
  const kept: MemoryRecord = {
    id: sent.id,
    kind: "document",
    source: "octoscode-web",
    title: "Title",
    abstract: "Summary",
    body: "Body",
  };
  it("goes by the fingerprint when both sides have one", () => {
    expect(storedAsSent(sent, { ...kept, fingerprint: "sha256:aa" })).toBe(
      true,
    );
    expect(storedAsSent(sent, { ...kept, fingerprint: "sha256:bb" })).toBe(
      false,
    );
  });
  it("otherwise compares the text as Core keeps it: trimmed and cut at whole characters", () => {
    const { fingerprint: _, ...unsigned } = sent;
    expect(storedAsSent(unsigned, kept)).toBe(true);
    expect(storedAsSent(unsigned, { ...kept, body: "Other" })).toBe(false);
    const long = { ...unsigned, title: "题".repeat(50) };
    // 120 bytes hold 40 three-byte characters.
    expect(storedAsSent(long, { ...kept, title: "题".repeat(40) })).toBe(true);
    expect(
      storedAsSent({ ...unsigned, body: "  " }, { ...kept, body: undefined }),
    ).toBe(true);
  });
  it("counts each record once, telling missing from unreadable", async () => {
    const batch = ["a", "b", "c", "d"].map((n) => ({
      ...sent,
      id: `doc:octoscode-web:${n}`,
    }));
    const load = vi.fn(async (id: string) => {
      if (id.endsWith(":a"))
        return {
          record: { ...kept, id, fingerprint: "sha256:aa" },
          pageTruncated: false,
        };
      if (id.endsWith(":b"))
        return {
          record: { ...kept, id, fingerprint: "sha256:old" },
          pageTruncated: false,
        };
      if (id.endsWith(":c"))
        throw new OctosUiProtocolError(-32170, "memory_record not found");
      throw new Error("Octos UI Protocol connection is not ready");
    });
    expect(await readBack(batch, load)).toEqual({
      asSent: 1,
      different: 1,
      missing: 1,
      unreadable: 1,
    });
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("settles only what the reads prove", () => {
    const none = { asSent: 0, missing: 0, different: 0, unreadable: 0 };
    expect(readBackVerdict({ ...none, asSent: 3 }, 3)).toBe("written");
    expect(readBackVerdict({ ...none, missing: 2, different: 1 }, 3)).toBe(
      "not-written",
    );
    expect(readBackVerdict({ ...none, asSent: 2, missing: 1 }, 3)).toBe(
      "unknown",
    );
    expect(readBackVerdict({ ...none, missing: 2, unreadable: 1 }, 3)).toBe(
      "unknown",
    );
  });
});
