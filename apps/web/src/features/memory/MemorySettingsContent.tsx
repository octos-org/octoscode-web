import { randomUUID } from "../../shared/uuid.ts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  APPUI_MEMORY_PROMOTE_METHOD,
  APPUI_MEMORY_SESSION_SCOPE_FEATURE,
  supportsFeature,
  APPUI_MEMORY_REQUEST_METHOD,
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  MemoryEntityDetail,
  MemoryLoadResult,
  MemoryOverview,
  MemoryRecord,
} from "@octos-org/octoscode-client/memory";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./MemorySettings.module.css";
import {
  mayHaveMore,
  memoryExportFileName,
  memoryExportJson,
  memoryExportMarkdown,
  saveMemoryExport,
  type MemoryExportFormat,
  type MemoryExportScope,
} from "./memory-export.ts";
import {
  fingerprinted,
  importBatches,
  ingestFailure,
  readBack,
  readBackVerdict,
  type ImportRecord,
} from "./memory-import.ts";
import { MemoryImport, type ImportOutcome } from "./MemoryImport.tsx";
import {
  dropImportRun,
  importRun,
  publishImportRun,
  startImportRun,
  useImportRun,
  type ImportRun,
} from "./import-runs.ts";

/** How many results a search asks for; a full page may not be all of them. */
const SEARCH_LIMIT = 20;

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody.tsx").then((module) => ({
    default: module.MarkdownBody,
  })),
);

interface MemorySettingsContentProps {
  client: OctosUiClient;
  authenticatedProfileId: string | null;
  sessionProfileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
}

