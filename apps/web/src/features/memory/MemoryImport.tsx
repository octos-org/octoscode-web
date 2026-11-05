import { useState } from "react";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_RECORDS,
  decodeImport,
  importFileProblem,
  parseMemoryImport,
  type ImportPlan,
  type ImportProblem,
  type ImportRecord,
} from "./memory-import.ts";
import styles from "./MemorySettings.module.css";

/** What the server said, batch by batch, and where it stopped if it did. */
export interface ImportOutcome {
  total: number;
  sent: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failedBatch?: number;
  reason?: string;
}

const LISTED = 5;

function list(values: readonly string[]): string {
  return values.length > LISTED
    ? `${values.slice(0, LISTED).join(", ")} …`
    : values.join(", ");
}

export function importProblemText(problem: ImportProblem, t: UiText): string {
  const at = "index" in problem ? { n: problem.index + 1 } : {};
  switch (problem.code) {
    case "too_large":
      return t("The file is {size} KiB; at most {max} KiB can be imported.", {
        size: Math.ceil(problem.bytes / 1024),
        max: IMPORT_MAX_BYTES / 1024,
      });
    case "wrong_type":
      return t(
        "Only .json and .md files exported from memory can be imported.",
      );
    case "not_utf8":
      return t("The file isn't valid UTF-8 text.");
    case "invalid_json":
      return t("The file isn't valid JSON.");
    case "unknown_shape":
      return t(
        "This isn't a memory export this page made, or a list of memory records.",
      );
    case "titles_only":
      return t(
        "This is a search export: it holds titles and summaries only. Importing it would replace stored records' content with nothing. Export each detail instead.",
      );
    case "entity":
      return t(
        "This is a memory entity, which can't be written through import.",
      );
    case "empty":
      return t("The file has no records.");
    case "too_many":
      return t(
        "The file has {count} records; at most {max} can be imported at once.",
        {
          count: problem.count,
          max: IMPORT_MAX_RECORDS,
        },
      );
    case "not_object":
      return t("Record {n} isn't an object.", at);
    case "missing":
      return t("Record {n} has no {field}.", { ...at, field: problem.field });
    case "not_text":
      return t("Record {n}: {field} isn't text.", {
        ...at,
        field: problem.field,
      });
    case "kind":
      return t(
        "Record {n}: kind “{kind}” can't be imported (document or episode only).",
        {
          ...at,
          kind: problem.kind,
        },
      );
    case "id":
      return t("Record {n}: id “{id}” must start with {expected}.", {
        ...at,
        id: problem.id,
        expected: problem.expected,
      });
    case "timestamp":
      return t("Record {n}: timestamp “{value}” isn't an RFC 3339 time.", {
        ...at,
        value: problem.value,
      });
  }
}

function formatName(format: ImportPlan["format"], t: UiText): string {
  return format === "json-export"
    ? t("JSON export")
    : format === "json-records"
      ? t("JSON record list")
      : t("Markdown export");
}

/**
 * Read a file, show everything that would be written, write only on
 * confirmation. The file's text lives in this component until then and is
 * dropped once imported or cancelled.
 */
