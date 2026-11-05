import type {
  MemoryEntityDetail,
  MemoryLoadResult,
  MemoryRecord,
} from "@octos-org/octoscode-client/memory";
import type { UiText } from "../preferences/ui-text.tsx";

export const MEMORY_EXPORT_FORMAT = "octoscode-web.memory-export/1";

/** Exactly what the page has loaded, and nothing it would have to guess. */
export type MemoryExportScope =
  | {
      kind: "search";
      profileId: string;
      /** The query these results answered, not what the box says now. */
      query: string;
      records: readonly MemoryRecord[];
      /** How many results the page asked for. */
      limit: number;
    }
  | { kind: "record"; profileId: string; loaded: MemoryLoadResult }
  | { kind: "entity"; profileId: string; entity: MemoryEntityDetail };

export type MemoryExportFormat = "json" | "markdown";

/** Search can stop at the requested limit; a full page may not be all of it. */
export function mayHaveMore(scope: MemoryExportScope): boolean {
  return scope.kind === "search" && scope.records.length >= scope.limit;
}

/** The server's field names, and only fields it sent. */
function recordJson(record: MemoryRecord) {
  return {
    id: record.id,
    kind: record.kind,
    source: record.source,
    title: record.title,
    abstract: record.abstract,
    ...(record.body !== undefined ? { body: record.body } : {}),
    ...(record.timestamp !== undefined ? { timestamp: record.timestamp } : {}),
    ...(record.trust !== undefined ? { trust: record.trust } : {}),
    ...(record.score !== undefined ? { score: record.score } : {}),
    ...(record.visits !== undefined ? { visits: record.visits } : {}),
    ...(record.lastVisit !== undefined ? { last_visit: record.lastVisit } : {}),
    ...(record.promoted !== undefined ? { promoted: record.promoted } : {}),
    ...(record.updatedAt !== undefined ? { updated_at: record.updatedAt } : {}),
  };
}

export function memoryExportJson(
  scope: MemoryExportScope,
  exportedAt: Date,
): string {
  const header = {
    format: MEMORY_EXPORT_FORMAT,
    exported_at: exportedAt.toISOString(),
    complete_backup: false,
  };
  if (scope.kind === "search")
    return json({
      ...header,
      scope: {
        what: "search_results",
        profile_id: scope.profileId,
        query: scope.query,
        count: scope.records.length,
        requested_limit: scope.limit,
        may_have_more: mayHaveMore(scope),
      },
      records: scope.records.map(recordJson),
    });
  if (scope.kind === "record")
    return json({
      ...header,
      scope: { what: "memory_record", profile_id: scope.profileId },
      record: recordJson(scope.loaded.record),
      ...(scope.loaded.page !== undefined ? { page: scope.loaded.page } : {}),
      page_truncated: scope.loaded.pageTruncated,
    });
  return json({
    ...header,
    scope: { what: "memory_entity", profile_id: scope.profileId },
    entity: {
      name: scope.entity.name,
      content: scope.entity.content,
      content_truncated: scope.entity.contentTruncated,
      content_total_bytes: scope.entity.contentTotalBytes,
    },
  });
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** A fence longer than any backtick run inside, so the text stays text. */
function fenced(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function code(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const tick = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${tick}${pad}${text}${pad}${tick}`;
}

/** Headings and list items carry plain text: no markup or HTML survives. */
function plain(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[&<>]/g, (char) =>
      char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;",
    )
    .replace(/([\\`*_[\]#|~!])/g, "\\$1");
}

/**
 * Markdown to read, not to render here: every stored text sits in a fence, so
 * HTML or scripts in a memory come out as text wherever the file is opened.
 */
export function memoryExportMarkdown(
  scope: MemoryExportScope,
  exportedAt: Date,
  t: UiText,
): string {
  const lines: string[] = [];
  const meta = (label: string, value: string) =>
    lines.push(`- ${label}: ${value}`);
  const recordBlock = (record: MemoryRecord) => {
    meta("id", code(record.id));
    meta(t("Kind"), code(record.kind));
    meta(t("Source"), code(record.source));
    if (record.timestamp) meta(t("Time"), code(record.timestamp));
    if (record.trust) meta(t("Trust"), code(record.trust));
    if (record.score !== undefined) meta(t("Score"), String(record.score));
    if (record.visits !== undefined) meta(t("Visits"), String(record.visits));
    if (record.lastVisit) meta(t("Last visit"), code(record.lastVisit));
    if (record.updatedAt) meta(t("Updated at"), code(record.updatedAt));
    if (record.promoted !== undefined)
      meta(t("Promoted to knowledge"), code(String(record.promoted)));
    lines.push("", `${t("Summary")}:`, "", fenced(record.abstract));
  };
  const header = (title: string) => {
    lines.push(`# ${title}`, "");
    meta(t("Profile"), code(scope.profileId));
    meta(t("Exported at"), code(exportedAt.toISOString()));
  };
  if (scope.kind === "search") {
    header(t("Memory export: search “{query}”", { query: plain(scope.query) }));
    meta(
      t("Scope"),
      mayHaveMore(scope)
        ? t(
            "the {count} results this search returned. The page asks for at most {limit}, so there may be more.",
            { count: scope.records.length, limit: scope.limit },
          )
        : t("the {count} results this search returned.", {
            count: scope.records.length,
          }),
    );
    lines.push(
      "",
      t(
        "Search results carry titles and summaries only. This is not a backup of all memories.",
      ),
    );
    scope.records.forEach((record, index) => {
      lines.push(
        "",
        `## ${index + 1}. ${plain(record.title) || record.id}`,
        "",
      );
      recordBlock(record);
    });
  } else if (scope.kind === "record") {
    const { record, page, pageTruncated } = scope.loaded;
    header(
      t("Memory export: {title}", { title: plain(record.title) || record.id }),
    );
    meta(t("Scope"), t("one memory record, as the server loaded it."));
    lines.push("", t("This is not a backup of all memories."), "");
    recordBlock(record);
    const content = page ?? record.body;
    if (content !== undefined)
      lines.push("", `${t("Content")}:`, "", fenced(content));
    if (pageTruncated)
      lines.push(
        "",
        t("The server truncated this content. Only what it sent is here."),
      );
  } else {
    const { entity } = scope;
    header(t("Memory export: {title}", { title: plain(entity.name) }));
    meta(t("Scope"), t("one memory entity, as the server loaded it."));
    lines.push("", t("This is not a backup of all memories."), "");
    lines.push(`${t("Content")}:`, "", fenced(entity.content));
    if (entity.contentTruncated)
      lines.push(
        "",
        t(
          "The server truncated this content ({size} B in full). Only what it sent is here.",
          { size: entity.contentTotalBytes },
        ),
      );
  }
  return lines.join("\n") + "\n";
}

export function memoryExportFileName(
  scope: MemoryExportScope,
  format: MemoryExportFormat,
  exportedAt: Date,
): string {
  const subject =
    scope.kind === "search"
      ? scope.query
      : scope.kind === "record"
        ? scope.loaded.record.title || scope.loaded.record.id
        : scope.entity.name;
  const slug =
    [...subject.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-")]
      .slice(0, 40)
      .join("")
      .replace(/^-+|-+$/g, "") || "memory";
  const stamp = exportedAt.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `octos-memory-${scope.kind}-${slug}-${stamp}.${format === "json" ? "json" : "md"}`;
}

/** Made in the browser and handed to it as a download; nothing is stored. */
export function saveMemoryExport(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
