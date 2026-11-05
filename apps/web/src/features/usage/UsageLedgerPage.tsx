import { useEffect, useMemo, useRef, useState } from "react";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import {
  UsageReadError,
  type UsageAnalytics,
  type UsageFailure,
  type UsageRollup,
  type UsageScope,
  type UsageTotals,
} from "@octos-org/octoscode-client/usage";
import { formatUsd } from "../composer-bar/session-usage.ts";
import { usePreferences } from "../preferences/preferences.tsx";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import {
  USAGE_RANGES,
  daysNewestFirst,
  modelsByUse,
  promptTokens,
  rangeStart,
  recordedCost,
  scopeKeyOf,
  sessionPage,
  usageQueryKey,
  type UsageRange,
  type UsageSessionRow,
} from "./usage-model.ts";
import styles from "./UsageLedgerPage.module.css";

interface UsageLedgerPageProps {
  client: OctosUiClient;
  /** The profile this connection's Sessions run under. */
  profileId: string;
  /** The Sessions the sidebar lists for that profile. */
  sessions: readonly UsageSessionRow[];
}

type ScopeState =
  | { status: "loading" }
  | { status: "ready"; scope: UsageScope }
  | { status: "failed"; failure: UsageFailure };

interface SummaryState {
  key: string;
  loading: boolean;
  data: UsageAnalytics | null;
  failure: UsageFailure | null;
}

interface PageState {
  key: string;
  loading: boolean;
  rows: ReadonlyMap<string, UsageTotals | "failed">;
}

const FAILURE_TEXT: Record<UsageFailure, string> = {
  unsupported: "This server does not keep a usage ledger.",
  "signed-out":
    "The server no longer accepts this sign-in. Reconnect, then try again.",
  forbidden: "This account cannot see usage here.",
  invalid: "The server answered in a form this page cannot read.",
  failed: "Couldn't read usage. Check the connection and try again.",
};

function failureOf(reason: unknown): UsageFailure {
  return reason instanceof UsageReadError ? reason.kind : "failed";
}

