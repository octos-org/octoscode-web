import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "@octos-org/octoscode-client/memory";
import { createUiText } from "../preferences/ui-text.tsx";
import {
  MEMORY_EXPORT_FORMAT,
  mayHaveMore,
  memoryExportFileName,
  memoryExportJson,
  memoryExportMarkdown,
  type MemoryExportScope,
} from "./memory-export.ts";

const at = new Date("2026-11-05T20:30:00.000Z");
const t = createUiText("en");
const hit = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: "doc:1",
  kind: "document",
  source: "octoscode-web",
  title: "旅行 ✈️ notes",
  abstract: "summary",
  timestamp: "2026-11-05T20:00:00Z",
  trust: "observed",
  score: 1.5,
  ...overrides,
});
const search = (records: MemoryRecord[], limit = 20): MemoryExportScope => ({
  kind: "search",
  profileId: "coding",
  query: "旅行",
  records,
  limit,
});

describe("memory export JSON", () => {
  it("carries the scope and only the fields the server sent", () => {
    const exported = JSON.parse(memoryExportJson(search([hit()]), at));
    expect(exported).toEqual({
      format: MEMORY_EXPORT_FORMAT,
      exported_at: "2026-11-05T20:30:00.000Z",
      complete_backup: false,
      scope: {
        what: "search_results",
        profile_id: "coding",
        query: "旅行",
        count: 1,
        requested_limit: 20,
        may_have_more: false,
      },
      records: [
        {
          id: "doc:1",
          kind: "document",
          source: "octoscode-web",
          title: "旅行 ✈️ notes",
          abstract: "summary",
          timestamp: "2026-11-05T20:00:00Z",
          trust: "observed",
          score: 1.5,
        },
      ],
    });
  });
  it("says when a full page may not be all of it", () => {
    const full = search([hit({ id: "a" }), hit({ id: "b" })], 2);
    expect(mayHaveMore(full)).toBe(true);
    expect(JSON.parse(memoryExportJson(full, at)).scope.may_have_more).toBe(
      true,
    );
  });
  it("keeps a record's page and truncation, and an entity's size", () => {
    const record = JSON.parse(
      memoryExportJson(
        {
          kind: "record",
          profileId: "coding",
          loaded: {
            record: hit({
              body: "body",
              visits: 2,
              lastVisit: "2026-11-05T20:10:00Z",
              promoted: false,
              updatedAt: "2026-11-05T20:00:01Z",
            }),
            page: "page text",
            pageTruncated: true,
          },
        },
        at,
      ),
    );
    expect(record.scope).toEqual({
      what: "memory_record",
      profile_id: "coding",
    });
    expect(record.record).toMatchObject({
      body: "body",
      visits: 2,
      last_visit: "2026-11-05T20:10:00Z",
      promoted: false,
      updated_at: "2026-11-05T20:00:01Z",
    });
    expect(record.page).toBe("page text");
    expect(record.page_truncated).toBe(true);
    const entity = JSON.parse(
      memoryExportJson(
        {
          kind: "entity",
          profileId: "coding",
          entity: {
            name: "e",
            content: "c",
            contentTruncated: true,
            contentTotalBytes: 99,
          },
        },
        at,
      ),
    );
    expect(entity.entity).toEqual({
      name: "e",
      content: "c",
      content_truncated: true,
      content_total_bytes: 99,
    });
  });
});

describe("memory export Markdown", () => {
  it("keeps stored text as text, HTML and backticks included", () => {
    const markdown = memoryExportMarkdown(
      {
        kind: "record",
        profileId: "coding",
        loaded: {
          record: hit({
            title: "<img src=x onerror=alert(1)> # title",
            abstract: "has ``` three",
          }),
          page: "<script>alert(1)</script>\n```js\nx\n```",
          pageTruncated: false,
        },
      },
      at,
      t,
    );
    expect(markdown).toContain(
      "# Memory export: &lt;img src=x onerror=alert(1)&gt; \\# title",
    );
    expect(markdown).toContain(
      "````text\n<script>alert(1)</script>\n```js\nx\n```\n````",
    );
    expect(markdown).toContain("````text\nhas ``` three\n````");
    // Outside a fence nothing stored starts a line.
    const outside = markdown.split(/^`{3,}text\n[\s\S]*?\n`{3,}$/m).join("");
    expect(outside).not.toContain("<script>");
    expect(markdown).toContain("This is not a backup of all memories.");
  });
  it("names the scope of a search", () => {
    const markdown = memoryExportMarkdown(
      search([hit({ id: "a" }), hit({ id: "b" })], 2),
      at,
      t,
    );
    expect(markdown).toContain("# Memory export: search “旅行”");
    expect(markdown).toContain(
      "the 2 results this search returned. The page asks for at most 2, so there may be more.",
    );
    expect(markdown).toContain("## 1. 旅行 ✈️ notes");
    expect(markdown).toContain("## 2. 旅行 ✈️ notes");
    expect(markdown).toContain("titles and summaries only");
  });
});

describe("memory export file name", () => {
  it("keeps Unicode and drops everything a file system would mind", () => {
    expect(memoryExportFileName(search([hit()]), "json", at)).toBe(
      "octos-memory-search-旅行-20261105T203000.json",
    );
    expect(
      memoryExportFileName(
        { ...search([hit()]), query: "../../etc/passwd" } as MemoryExportScope,
        "markdown",
        at,
      ),
    ).toBe("octos-memory-search-etc-passwd-20261105T203000.md");
    expect(
      memoryExportFileName(
        { ...search([hit()]), query: "///" } as MemoryExportScope,
        "json",
        at,
      ),
    ).toBe("octos-memory-search-memory-20261105T203000.json");
  });
});