export function MemorySettingsContent({
  client,
  authenticatedProfileId,
  sessionProfileId,
  sessionId,
  capabilities,
}: MemorySettingsContentProps) {
  const t = useUiText();
  const sessionScoped = supportsFeature(
    capabilities,
    APPUI_MEMORY_SESSION_SCOPE_FEATURE,
  );
  const memorySessionId = sessionScoped ? sessionId : undefined;
  const scopeVerified =
    sessionScoped ||
    (Boolean(authenticatedProfileId) &&
      authenticatedProfileId === sessionProfileId);
  const canEntity = supportsMethod(capabilities, CORE_UI_METHODS.MEMORY_ENTITY);
  const canSearch = supportsMethod(capabilities, CORE_UI_METHODS.MEMORY_SEARCH);
  const canLoad = supportsMethod(capabilities, CORE_UI_METHODS.MEMORY_LOAD);
  const canIngest = supportsMethod(capabilities, CORE_UI_METHODS.MEMORY_INGEST);
  const canRequest = supportsMethod(capabilities, APPUI_MEMORY_REQUEST_METHOD);
  const canPromote = supportsMethod(capabilities, APPUI_MEMORY_PROMOTE_METHOD);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemoryRecord[] | null>(null);
  const [entity, setEntity] = useState<MemoryEntityDetail | null>(null);
  const [record, setRecord] = useState<MemoryLoadResult | null>(null);
  const [loading, setLoading] = useState(true);
  /** Which action owns the single in-flight slot; feedback names it. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  /** State settles after the event loop; a ref stops a same-tick second click. */
  const inflight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [body, setBody] = useState("");
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setOverview(null);
    setHits(null);
    setEntity(null);
    setRecord(null);
    setSearchedFor(null);
    if (!scopeVerified) {
      setLoading(false);
      return;
    }
    void client
      .memoryCommands(capabilities, memorySessionId)
      .then(
        (commands) => commands.overview(),
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
          }
        },
      )
      .then(
        (result) => {
          if (current && result) {
            setOverview(result);
            setLoading(false);
          }
        },
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
          }
        },
      );
    return () => {
      current = false;
    };
  }, [client, capabilities, scopeVerified, memorySessionId]);

  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const search = async () => {
    if (busy || !query.trim()) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("search");
    setError(null);
    setNotice(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      const result = await commands.search(query.trim(), SEARCH_LIMIT);
      setHits(result);
      setHitsBeforeImport(false);
      setSearchedFor(query.trim());
      setRecord(null);
      setEntity(null);
    } catch (reason) {
      // The old hits stay, labeled with the query they answered (T-0395).
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  const openEntity = async (name: string) => {
    if (busy) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("entity");
    setError(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      setEntity(await commands.entity(name));
      setRecord(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  const openRecord = async (id: string) => {
    if (busy) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("record");
    setError(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      setRecord(await commands.load(id));
      setEntity(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  const ingest = async () => {
    if (busy || !title.trim() || !abstract.trim() || !body.trim()) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("ingest");
    setError(null);
    setNotice(null);
    setIngestResult(null);
    try {
      const id = `doc:octoscode-web:${randomUUID()}`;
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      const result = await commands.ingest([
        {
          id,
          kind: "document",
          source: "octoscode-web",
          timestamp: new Date().toISOString(),
          title: title.trim(),
          abstract: abstract.trim(),
          body: body.trim(),
        },
      ]);
      setIngestResult(
        t("{inserted} inserted · {updated} updated · {unchanged} unchanged", {
          inserted: result.inserted,
          updated: result.updated,
          unchanged: result.unchanged,
        }),
      );
      if (canLoad) setRecord(await commands.load(id));
      else setRecord(null);
      setEntity(null);
      setTitle("");
      setAbstract("");
      setBody("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  const requestMemory = async () => {
    if (busy || !body.trim()) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("request");
    setError(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      const result = await commands.request(`web:${randomUUID()}`, body.trim());
      setNotice(
        t("Memory request accepted: {status}", { status: result.status }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  const promote = async () => {
    if (busy) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusyAction("promote");
    setError(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      const result = await commands.promote("octoscode-web");
      setNotice(
        t("Promotion staged for {count} record(s); refresh is {refresh}.", {
          count: result.count,
          refresh: result.refreshEnabled ? t("enabled") : t("disabled"),
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusyAction(null);
    }
  };

  // What an export covers is what the page shows, labelled as it is shown.
  const searchExport = useMemo<MemoryExportScope | null>(
    () =>
      hits?.length && searchedFor !== null
        ? {
            kind: "search",
            profileId: sessionProfileId,
            query: searchedFor,
            records: hits,
            limit: SEARCH_LIMIT,
          }
        : null,
    [hits, searchedFor, sessionProfileId],
  );
  const detailExport = useMemo<MemoryExportScope | null>(
    () =>
      entity
        ? { kind: "entity", profileId: sessionProfileId, entity }
        : record
          ? { kind: "record", profileId: sessionProfileId, loaded: record }
          : null,
    [entity, record, sessionProfileId],
  );

  // One import run per memory scope: its batches keep the fingerprints they
  // were first sent with, so a retry sends exactly the same records. It
  // lives outside this component (import-runs.ts), so a reconnect that
  // remounts the page keeps it, and another Session's page never shows it.
  const scopeKey = `${sessionProfileId}\u0000${memorySessionId ?? ""}`;
  const live = useRef({ client, capabilities, scopeKey, searchedFor, record });
  live.current = { client, capabilities, scopeKey, searchedFor, record };
  const lastImport = useImportRun(scopeKey);
  const [hitsBeforeImport, setHitsBeforeImport] = useState(false);

  const liveCommands = () =>
    live.current.client.memoryCommands(
      live.current.capabilities,
      memorySessionId,
    );

  /** Reads the stopped batch back once and settles what can be settled. */
  const settleUncertain = async (run: ImportRun) => {
    const stop = run.outcome.stop;
    if (!stop || stop.kind !== "uncertain") return;
    if (!canLoad) {
      stop.readBack = "unavailable";
      stop.verdict = "unknown";
      return;
    }
    const batch = run.batches[stop.batch - 1]!;
    let found;
    try {
      const commands = await liveCommands();
      found = await readBack(batch, (id) => commands.load(id));
    } catch {
      found = { asSent: 0, missing: 0, different: 0, unreadable: batch.length };
    }
    stop.readBack = found;
    stop.verdict = readBackVerdict(found, batch.length);
    if (stop.verdict === "written") {
      run.outcome.confirmed += batch.length;
      if (stop.batch === run.batches.length) delete run.outcome.stop;
    }
  };

  /** Sends batches in order from `from`; a failure stops the rest. */
  const sendFrom = async (run: ImportRun, from: number) => {
    delete run.outcome.stop;
    let commands;
    try {
      commands = await liveCommands();
    } catch (reason) {
      // Nothing was sent: the memory commands never became available.
      run.outcome.stop = {
        batch: from + 1,
        size: run.batches[from]!.length,
        kind: "unsent",
        reason: errorMessage(reason),
      };
      return;
    }
    for (let index = from; index < run.batches.length; index += 1) {
      const batch = run.batches[index]!;
      try {
        const result = await commands.ingest(
          batch.map((entry) => ({ ...entry })),
        );
        run.outcome.sent += batch.length;
        run.outcome.inserted += result.inserted;
        run.outcome.updated += result.updated;
        run.outcome.unchanged += result.unchanged;
      } catch (reason) {
        run.outcome.stop = {
          batch: index + 1,
          size: batch.length,
          kind: ingestFailure(reason),
          reason: errorMessage(reason),
        };
        await settleUncertain(run);
        return;
      }
      publishImportRun(run);
    }
  };

  /** The search on screen and the open record, read again after writing. */
  const refreshAfterImport = async (run: ImportRun) => {
    const query = live.current.searchedFor;
    const open = live.current.record;
    const imported = new Set(run.batches.flat().map((entry) => entry.id));
    const current = () => live.current.scopeKey === run.scope;
    try {
      const commands = await liveCommands();
      if (query !== null && canSearch) {
        const result = await commands.search(query, SEARCH_LIMIT);
        if (current() && live.current.searchedFor === query) {
          setHits(result);
          setHitsBeforeImport(false);
        }
      }
      if (open && imported.has(open.record.id) && canLoad) {
        const reloaded = await commands.load(open.record.id);
        if (current() && live.current.record?.record.id === open.record.id)
          setRecord(reloaded);
      }
    } catch {
      if (current() && query !== null) setHitsBeforeImport(true);
    }
  };

  /** One import step at a time, taken before any await. */
  const lockImport = () => {
    if (busy || inflight.current || importRun(scopeKey)?.pending) return false;
    inflight.current = true;
    setBusyAction("import");
    setError(null);
    setNotice(null);
    return true;
  };
  const unlockImport = () => {
    inflight.current = false;
    setBusyAction(null);
  };

  const importStep = async (
    run: ImportRun,
    step: (run: ImportRun) => Promise<void>,
  ) => {
    run.pending = true;
    publishImportRun(run);
    try {
      await step(run);
      run.pending = false;
      publishImportRun(run);
      await refreshAfterImport(run);
    } finally {
      run.pending = false;
      publishImportRun(run);
      unlockImport();
    }
  };

  const importRecords = async (
    name: string,
    records: ImportRecord[],
  ): Promise<boolean> => {
    if (!lockImport()) return false;
    const outcome: ImportOutcome = {
      total: records.length,
      sent: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      confirmed: 0,
    };
    let batches: ImportRecord[][];
    try {
      batches = importBatches(await fingerprinted(records));
    } catch {
      // As on an origin without Web Crypto: sent without fingerprints, so
      // the server reports repeats as updates.
      batches = importBatches(records.map((entry) => ({ ...entry })));
    }
    const run: ImportRun = {
      scope: scopeKey,
      name,
      batches,
      outcome,
      pending: false,
    };
    startImportRun(run);
    await importStep(run, (current) => sendFrom(current, 0));
    return true;
  };

  /** By hand only: nothing is ever sent again on its own. */
  const resumeImport = () => {
    const run = importRun(scopeKey);
    const stop = run?.outcome.stop;
    if (!run || !stop || stop.kind === "refused" || !run.batches.length) return;
    if (!lockImport()) return;
    const next = stop.verdict === "written" ? stop.batch : stop.batch - 1;
    void importStep(run, (current) => sendFrom(current, next));
  };

  const readImportBack = () => {
    const run = importRun(scopeKey);
    if (run?.outcome.stop?.kind !== "uncertain" || !lockImport()) return;
    void importStep(run, settleUncertain);
  };
  const knownIds = useMemo(
    () =>
      new Set([
        ...(hits ?? []).map((hit) => hit.id),
        ...(record ? [record.record.id] : []),
      ]),
    [hits, record],
  );

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (busy || refreshing || inflight.current) return;
    inflight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const commands = await client.memoryCommands(
        capabilities,
        memorySessionId,
      );
      setOverview(await commands.overview());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inflight.current = false;
      setRefreshing(false);
    }
  };

  if (!scopeVerified) {
    return (
      <div className={styles.page}>
        <header className={styles.heading}>
          <div>
            <h2>{t("Memory")}</h2>
          </div>
        </header>
        <p className={styles.notice} role="status">
          {t(
            "Memory ownership is not confirmed for this connection. Authenticated Profile {authenticated}; Session Profile {session}. Update the Octos server to use this Session’s memory. Read and write are disabled.",
            {
              authenticated: authenticatedProfileId ?? t("unverified"),
              session: sessionProfileId,
            },
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Memory")}</h2>
          <p>
            {t("Read and remember information in Session Profile {profileId}", {
              profileId: sessionProfileId,
            })}
          </p>
        </div>
        <button
          type="button"
          disabled={loading || refreshing || busy}
          onClick={() => void refresh()}
        >
          {refreshing ? t("Refreshing…") : t("Refresh")}
        </button>
      </header>
      <p className={styles.notice}>
        {t(
          "Editing and deleting memories are not available in the current protocol.",
        )}
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {ingestResult ? <p role="status">{ingestResult}</p> : null}
      <div className={styles.layout}>
        <div className={styles.main}>
          <section aria-labelledby="memory-overview-heading">
            <h3 id="memory-overview-heading">{t("Overview")}</h3>
            {loading ? (
              <p role="status">{t("Waiting for the server…")}</p>
            ) : null}
            {overview ? (
              <>
                <MemoryDocument
                  title={t("Long-term memory")}
                  text={overview.longTerm}
                  truncated={overview.longTermTruncated}
                  totalBytes={overview.longTermTotalBytes}
                />
                <MemoryDocument
                  title={t("Today")}
                  text={overview.today}
                  truncated={overview.todayTruncated}
                  totalBytes={overview.todayTotalBytes}
                />
                <p className={styles.meta}>
                  {t("{count} staging notes · Refresh {refresh}", {
                    count: overview.stagingNotes,
                    refresh: overview.refreshEnabled
                      ? t("enabled")
                      : t("disabled"),
                  })}
                  {overview.stagingTruncated
                    ? " " + t("(count is a lower bound)")
                    : ""}
                </p>
                <h4>{t("Entities")}</h4>
                {!overview.entities.length ? (
                  <p>{t("No entities yet.")}</p>
                ) : null}
                <div className={styles.list}>
                  {overview.entities.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      disabled={busy || !canEntity}
                      onClick={() => void openEntity(item.name)}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.summary}</span>
                    </button>
                  ))}
                </div>
                {!canEntity ? (
                  <p className={styles.meta}>
                    {t("This server cannot load entity details.")}
                  </p>
                ) : null}
                {overview.entitiesTruncated ? (
                  <p className={styles.meta}>
                    {t("Only the first entities are shown.")}
                  </p>
                ) : null}
                <h4>{t("Recent notes")}</h4>
                {!overview.recent.length ? (
                  <p>{t("No recent notes.")}</p>
                ) : null}
                <div className={styles.list}>
                  {overview.recent.map((item) => (
                    <details key={item.date}>
                      <summary>{item.date}</summary>
                      <MemoryText
                        text={item.content}
                        truncated={item.contentTruncated}
                        totalBytes={item.contentTotalBytes}
                      />
                    </details>
                  ))}
                </div>
              </>
            ) : null}
          </section>
          {canSearch ? (
            <section aria-labelledby="memory-search-heading">
              <h3 id="memory-search-heading">{t("Search")}</h3>
              <form
                className={styles.search}
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <label htmlFor="memory-query">{t("Search memories")}</label>
                <input
                  id="memory-query"
                  name="query"
                  autoComplete="off"
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button type="submit" disabled={busy || !query.trim()}>
                  {busyAction === "search" ? t("Searching…") : t("Search")}
                </button>
              </form>
              {hits !== null ? (
                <p className={styles.meta}>
                  {t("Results for “{query}”", { query: searchedFor ?? "" })}
                </p>
              ) : null}
              {hits !== null && hitsBeforeImport ? (
                <p className={styles.meta}>
                  {t(
                    "These results are from before the import; the search couldn't be read again. Search again to update them.",
                  )}
                </p>
              ) : null}
              {hits?.length === 0 ? <p>{t("No matching memories.")}</p> : null}
              {searchExport ? (
                <MemoryExportActions
                  scope={searchExport}
                  label={t("Export these {count} results", {
                    count: hits?.length ?? 0,
                  })}
                  note={
                    mayHaveMore(searchExport)
                      ? t(
                          "The page asks for at most {limit} results, so there may be more. Search results carry titles and summaries only. Not a backup of all memories.",
                          { limit: SEARCH_LIMIT },
                        )
                      : t(
                          "Search results carry titles and summaries only. Not a backup of all memories.",
                        )
                  }
                />
              ) : null}
              <div className={styles.list}>
                {hits?.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    disabled={busy || !canLoad}
                    onClick={() => void openRecord(hit.id)}
                  >
                    <strong>{hit.title}</strong>
                    <span>{hit.abstract}</span>
                  </button>
                ))}
              </div>
              {!canLoad ? (
                <p className={styles.meta}>
                  {t("This server cannot load full record details.")}
                </p>
              ) : null}
            </section>
          ) : null}
          {canIngest ? (
            <section aria-labelledby="memory-ingest-heading">
              <h3 id="memory-ingest-heading">{t("Remember this")}</h3>
              <div className={styles.form}>
                <label htmlFor="memory-title">{t("Title")}</label>
                <input
                  id="memory-title"
                  name="title"
                  autoComplete="off"
                  value={title}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <label htmlFor="memory-abstract">{t("Summary")}</label>
                <input
                  id="memory-abstract"
                  name="abstract"
                  autoComplete="off"
                  value={abstract}
                  disabled={busy}
                  onChange={(event) => setAbstract(event.target.value)}
                />
                <label htmlFor="memory-body">{t("Memory content")}</label>
                <textarea
                  id="memory-body"
                  name="body"
                  rows={4}
                  value={body}
                  disabled={busy}
                  onChange={(event) => setBody(event.target.value)}
                />
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={
                      busy || !title.trim() || !abstract.trim() || !body.trim()
                    }
                    onClick={() => void ingest()}
                  >
                    {busyAction === "ingest"
                      ? t("Remembering…")
                      : t("Remember this")}
                  </button>
                  {canRequest ? (
                    <button
                      type="button"
                      disabled={busy || !body.trim()}
                      onClick={() => void requestMemory()}
                    >
                      {t("Request memory")}
                    </button>
                  ) : null}
                  {canPromote ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void promote()}
                    >
                      {t("Promote to Knowledge")}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
          <MemoryImport
            key={scopeKey}
            canIngest={canIngest}
            busy={busy || Boolean(lastImport?.pending)}
            importing={busyAction === "import" || Boolean(lastImport?.pending)}
            profileId={sessionProfileId}
            knownIds={knownIds}
            lastImport={lastImport}
            onImport={importRecords}
            onClear={() => dropImportRun(scopeKey)}
            onResume={resumeImport}
            onReadBack={readImportBack}
          />
        </div>
        <aside className={styles.detail} aria-label={t("Memory detail")}>
          <h3>{t("Detail")}</h3>
          {entity ? (
            <>
              <h4>{entity.name}</h4>
              <MemoryText
                text={entity.content}
                truncated={entity.contentTruncated}
                totalBytes={entity.contentTotalBytes}
              />
            </>
          ) : record ? (
            <>
              <h4>{record.record.title}</h4>
              <p className={styles.meta}>
                {record.record.kind} · {record.record.source}
              </p>
              <p>{record.record.abstract}</p>
              {record.record.trust ? (
                <p className={styles.meta}>
                  {t("Trust: {trust}", { trust: record.record.trust })}
                </p>
              ) : null}
              <MemoryText
                text={
                  record.page ??
                  record.record.body ??
                  t("No record body was reported.")
                }
                truncated={record.pageTruncated}
                totalBytes={undefined}
              />
            </>
          ) : (
            <p>
              {t("Choose an entity or search result to view its contents.")}
            </p>
          )}
          {detailExport ? (
            <MemoryExportActions
              scope={detailExport}
              label={t("Export this detail")}
              note={t(
                "Only this detail, as the server sent it. Not a backup of all memories.",
              )}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function MemoryExportActions({
  scope,
  label,
  note,
}: {
  scope: MemoryExportScope;
  label: string;
  note: string;
}) {
  const t = useUiText();
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setFailure(null), [scope]);
  const save = (format: MemoryExportFormat) => {
    setFailure(null);
    try {
      const exportedAt = new Date();
      saveMemoryExport(
        format === "json"
          ? memoryExportJson(scope, exportedAt)
          : memoryExportMarkdown(scope, exportedAt, t),
        memoryExportFileName(scope, format, exportedAt),
        format === "json"
          ? "application/json;charset=utf-8"
          : "text/markdown;charset=utf-8",
      );
    } catch (reason) {
      setFailure(
        t("Couldn't make the download: {reason}. Try again.", {
          reason: errorMessage(reason),
        }),
      );
    }
  };
  return (
    <div className={styles.export}>
      <div className={styles.actions} role="group" aria-label={label}>
        <span>{label}</span>
        <button type="button" onClick={() => save("json")}>
          {t("JSON")}
        </button>
        <button type="button" onClick={() => save("markdown")}>
          {t("Markdown")}
        </button>
      </div>
      <p className={styles.meta}>{note}</p>
      {failure ? (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function MemoryDocument({
  title,
  text,
  truncated,
  totalBytes,
}: {
  title: string;
  text: string;
  truncated: boolean;
  totalBytes: number;
}) {
  return (
    <details className={styles.document} open={Boolean(text)}>
      <summary>{title}</summary>
      <MemoryText text={text} truncated={truncated} totalBytes={totalBytes} />
    </details>
  );
}

function MemoryText({
  text,
  truncated,
  totalBytes,
}: {
  text: string;
  truncated: boolean;
  totalBytes?: number | undefined;
}) {
  const t = useUiText();
  if (!text) return <p>{t("No content yet.")}</p>;
  return (
    <>
      <Suspense fallback={<pre className={styles.output}>{text}</pre>}>
        <MarkdownBody text={text} />
      </Suspense>
      {truncated ? (
        <p className={styles.meta}>
          {t("Content is truncated by the server{size}.", {
            size: totalBytes === undefined ? "" : ` (${totalBytes} B)`,
          })}
        </p>
      ) : null}
    </>
  );
}