export function MemoryImport({
  canIngest,
  busy,
  importing,
  profileId,
  knownIds,
  onImport,
}: {
  canIngest: boolean;
  busy: boolean;
  importing: boolean;
  profileId: string;
  /** Ids this page has loaded from the server, so known to exist there. */
  knownIds: ReadonlySet<string>;
  onImport: (records: ImportRecord[]) => Promise<ImportOutcome | null>;
}) {
  const t = useUiText();
  const [preview, setPreview] = useState<{
    name: string;
    size: number;
    plan: ImportPlan;
  } | null>(null);
  const [problems, setProblems] = useState<{
    name: string;
    problems: ImportProblem[];
  } | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const choose = async (file: File) => {
    setPreview(null);
    setProblems(null);
    setOutcome(null);
    const refused = importFileProblem(file);
    if (refused) {
      setProblems({ name: file.name, problems: [refused] });
      return;
    }
    const text = decodeImport(await file.arrayBuffer());
    if (text === null) {
      setProblems({ name: file.name, problems: [{ code: "not_utf8" }] });
      return;
    }
    const parsed = parseMemoryImport(file.name, text);
    if (parsed.ok)
      setPreview({ name: file.name, size: file.size, plan: parsed.plan });
    else setProblems({ name: file.name, problems: parsed.problems });
  };

  const confirm = async () => {
    if (!preview) return;
    const result = await onImport(preview.plan.records);
    if (!result) return;
    setOutcome(result);
    setPreview(null);
  };

  const plan = preview?.plan;
  const known = plan?.records.filter((record) => knownIds.has(record.id)) ?? [];
  const sources = plan
    ? Object.entries(
        plan.records.reduce<Record<string, number>>((counts, record) => {
          counts[record.source] = (counts[record.source] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([source, count]) => `${source} (${count})`)
    : [];

  return (
    <section aria-labelledby="memory-import-heading">
      <h3 id="memory-import-heading">{t("Import memories")}</h3>
      {canIngest ? (
        <p className={styles.meta}>
          {t(
            "A memory record exported from this page, as JSON or Markdown, or a JSON list of records. Nothing is written until you confirm.",
          )}
        </p>
      ) : (
        <p className={styles.meta}>
          {t(
            "This server doesn't take memory writes, so files can't be imported.",
          )}
        </p>
      )}
      <div className={styles.form}>
        <label htmlFor="memory-import-file">
          {t("Choose a JSON or Markdown file")}
        </label>
        <input
          id="memory-import-file"
          type="file"
          accept=".json,.md,.markdown,application/json,text/markdown"
          disabled={!canIngest || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void choose(file);
          }}
        />
      </div>
      {problems ? (
        <div className={styles.error} role="alert">
          <p>{t("{name} can't be imported:", { name: problems.name })}</p>
          <ul>
            {problems.problems.slice(0, LISTED).map((problem, index) => (
              <li key={index}>{importProblemText(problem, t)}</li>
            ))}
          </ul>
          {problems.problems.length > LISTED ? (
            <p>
              {t("…and {count} more problems.", {
                count: problems.problems.length - LISTED,
              })}
            </p>
          ) : null}
          <p>{t("Nothing was written.")}</p>
        </div>
      ) : null}
      {preview && plan ? (
        <div
          className={styles.importPreview}
          role="region"
          aria-label={t("Import preview")}
        >
          <h4>{t("Import preview")}</h4>
          <p className={styles.meta}>
            {t("{name} · {size} KiB · {format}", {
              name: preview.name,
              size: Math.ceil(preview.size / 1024),
              format: formatName(plan.format, t),
            })}
          </p>
          <p>
            {t("{count} records will be written to Profile {profileId}.", {
              count: plan.records.length,
              profileId,
            })}{" "}
            {t("Sources: {sources}.", { sources: sources.join(", ") })}
          </p>
          {plan.skippedDuplicates.length ? (
            <p>
              {t(
                "{count} later records repeat an id already in this file and are skipped: {ids}.",
                {
                  count: plan.skippedDuplicates.length,
                  ids: list(plan.skippedDuplicates.map((entry) => entry.id)),
                },
              )}
            </p>
          ) : null}
          {known.length ? (
            <p>
              {t(
                "{count} of these ids were loaded on this page, so they are on the server and will be replaced: {ids}.",
                { count: known.length, ids: list(known.map((r) => r.id)) },
              )}
            </p>
          ) : null}
          <p className={styles.meta}>
            {t(
              "A record already on the server with one of these ids is replaced by the version here. Afterwards the server reports how many were new, updated or unchanged.",
            )}
          </p>
          <p className={styles.meta}>
            {t(
              "Each record goes with a fingerprint of its content, so the server can tell an unchanged record from an updated one.",
            )}
          </p>
          {plan.ignoredFields.length ? (
            <p className={styles.meta}>
              {t(
                "Not sent: {fields}. The server keeps its own trust, visits and dates for every record.",
                { fields: plan.ignoredFields.join(", ") },
              )}
            </p>
          ) : null}
          {plan.trimmed.length ? (
            <p>
              {t(
                "The server will shorten {count} records whose title, summary or content is longer than it keeps: {ids}.",
                {
                  count: plan.trimmed.length,
                  ids: list(plan.trimmed.map((entry) => entry.id)),
                },
              )}
            </p>
          ) : null}
          <ol className={styles.importList}>
            {plan.records.map((record) => (
              <li key={record.id}>
                <strong>{record.title || record.id}</strong>
                <span>
                  <code>{record.id}</code> · {record.kind} · {record.source} ·{" "}
                  {record.timestamp} ·{" "}
                  {t("{size} B of content", {
                    size: new TextEncoder().encode(record.body).length,
                  })}
                </span>
              </li>
            ))}
          </ol>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || importing}
              onClick={() => void confirm()}
            >
              {importing
                ? t("Importing…")
                : t("Import {count} records", { count: plan.records.length })}
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => setPreview(null)}
            >
              {t("Cancel import")}
            </button>
          </div>
        </div>
      ) : null}
      {outcome ? <ImportOutcomeNotice outcome={outcome} /> : null}
    </section>
  );
}

function ImportOutcomeNotice({ outcome }: { outcome: ImportOutcome }) {
  const t = useUiText();
  const reported = outcome.inserted + outcome.updated + outcome.unchanged;
  const counts = t(
    "{inserted} new · {updated} updated · {unchanged} unchanged",
    {
      inserted: outcome.inserted,
      updated: outcome.updated,
      unchanged: outcome.unchanged,
    },
  );
  if (outcome.failedBatch !== undefined) {
    return (
      <div className={styles.error} role="alert">
        {outcome.sent ? (
          <p>
            {t(
              "Stopped after {sent} of {total} records. Written so far: {counts}.",
              {
                sent: outcome.sent,
                total: outcome.total,
                counts,
              },
            )}
          </p>
        ) : (
          <p>{t("Nothing was imported.")}</p>
        )}
        <p>
          {t(
            "Batch {batch} didn't finish: {reason}. The server reported nothing written for it; the {left} records after it were not sent.",
            {
              batch: outcome.failedBatch,
              reason: outcome.reason ?? "",
              left: outcome.total - outcome.sent,
            },
          )}
        </p>
      </div>
    );
  }
  return (
    <div role="status">
      <p>
        {t("Imported {sent} records: {counts}.", {
          sent: outcome.sent,
          counts,
        })}
      </p>
      {reported !== outcome.sent ? (
        <p className={styles.error}>
          {t(
            "The server accounted for {reported} of the {sent} records sent.",
            {
              reported,
              sent: outcome.sent,
            },
          )}
        </p>
      ) : null}
    </div>
  );
}
