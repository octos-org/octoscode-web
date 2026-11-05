import { MEMORY_EXPORT_FORMAT } from "./memory-export.ts";

/** Bounds on what the page will read; Core takes at most 500 per call. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_RECORDS = 500;
/** Records per `memory/ingest` call, so a failure names where it stopped. */
export const IMPORT_BATCH = 100;
/** Core trims longer text without saying so (octos-memory `Record::clamp`). */
const CORE_CAPS = { title: 120, abstract: 300, body: 16 * 1024 } as const;

/** Only fields `memory/ingest` accepts from a producer. */
export interface ImportRecord {
  id: string;
  kind: "document" | "episode";
  source: string;
  timestamp: string;
  title: string;
  abstract: string;
  body: string;
  parent?: string;
  /** Set just before sending; see `fingerprinted`. */
  fingerprint?: string;
}

export interface ImportPlan {
  format: "json-export" | "json-records" | "markdown-export";
  records: ImportRecord[];
  /** Later records whose id already appeared; they are not imported. */
  skippedDuplicates: { index: number; id: string }[];
  /** Fields in the file that are not sent: Core owns them or doesn't take them. */
  ignoredFields: string[];
  /** Ids whose text Core will cut, with which fields. */
  trimmed: { id: string; fields: (keyof typeof CORE_CAPS)[] }[];
}

export type ImportProblem =
  | { code: "too_large"; bytes: number }
  | { code: "wrong_type" }
  | { code: "not_utf8" }
  | { code: "invalid_json" }
  | { code: "unknown_shape" }
  | { code: "titles_only" }
  | { code: "entity" }
  | { code: "empty" }
  | { code: "too_many"; count: number }
  | { code: "not_object"; index: number }
  | { code: "missing"; index: number; field: string }
  | { code: "not_text"; index: number; field: string }
  | { code: "kind"; index: number; kind: string }
  | { code: "id"; index: number; id: string; expected: string }
  | { code: "timestamp"; index: number; value: string };

export type ImportParse =
  { ok: true; plan: ImportPlan } | { ok: false; problems: ImportProblem[] };

const SENT = [
  "id",
  "kind",
  "source",
  "timestamp",
  "title",
  "abstract",
  "body",
  "parent",
];
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Reads the bytes as UTF-8 or refuses: a lossy decode would change memories. */
export function decodeImport(data: ArrayBuffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      data,
    );
  } catch {
    return null;
  }
}

export function importFileProblem(file: {
  name: string;
  size: number;
  type: string;
}): ImportProblem | null {
  if (file.size > IMPORT_MAX_BYTES)
    return { code: "too_large", bytes: file.size };
  const named = /\.(json|md|markdown)$/i.test(file.name);
  const typed =
    file.type === "" ||
    /^(application\/json|text\/markdown|text\/x-markdown|text\/plain)$/i.test(
      file.type,
    );
  return named && typed ? null : { code: "wrong_type" };
}

/** Every record checked as Core would, so one bad record fails the file. */
function readRecords(
  rows: unknown[],
  format: ImportPlan["format"],
): ImportParse {
  if (!rows.length) return { ok: false, problems: [{ code: "empty" }] };
  if (rows.length > IMPORT_MAX_RECORDS)
    return { ok: false, problems: [{ code: "too_many", count: rows.length }] };
  const problems: ImportProblem[] = [];
  const records: ImportRecord[] = [];
  const ignored = new Set<string>();
  const seen = new Set<string>();
  const skippedDuplicates: ImportPlan["skippedDuplicates"] = [];
  const trimmed: ImportPlan["trimmed"] = [];
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      problems.push({ code: "not_object", index });
      return;
    }
    const before = problems.length;
    for (const key of Object.keys(row))
      if (!SENT.includes(key)) ignored.add(key);
    const text = (field: string, required: boolean) => {
      const value = row[field];
      if (value === undefined || value === null) {
        if (required) problems.push({ code: "missing", index, field });
        return undefined;
      }
      if (typeof value !== "string") {
        problems.push({ code: "not_text", index, field });
        return undefined;
      }
      return value;
    };
    const id = text("id", true)?.trim();
    const rawKind = text("kind", true);
    const source = text("source", true)?.trim();
    const timestamp = text("timestamp", true);
    const title = text("title", true);
    const abstract = text("abstract", true);
    // Required here though Core would take it without: a record without
    // its body would replace a stored record's body with nothing.
    const body = text("body", true);
    const parent = text("parent", false);
    const kind = rawKind?.trim().toLowerCase();
    if (rawKind !== undefined && kind !== "document" && kind !== "episode")
      problems.push({ code: "kind", index, kind: rawKind });
    if (id === "") problems.push({ code: "missing", index, field: "id" });
    if (source === "")
      problems.push({ code: "missing", index, field: "source" });
    if (id && source && (kind === "document" || kind === "episode")) {
      const expected = kind === "document" ? `doc:${source}:` : "episode:";
      if (!id.startsWith(expected) || id.length === expected.length)
        problems.push({ code: "id", index, id, expected });
    }
    if (
      timestamp !== undefined &&
      (!RFC3339.test(timestamp) || Number.isNaN(Date.parse(timestamp)))
    )
      problems.push({ code: "timestamp", index, value: timestamp });
    if (
      problems.length > before ||
      !id ||
      !source ||
      (kind !== "document" && kind !== "episode") ||
      timestamp === undefined ||
      title === undefined ||
      abstract === undefined ||
      body === undefined
    )
      return;
    if (seen.has(id)) {
      skippedDuplicates.push({ index, id });
      return;
    }
    seen.add(id);
    const cut = (["title", "abstract", "body"] as const).filter(
      (field) =>
        bytes({ title, abstract, body }[field].trim()) > CORE_CAPS[field],
    );
    if (cut.length) trimmed.push({ id, fields: cut });
    records.push({
      id,
      kind,
      source,
      timestamp,
      title,
      abstract,
      body,
      ...(parent !== undefined ? { parent } : {}),
    });
  });
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      format,
      records,
      skippedDuplicates,
      ignoredFields: [...ignored].sort(),
      trimmed,
    },
  };
}