export function UsageLedgerPage({
  client,
  profileId,
  sessions,
}: UsageLedgerPageProps) {
  const t = useUiText();
  const { language } = usePreferences();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [range, setRange] = useState<UsageRange>("30d");
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [scopeAttempt, setScopeAttempt] = useState(0);
  const [scopeState, setScopeState] = useState<ScopeState>({
    status: "loading",
  });
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [pageState, setPageState] = useState<PageState | null>(null);
  const totalsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const request = new AbortController();
    setScopeState({ status: "loading" });
    void client
      .usageCommands(profileId)
      .then((usage) => usage.scope(request.signal))
      .then(
        (scope) => {
          if (!request.signal.aborted)
            setScopeState({ status: "ready", scope });
        },
        (reason: unknown) => {
          if (!request.signal.aborted)
            setScopeState({ status: "failed", failure: failureOf(reason) });
        },
      );
    return () => request.abort();
  }, [client, profileId, scopeAttempt]);

  const scopeKey =
    scopeState.status === "ready" ? scopeKeyOf(scopeState.scope) : null;

  const ordered = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity) ||
          a.sessionId.localeCompare(b.sessionId),
      ),
    [sessions],
  );
  const paged = sessionPage(ordered, page);
  const pageIds = paged.rows.map((row) => row.sessionId).join("\n");

  // The totals: the whole ledger for the period, or one Session's part of it.
  const summaryKey = scopeKey
    ? usageQueryKey(scopeKey, range, sessionFilter)
    : null;
  useEffect(() => {
    if (!scopeKey || !summaryKey) return;
    const scope = JSON.parse(scopeKey) as UsageScope;
    const request = new AbortController();
    // A refresh keeps the figures it is refreshing; another query starts blank.
    setSummary((current) =>
      current?.key === summaryKey
        ? { ...current, loading: true, failure: null }
        : { key: summaryKey, loading: true, data: null, failure: null },
    );
    const from = rangeStart(range, new Date());
    void client
      .usageCommands(profileId)
      .then((usage) =>
        usage.read(
          scope,
          {
            ...(sessionFilter ? { sessionId: sessionFilter } : {}),
            ...(from ? { from } : {}),
          },
          request.signal,
        ),
      )
      .then(
        (data) => {
          if (!request.signal.aborted)
            setSummary({
              key: summaryKey,
              loading: false,
              data,
              failure: null,
            });
        },
        (reason: unknown) => {
          if (!request.signal.aborted)
            setSummary({
              key: summaryKey,
              loading: false,
              data: null,
              failure: failureOf(reason),
            });
        },
      );
    return () => request.abort();
  }, [client, profileId, scopeKey, summaryKey, range, sessionFilter, refresh]);

  // One read per Session on the visible page; nothing is added up across pages.
  const pageKey = scopeKey ? usageQueryKey(scopeKey, range, pageIds) : null;
  useEffect(() => {
    if (!scopeKey || !pageKey || !pageIds) return;
    const scope = JSON.parse(scopeKey) as UsageScope;
    const ids = pageIds.split("\n");
    const request = new AbortController();
    setPageState((current) =>
      current?.key === pageKey
        ? { ...current, loading: true }
        : { key: pageKey, loading: true, rows: new Map() },
    );
    const from = rangeStart(range, new Date());
    void (async () => {
      const usage = await client.usageCommands(profileId);
      for (const sessionId of ids) {
        let result: UsageTotals | "failed";
        try {
          result = (
            await usage.read(
              scope,
              { sessionId, ...(from ? { from } : {}) },
              request.signal,
            )
          ).totals;
        } catch {
          if (request.signal.aborted) return;
          result = "failed";
        }
        if (request.signal.aborted) return;
        setPageState((current) => {
          if (current?.key !== pageKey) return current;
          const rows = new Map(current.rows);
          rows.set(sessionId, result);
          return { ...current, rows };
        });
      }
      setPageState((current) =>
        current?.key === pageKey ? { ...current, loading: false } : current,
      );
    })();
    return () => request.abort();
  }, [client, profileId, scopeKey, pageKey, pageIds, range, refresh]);

  const tokens = (value: number) => new Intl.NumberFormat(locale).format(value);
  const titleOf = (sessionId: string) =>
    ordered.find((row) => row.sessionId === sessionId)?.title?.trim() ||
    t("Untitled session");
  const shownSummary = summary?.key === summaryKey ? summary : null;
  const shownPage = pageState?.key === pageKey ? pageState : null;
  const busy =
    scopeState.status === "loading" ||
    Boolean(shownSummary?.loading) ||
    Boolean(shownPage?.loading);
  const retry = () => {
    if (scopeState.status === "failed") setScopeAttempt((value) => value + 1);
    else setRefresh((value) => value + 1);
  };

  return (
    <div className={styles.scroll} data-usage-ledger>
      <div className={styles.page}>
        <header className={styles.heading}>
          <div>
            <h2>{t("Usage")}</h2>
            <p>
              {t(
                "What the server recorded for each finished run. Every figure here comes from its usage ledger; this page keeps no copy.",
              )}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={retry}>
            {t("Refresh")}
          </button>
        </header>
        <div className={styles.controls}>
          <div
            role="radiogroup"
            aria-label={t("Period")}
            className={styles.ranges}
          >
            {USAGE_RANGES.map((option) => (
              <label key={option.value} className={styles.range}>
                <input
                  type="radio"
                  name="usage-range"
                  checked={range === option.value}
                  onChange={() => setRange(option.value)}
                />
                <span>{t(option.label)}</span>
              </label>
            ))}
          </div>
          {scopeState.status === "ready" ? (
            <p className={styles.hint}>
              {scopeState.scope.kind === "profile"
                ? t("Profile {profile}", {
                    profile: scopeState.scope.profileId,
                  })
                : t("Your account")}
            </p>
          ) : null}
        </div>
        {scopeState.status === "failed" ? (
          <Failure t={t} failure={scopeState.failure} onRetry={retry} />
        ) : scopeState.status === "loading" ? (
          <p className={styles.hint} role="status">
            {t("Reading usage…")}
          </p>
        ) : (
          <>
            <section
              ref={totalsRef}
              className={styles.section}
              aria-labelledby="usage-totals-heading"
            >
              <div className={styles.sectionHead}>
                <h3 id="usage-totals-heading">
                  {sessionFilter ? t("One session") : t("All sessions")}
                </h3>
                {sessionFilter ? (
                  <div className={styles.filter}>
                    <span data-usage-filter>{titleOf(sessionFilter)}</span>
                    <button
                      type="button"
                      onClick={() => setSessionFilter(null)}
                    >
                      {t("Show all sessions")}
                    </button>
                  </div>
                ) : null}
              </div>
              <Summary
                t={t}
                state={shownSummary}
                tokens={tokens}
                range={range}
                filtered={Boolean(sessionFilter)}
                onRetry={retry}
              />
            </section>
            <section
              className={styles.section}
              aria-labelledby="usage-sessions-heading"
              data-usage-sessions
            >
              <div className={styles.sectionHead}>
                <h3 id="usage-sessions-heading">{t("By session")}</h3>
                {paged.pages > 1 ? (
                  <nav className={styles.pager} aria-label={t("Session pages")}>
                    <button
                      type="button"
                      disabled={paged.page === 0}
                      onClick={() => setPage(paged.page - 1)}
                    >
                      {t("Previous page")}
                    </button>
                    <span>
                      {t("Page {page} of {pages}", {
                        page: paged.page + 1,
                        pages: paged.pages,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={paged.page >= paged.pages - 1}
                      onClick={() => setPage(paged.page + 1)}
                    >
                      {t("Next page")}
                    </button>
                  </nav>
                ) : null}
              </div>
              <p className={styles.hint}>
                {t(
                  "Sessions from the sidebar, one page at a time. The totals above are the server's own and also count sessions not listed here.",
                )}
              </p>
              {paged.rows.length === 0 ? (
                <p className={styles.empty}>
                  {t("The sidebar has no sessions to list.")}
                </p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t("Session")}</th>
                      <NumberHeads t={t} />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((row) => {
                      const totals = shownPage?.rows.get(row.sessionId);
                      const selected = sessionFilter === row.sessionId;
                      return (
                        <tr
                          key={row.sessionId}
                          data-usage-session={row.sessionId}
                          className={selected ? styles.selected : undefined}
                        >
                          <th scope="row">
                            <button
                              type="button"
                              className={styles.rowButton}
                              aria-pressed={selected}
                              onClick={() => {
                                setSessionFilter(
                                  selected ? null : row.sessionId,
                                );
                                // On a phone the totals it changes are a screen up.
                                totalsRef.current?.scrollIntoView?.({
                                  block: "nearest",
                                });
                              }}
                            >
                              {row.title?.trim() || t("Untitled session")}
                            </button>
                          </th>
                          {totals === undefined ? (
                            <td colSpan={4} className={styles.pending}>
                              {t("Reading…")}
                            </td>
                          ) : totals === "failed" ? (
                            <td colSpan={4} className={styles.rowError}>
                              {t("Couldn't read this session.")}
                            </td>
                          ) : totals.runCount === 0 ? (
                            <td colSpan={4} className={styles.pending}>
                              {t("No runs in this period.")}
                            </td>
                          ) : (
                            <NumberCells
                              t={t}
                              totals={totals}
                              tokens={tokens}
                            />
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({
  t,
  state,
  tokens,
  range,
  filtered,
  onRetry,
}: {
  t: UiText;
  state: SummaryState | null;
  tokens: (value: number) => string;
  range: UsageRange;
  filtered: boolean;
  onRetry: () => void;
}) {
  if (state?.failure)
    return <Failure t={t} failure={state.failure} onRetry={onRetry} />;
  if (!state?.data)
    return (
      <p className={styles.hint} role="status">
        {t("Reading usage…")}
      </p>
    );
  const { totals } = state.data;
  if (totals.runCount === 0)
    return (
      <p className={styles.empty} data-usage-empty>
        {filtered
          ? t("This session has no runs in this period.")
          : range === "all"
            ? t(
                "No runs recorded yet. Each finished reply adds to this ledger.",
              )
            : t("No runs in this period.")}
      </p>
    );
  const cost = recordedCost(totals);
  return (
    <div className={styles.summary} aria-busy={state.loading}>
      <dl className={styles.totals} data-usage-totals>
        <div>
          <dt>{t("Runs")}</dt>
          <dd>{tokens(totals.runCount)}</dd>
        </div>
        <div>
          <dt>{t("Input tokens")}</dt>
          <dd>
            {tokens(promptTokens(totals))}
            {totals.cacheReadTokens > 0 ? (
              <small>
                {t("{count} from cache", {
                  count: tokens(totals.cacheReadTokens),
                })}
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t("Output tokens")}</dt>
          <dd>{tokens(totals.outputTokens)}</dd>
        </div>
        <div>
          <dt>{t("Cost")}</dt>
          <dd data-usage-cost>
            {cost === null ? t("Not recorded") : formatUsd(cost)}
            <small>
              {cost === null
                ? t("The server has no price for these runs.")
                : t("The server's estimate, from priced runs only.")}
            </small>
          </dd>
        </div>
      </dl>
      <Breakdown
        t={t}
        caption={t("By model")}
        keyLabel={t("Model")}
        rows={modelsByUse(state.data.byModel)}
        tokens={tokens}
        name="model"
      />
      <Breakdown
        t={t}
        caption={t("By date (UTC)")}
        keyLabel={t("Date (UTC)")}
        rows={daysNewestFirst(state.data.byDay)}
        tokens={tokens}
        name="day"
      />
    </div>
  );
}

function Breakdown({
  t,
  caption,
  keyLabel,
  rows,
  tokens,
  name,
}: {
  t: UiText;
  caption: string;
  keyLabel: string;
  rows: readonly UsageRollup[];
  tokens: (value: number) => string;
  name: string;
}) {
  return (
    <table className={styles.table} data-usage-breakdown={name}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{keyLabel}</th>
          <NumberHeads t={t} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              {row.key === "unknown" ? t("Not reported") : row.key}
            </th>
            <NumberCells t={t} totals={row.totals} tokens={tokens} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NumberHeads({ t }: { t: UiText }) {
  return (
    <>
      <th scope="col">{t("Runs")}</th>
      <th scope="col">{t("Input tokens")}</th>
      <th scope="col">{t("Output tokens")}</th>
      <th scope="col">{t("Cost")}</th>
    </>
  );
}

function NumberCells({
  t,
  totals,
  tokens,
}: {
  t: UiText;
  totals: UsageTotals;
  tokens: (value: number) => string;
}) {
  const cost = recordedCost(totals);
  return (
    <>
      <td data-label={t("Runs")}>{tokens(totals.runCount)}</td>
      <td data-label={t("Input tokens")}>{tokens(promptTokens(totals))}</td>
      <td data-label={t("Output tokens")}>{tokens(totals.outputTokens)}</td>
      <td
        data-label={t("Cost")}
        className={cost === null ? styles.unpriced : undefined}
      >
        {cost === null ? t("Not recorded") : formatUsd(cost)}
      </td>
    </>
  );
}

function Failure({
  t,
  failure,
  onRetry,
}: {
  t: UiText;
  failure: UsageFailure;
  onRetry: () => void;
}) {
  return (
    <div className={styles.failure} role="alert" data-usage-failure={failure}>
      <p>{t(FAILURE_TEXT[failure])}</p>
      <button type="button" onClick={onRetry}>
        {t("Try again")}
      </button>
    </div>
  );
}
