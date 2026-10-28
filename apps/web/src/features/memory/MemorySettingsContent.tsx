import { lazy, Suspense, useEffect, useState } from "react";
import {
  APPUI_MEMORY_PROMOTE_METHOD,
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

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody.tsx").then((module) => ({
    default: module.MarkdownBody,
  })),
);

interface MemorySettingsContentProps {
  client: OctosUiClient;
  profileId: string;
  capabilities: UiProtocolCapabilities;
}

export function MemorySettingsContent({
  client,
  profileId,
  capabilities,
}: MemorySettingsContentProps) {
  const t = useUiText();
  const canIngest = supportsMethod(capabilities, CORE_UI_METHODS.MEMORY_INGEST);
  const canRequest = supportsMethod(capabilities, APPUI_MEMORY_REQUEST_METHOD);
  const canPromote = supportsMethod(capabilities, APPUI_MEMORY_PROMOTE_METHOD);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemoryRecord[] | null>(null);
  const [entity, setEntity] = useState<MemoryEntityDetail | null>(null);
  const [record, setRecord] = useState<MemoryLoadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    void client
      .memoryCommands(capabilities)
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
  }, [client, capabilities]);

  const search = async () => {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const commands = await client.memoryCommands(capabilities);
      const result = await commands.search(query.trim(), 20);
      setHits(result);
      setRecord(null);
      setEntity(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openEntity = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const commands = await client.memoryCommands(capabilities);
      setEntity(await commands.entity(name));
      setRecord(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openRecord = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const commands = await client.memoryCommands(capabilities);
      setRecord(await commands.load(id));
      setEntity(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const ingest = async () => {
    if (busy || !title.trim() || !abstract.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setIngestResult(null);
    try {
      const id = `doc:octoscode-web:${crypto.randomUUID()}`;
      const commands = await client.memoryCommands(capabilities);
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
      setRecord(await commands.load(id));
      setEntity(null);
      setTitle("");
      setAbstract("");
      setBody("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const requestMemory = async () => {
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const commands = await client.memoryCommands(capabilities);
      const result = await commands.request(
        `web:${crypto.randomUUID()}`,
        body.trim(),
      );
      setNotice(
        t("Memory request accepted: {status}", { status: result.status }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const commands = await client.memoryCommands(capabilities);
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
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Memory")}</h2>
          <p>
            {t("Read and remember information in server Profile {profileId}", {
              profileId,
            })}
          </p>
        </div>
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
                      disabled={busy}
                      onClick={() => void openEntity(item.name)}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.summary}</span>
                    </button>
                  ))}
                </div>
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
                {t("Search")}
              </button>
            </form>
            {hits?.length === 0 ? <p>{t("No matching memories.")}</p> : null}
            <div className={styles.list}>
              {hits?.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void openRecord(hit.id)}
                >
                  <strong>{hit.title}</strong>
                  <span>{hit.abstract}</span>
                </button>
              ))}
            </div>
          </section>
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
                    {t("Remember this")}
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
        </aside>
      </div>
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