function parseJson(text: string): ImportParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ code: "invalid_json" }] };
  }
  if (Array.isArray(value)) return readRecords(value, "json-records");
  if (!isRecord(value))
    return { ok: false, problems: [{ code: "unknown_shape" }] };
  if (value.format === MEMORY_EXPORT_FORMAT && isRecord(value.scope)) {
    const what = value.scope.what;
    if (what === "search_results")
      return { ok: false, problems: [{ code: "titles_only" }] };
    if (what === "memory_entity")
      return { ok: false, problems: [{ code: "entity" }] };
    if (what === "memory_record" && isRecord(value.record)) {
      const record = value.record;
      // A Knowledge page travels as `page`; Core refuses those records anyway.
      const withBody =
        record.body === undefined && typeof value.page === "string"
          ? { ...record, body: value.page }
          : record;
      return readRecords([withBody], "json-export");
    }
    return { ok: false, problems: [{ code: "unknown_shape" }] };
  }
  if (
    Array.isArray(value.records) &&
    Object.keys(value).every((key) => key === "records")
  )
    return readRecords(value.records, "json-records");
  return { ok: false, problems: [{ code: "unknown_shape" }] };
}

/** Undoes the export's inline code span: as many backticks, optional padding. */
function unCode(value: string): string | null {
  const match = /^(`+)(.*)\1$/s.exec(value.trim());
  if (!match) return null;
  const inner = match[2]!;
  return inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()
    ? inner.slice(1, -1)
    : inner;
}

function unPlain(value: string): string {
  return value
    .replace(/\\([\\`*_[\]#|~!])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The fenced block that follows `label:`, exactly as the export wrote it. */
function fencedAfter(lines: string[], labels: string[]): string | undefined {
  const start = lines.findIndex((line) =>
    labels.some((label) => line === `${label}:`),
  );
  if (start < 0) return undefined;
  let open = start + 1;
  while (open < lines.length && lines[open] === "") open += 1;
  const fence = /^(`{3,})text$/.exec(lines[open] ?? "")?.[1];
  if (!fence) return undefined;
  const close = lines.findIndex(
    (line, index) => index > open && line === fence,
  );
  if (close < 0) return undefined;
  return lines.slice(open + 1, close).join("\n");
}

/**
 * Only the Markdown this page exports for one record. Anything else is
 * refused rather than guessed at.
 */
function parseMarkdown(text: string): ImportParse {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = /^# (?:Memory export: |记忆导出：)(.*)$/.exec(lines[0] ?? "");
  if (!heading) return { ok: false, problems: [{ code: "unknown_shape" }] };
  if (/^(?:search “|查询“)/.test(heading[1]!))
    return { ok: false, problems: [{ code: "titles_only" }] };
  const meta = (labels: string[]) => {
    for (const line of lines) {
      const match = /^- ([^:]+): (.*)$/.exec(line);
      if (match && labels.includes(match[1]!))
        return unCode(match[2]!) ?? undefined;
    }
    return undefined;
  };
  const id = meta(["id"]);
  const content = fencedAfter(lines, ["Content", "正文"]);
  if (!id) {
    const scope = meta(["Scope", "范围"]);
    return {
      ok: false,
      problems: [
        scope === undefined && /entity|实体/.test(text)
          ? { code: "entity" }
          : { code: "unknown_shape" },
      ],
    };
  }
  const record = {
    id,
    kind: meta(["Kind", "类型"]),
    source: meta(["Source", "来源"]),
    timestamp: meta(["Time", "时间"]),
    title: unPlain(heading[1]!),
    abstract: fencedAfter(lines, ["Summary", "摘要"]),
    body: content,
  };
  return readRecords([record], "markdown-export");
}

export function parseMemoryImport(name: string, text: string): ImportParse {
  return /\.json$/i.test(name) ? parseJson(text) : parseMarkdown(text);
}

/** Batches in order, so a failure says how far the import got. */
export function importBatches(
  records: readonly ImportRecord[],
): ImportRecord[][] {
  const batches: ImportRecord[][] = [];
  for (let start = 0; start < records.length; start += IMPORT_BATCH)
    batches.push(records.slice(start, start + IMPORT_BATCH));
  return batches;
}

/**
 * Core counts a record unchanged only when it carries the same fingerprint
 * as the stored copy (`RecallStore::upsert`); without one every repeat is an
 * update. So each record goes with a hash of its content, normalised the way
 * Core stores it. Without Web Crypto (an insecure origin) none is sent and
 * Core reports repeats as updates.
 */
export async function fingerprinted(
  records: readonly ImportRecord[],
): Promise<ImportRecord[]> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return records.map((record) => ({ ...record }));
  return Promise.all(
    records.map(async (record) => {
      const content = JSON.stringify([
        record.kind,
        record.source,
        Date.parse(record.timestamp),
        record.title.trim(),
        record.abstract.trim(),
        record.body,
        record.parent ?? null,
      ]);
      const digest = new Uint8Array(
        await subtle.digest("SHA-256", new TextEncoder().encode(content)),
      );
      const hex = [...digest]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return { ...record, fingerprint: `sha256:${hex}` };
    }),
  );
}
