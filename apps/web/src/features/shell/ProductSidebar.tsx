/**
 * Product sidebar adapted from DeepSeek Harness' sidebar/workspace browser.
 * Source revision: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
 * Copyright (c) 2026 DeepSeek. Licensed under the MIT License.
 * See ../../../../../THIRD_PARTY_NOTICES.md.
 *
 * This component intentionally owns presentation state only (search and local
 * "show more" disclosure). Workspace, session, selection, and product actions
 * arrive through props so the Octos protocol adapter remains outside the UI.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./ProductSidebar.module.css";

export type ProductSessionStatus =
  "idle" | "running" | "waiting" | "completed" | "failed";

export type ProductSidebarViewMode = "grouped" | "flat";
export type ProductSidebarOrderMode = "manual" | "updated";

export interface ProductSidebarSession {
  id: string;
  title: string;
  blank?: boolean | undefined;
  /** Epoch milliseconds or an ISO timestamp used only for Last updated ordering. */
  updatedAt?: number | string | undefined;
  updatedLabel?: string | undefined;
  status?: ProductSessionStatus | undefined;
  statusLabel?: string | undefined;
}

export interface ProductSidebarWorkspace {
  id: string;
  label: string;
  path?: string | undefined;
  expanded?: boolean | undefined;
  sessionCatalogStatus?:
    "unknown" | "loading" | "loaded" | "error" | "current-only" | undefined;
  sessionCatalogError?: string | undefined;
  sessions: readonly ProductSidebarSession[];
}

export interface ProductSidebarProps {
  collapsed: boolean;
  workspaces: readonly ProductSidebarWorkspace[];
  selectedSessionId: string | null;
  loading?: boolean;
  error?: string | null;
  brandName?: string;
  brandMark?: ReactNode;
  sessionLimit?: number;
  settingsActive?: boolean;
  sessionCreationAvailable?: boolean;
  viewMode?: ProductSidebarViewMode | undefined;
  orderMode?: ProductSidebarOrderMode | undefined;
  onCollapsedChange: (collapsed: boolean) => void;
  onNewSession: (workspaceId?: string) => void;
  onAddWorkspace: () => void;
  onViewModeChange?: ((viewMode: ProductSidebarViewMode) => void) | undefined;
  onOrderModeChange?:
    ((orderMode: ProductSidebarOrderMode) => void) | undefined;
  onWorkspaceExpandedChange: (workspaceId: string, expanded: boolean) => void;
  onSessionSelect: (sessionId: string) => void;
  onSettings: () => void;
  onRetry?: () => void;
}

interface SearchResult {
  session: ProductSidebarSession;
  workspace: ProductSidebarWorkspace;
}

const DEFAULT_SESSION_LIMIT = 5;

export interface ProductSidebarViewOptionsMenuProps {
  viewMode: ProductSidebarViewMode;
  orderMode: ProductSidebarOrderMode;
  onViewModeChange: (viewMode: ProductSidebarViewMode) => void;
  onOrderModeChange: (orderMode: ProductSidebarOrderMode) => void;
  onSelectComplete?: (() => void) | undefined;
}

export function ProductSidebar({
  collapsed,
  workspaces,
  selectedSessionId,
  loading = false,
  error = null,
  brandName = "Octoscode",
  brandMark,
  sessionLimit = DEFAULT_SESSION_LIMIT,
  settingsActive = false,
  sessionCreationAvailable = true,
  viewMode: controlledViewMode,
  orderMode: controlledOrderMode,
  onCollapsedChange,
  onNewSession,
  onAddWorkspace,
  onViewModeChange,
  onOrderModeChange,
  onWorkspaceExpandedChange,
  onSessionSelect,
  onSettings,
  onRetry,
}: ProductSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [uncontrolledViewMode, setUncontrolledViewMode] =
    useState<ProductSidebarViewMode>("grouped");
  const [uncontrolledOrderMode, setUncontrolledOrderMode] =
    useState<ProductSidebarOrderMode>("manual");
  const [revealedWorkspaceIds, setRevealedWorkspaceIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const searchInput = useRef<HTMLInputElement>(null);
  const viewOptionsButton = useRef<HTMLButtonElement>(null);
  const viewOptionsMenu = useRef<HTMLDivElement>(null);
  const viewOptionsMenuId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessionLimit = Math.max(1, Math.floor(sessionLimit));
  const viewMode = controlledViewMode ?? uncontrolledViewMode;
  const orderMode = controlledOrderMode ?? uncontrolledOrderMode;

  const changeViewMode = (next: ProductSidebarViewMode) => {
    if (controlledViewMode === undefined) setUncontrolledViewMode(next);
    onViewModeChange?.(next);
  };
  const changeOrderMode = (next: ProductSidebarOrderMode) => {
    if (controlledOrderMode === undefined) setUncontrolledOrderMode(next);
    onOrderModeChange?.(next);
  };

  const flatSessions = useMemo<SearchResult[]>(() => {
    const sessions = workspaces.flatMap((workspace) =>
      workspace.sessions.map((session) => ({ session, workspace })),
    );
    return orderSearchResults(sessions, orderMode);
  }, [orderMode, workspaces]);

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!normalizedQuery) return [];
    return flatSessions.filter(({ session, workspace }) => {
      const workspaceMatches = [workspace.label, workspace.path].some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery),
      );
      return (
        workspaceMatches ||
        session.title.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [flatSessions, normalizedQuery]);
  const catalogProgress = useMemo(() => {
    let pending = 0;
    let failed = 0;
    let limited = 0;
    for (const workspace of workspaces) {
      if (
        workspace.sessionCatalogStatus === "unknown" ||
        workspace.sessionCatalogStatus === "loading"
      ) {
        pending += 1;
      } else if (workspace.sessionCatalogStatus === "error") {
        failed += 1;
      } else if (workspace.sessionCatalogStatus === "current-only") {
        limited += 1;
      }
    }
    return { pending, failed, limited };
  }, [workspaces]);
  const catalogsIncomplete =
    catalogProgress.pending > 0 ||
    catalogProgress.failed > 0 ||
    catalogProgress.limited > 0;

  const closeViewOptions = useCallback((restoreFocus = false) => {
    setViewOptionsOpen(false);
    if (restoreFocus) viewOptionsButton.current?.focus();
  }, []);

  useEffect(() => {
    if (!collapsed && searchOpen) searchInput.current?.focus();
  }, [collapsed, searchOpen]);

  useEffect(() => {
    if (!viewOptionsOpen) return;
    viewOptionsMenu.current
      ?.querySelector<HTMLButtonElement>("[role='menuitemradio']")
      ?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (viewOptionsButton.current?.contains(event.target)) return;
      if (viewOptionsMenu.current?.contains(event.target)) return;
      closeViewOptions();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeViewOptions(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeViewOptions, viewOptionsOpen]);

  useEffect(() => {
    if (collapsed || searchOpen) closeViewOptions();
  }, [closeViewOptions, collapsed, searchOpen]);

  const openSearch = () => {
    if (collapsed) onCollapsedChange(false);
    closeViewOptions();
    setSearchOpen(true);
  };

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeSearch();
  };

  const revealWorkspace = (workspaceId: string) => {
    setRevealedWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
  };

  const onViewOptionsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeViewOptions(true);
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const items = Array.from(
      viewOptionsMenu.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitemradio']",
      ) ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <aside
      className={`${styles.root} ${collapsed ? styles.collapsed : ""}`}
      aria-label="Product navigation"
    >
      <div className={styles.logoRow}>
        {!collapsed ? (
          sessionCreationAvailable ? (
            <button
              type="button"
              className={styles.brand}
              aria-label="New session"
              onClick={() => onNewSession()}
            >
              <span className={styles.brandIdentity} aria-hidden="true">
                <span className={styles.brandMark}>
                  {brandMark ?? <OctosMark />}
                </span>
                <span className={styles.brandName}>{brandName}</span>
              </span>
            </button>
          ) : (
            <div className={`${styles.brand} ${styles.brandStatic}`}>
              <span className={styles.brandIdentity}>
                <span className={styles.brandMark}>
                  {brandMark ?? <OctosMark />}
                </span>
                <span className={styles.brandName}>{brandName}</span>
              </span>
            </div>
          )
        ) : null}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.toggle}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <>
              <span className={styles.railMark} aria-hidden="true">
                {brandMark ?? <OctosMark />}
              </span>
              <PanelIcon className={styles.panelIcon} />
            </>
          ) : (
            <PanelIcon />
          )}
        </button>
      </div>

      {sessionCreationAvailable ? (
        <button
          type="button"
          className={styles.newSession}
          aria-label="New session"
          title={collapsed ? "New session" : undefined}
          onClick={() => onNewSession()}
        >
          <NewSessionIcon />
          {!collapsed ? <span>New Session</span> : null}
        </button>
      ) : null}

      <div className={styles.regionArea}>
        {collapsed ? (
          <div className={styles.railActions}>
            <button
              type="button"
              className={styles.railButton}
              aria-label="Search sessions"
              title="Search sessions"
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            {sessionCreationAvailable ? (
              <button
                type="button"
                className={styles.railButton}
                aria-label="Add workspace"
                title="Add workspace"
                onClick={onAddWorkspace}
              >
                <AddWorkspaceIcon />
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className={styles.sectionHeader}>
              <span
                className={`${styles.sectionLabel} ${searchOpen ? styles.sectionLabelHidden : ""}`}
              >
                {viewMode === "flat" ? "Sessions" : "Workspaces"}
              </span>
              <div
                className={`${styles.searchSlot} ${searchOpen ? styles.searchSlotExpanded : ""}`}
              >
                <div
                  className={`${styles.search} ${searchOpen ? styles.searchExpanded : ""}`}
                >
                  <button
                    type="button"
                    className={styles.searchButton}
                    aria-label="Search sessions"
                    title={searchOpen ? undefined : "Search sessions"}
                    onClick={openSearch}
                  >
                    <SearchIcon />
                  </button>
                  <input
                    ref={searchInput}
                    className={styles.searchInput}
                    value={query}
                    aria-label="Search sessions"
                    placeholder="Search sessions"
                    tabIndex={searchOpen ? 0 : -1}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onSearchKeyDown}
                  />
                  {searchOpen ? (
                    <button
                      type="button"
                      className={styles.clearButton}
                      aria-label="Close search"
                      title="Close search"
                      onClick={closeSearch}
                    >
                      <CloseIcon />
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className={`${styles.headerActions} ${searchOpen ? styles.headerActionsHidden : ""}`}
              >
                <button
                  ref={viewOptionsButton}
                  type="button"
                  className={styles.iconButton}
                  aria-label="Session view options"
                  title="Session view options"
                  aria-haspopup="menu"
                  aria-expanded={viewOptionsOpen}
                  aria-controls={
                    viewOptionsOpen ? viewOptionsMenuId : undefined
                  }
                  onClick={() => setViewOptionsOpen((open) => !open)}
                >
                  <ViewIcon />
                </button>
                {sessionCreationAvailable ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Add workspace"
                    title="Add workspace"
                    onClick={onAddWorkspace}
                  >
                    <AddWorkspaceIcon />
                  </button>
                ) : null}
              </div>
            </div>

            {viewOptionsOpen ? (
              <div
                ref={viewOptionsMenu}
                id={viewOptionsMenuId}
                className={styles.viewOptionsMenu}
                role="menu"
                aria-label="Session view options"
                onKeyDown={onViewOptionsKeyDown}
              >
                <ProductSidebarViewOptionsMenu
                  viewMode={viewMode}
                  orderMode={orderMode}
                  onViewModeChange={changeViewMode}
                  onOrderModeChange={changeOrderMode}
                  onSelectComplete={() => closeViewOptions(true)}
                />
              </div>
            ) : null}

            <div
              className={styles.treeBody}
              aria-busy={loading || catalogProgress.pending > 0}
            >
              <div
                className={styles.tree}
                role="tree"
                aria-label={
                  normalizedQuery
                    ? "Session search results"
                    : viewMode === "flat"
                      ? "Sessions"
                      : "Workspaces and sessions"
                }
              >
                {error ? (
                  <div className={styles.errorState} role="alert">
                    <span>{error}</span>
                    {onRetry ? (
                      <button type="button" onClick={onRetry}>
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {!error && loading && workspaces.length === 0 ? (
                  <LoadingRows />
                ) : null}

                {!error && !loading && normalizedQuery ? (
                  searchResults.length > 0 ? (
                    <>
                      <div className={styles.searchResults}>
                        {searchResults.map(({ session, workspace }) => (
                          <SearchSessionRow
                            key={`${workspace.id}:${session.id}`}
                            session={session}
                            workspace={workspace}
                            selected={session.id === selectedSessionId}
                            onSelect={onSessionSelect}
                          />
                        ))}
                      </div>
                      <CatalogProgress
                        {...catalogProgress}
                        hasResults
                        onRetry={onRetry}
                      />
                    </>
                  ) : catalogsIncomplete ? (
                    <CatalogProgress
                      {...catalogProgress}
                      hasResults={false}
                      onRetry={onRetry}
                    />
                  ) : (
                    <p className={styles.emptyState}>No sessions found.</p>
                  )
                ) : null}

                {!normalizedQuery &&
                viewMode === "grouped" &&
                workspaces.length > 0
                  ? workspaces.map((workspace) => {
                      const orderedSessions = orderSessions(
                        workspace.sessions,
                        orderMode,
                      );
                      const expanded = workspace.expanded !== false;
                      const selectedIndex = orderedSessions.findIndex(
                        (session) => session.id === selectedSessionId,
                      );
                      const showAll =
                        revealedWorkspaceIds.has(workspace.id) ||
                        selectedIndex >= visibleSessionLimit;
                      const visibleSessions = showAll
                        ? orderedSessions
                        : orderedSessions.slice(0, visibleSessionLimit);
                      const hiddenCount =
                        orderedSessions.length - visibleSessions.length;

                      return (
                        <section
                          className={styles.workspaceGroup}
                          role="treeitem"
                          aria-label={workspace.label}
                          aria-expanded={expanded}
                          key={workspace.id}
                        >
                          <div className={styles.workspaceRow}>
                            <button
                              type="button"
                              className={styles.workspaceToggle}
                              title={workspace.path}
                              onClick={() =>
                                onWorkspaceExpandedChange(
                                  workspace.id,
                                  !expanded,
                                )
                              }
                            >
                              <span
                                className={styles.workspaceLeading}
                                aria-hidden="true"
                              >
                                <FolderIcon open={expanded} />
                                <ChevronIcon
                                  className={expanded ? styles.chevronOpen : ""}
                                />
                              </span>
                              <span className={styles.workspaceLabel}>
                                {workspace.label}
                              </span>
                            </button>
                            {sessionCreationAvailable ? (
                              <button
                                type="button"
                                className={styles.workspaceNewSession}
                                aria-label={`New session in ${workspace.label}`}
                                title={`New session in ${workspace.label}`}
                                onClick={() => onNewSession(workspace.id)}
                              >
                                <PlusIcon />
                              </button>
                            ) : null}
                          </div>

                          {expanded ? (
                            <div className={styles.sessionRun} role="group">
                              {visibleSessions.map((session) => (
                                <SessionRow
                                  key={session.id}
                                  session={session}
                                  selected={session.id === selectedSessionId}
                                  onSelect={onSessionSelect}
                                />
                              ))}
                              {orderedSessions.length === 0 ? (
                                <p className={styles.emptyWorkspace}>
                                  {workspace.sessionCatalogStatus === "loading"
                                    ? "Loading sessions…"
                                    : workspace.sessionCatalogStatus === "error"
                                      ? (workspace.sessionCatalogError ??
                                        "Could not load sessions.")
                                      : workspace.sessionCatalogStatus ===
                                          "current-only"
                                        ? "Start a session to open this workspace."
                                        : workspace.sessionCatalogStatus ===
                                            "unknown"
                                          ? "Expand to load sessions."
                                          : "No sessions yet."}
                                </p>
                              ) : null}
                              {orderedSessions.length > 0 &&
                              workspace.sessionCatalogStatus ===
                                "current-only" ? (
                                <p className={styles.emptyWorkspace}>
                                  Only the open session is shown.
                                </p>
                              ) : null}
                              {hiddenCount > 0 ? (
                                <button
                                  type="button"
                                  className={styles.showMore}
                                  onClick={() => revealWorkspace(workspace.id)}
                                >
                                  Show {hiddenCount} more
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </section>
                      );
                    })
                  : null}

                {!normalizedQuery &&
                viewMode === "flat" &&
                workspaces.length > 0 ? (
                  flatSessions.length > 0 ? (
                    <>
                      <div className={styles.flatSessionList} role="group">
                        {flatSessions.map(({ session, workspace }) => (
                          <SessionRow
                            key={`${workspace.id}:${session.id}`}
                            session={session}
                            selected={session.id === selectedSessionId}
                            onSelect={onSessionSelect}
                          />
                        ))}
                      </div>
                      <CatalogProgress
                        {...catalogProgress}
                        hasResults
                        onRetry={onRetry}
                      />
                    </>
                  ) : catalogsIncomplete ? (
                    <CatalogProgress
                      {...catalogProgress}
                      hasResults={false}
                      onRetry={onRetry}
                    />
                  ) : (
                    <p className={styles.emptyState}>No sessions yet.</p>
                  )
                ) : null}

                {!error &&
                !loading &&
                !normalizedQuery &&
                workspaces.length === 0 ? (
                  <div className={styles.emptyState}>
                    <p>No workspaces yet.</p>
                    <button type="button" onClick={onAddWorkspace}>
                      Add workspace
                    </button>
                  </div>
                ) : null}
              </div>
              <div className={styles.fade} aria-hidden="true" />
            </div>
          </>
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.settings} ${settingsActive ? styles.settingsActive : ""}`}
          aria-current={settingsActive ? "page" : undefined}
          aria-label="Settings"
          title={collapsed ? "Settings" : undefined}
          onClick={onSettings}
        >
          <SettingsIcon />
          {!collapsed ? <span>Settings</span> : null}
        </button>
      </div>
    </aside>
  );
}

function CatalogProgress({
  pending,
  failed,
  limited,
  hasResults,
  onRetry,
}: {
  pending: number;
  failed: number;
  limited: number;
  hasResults: boolean;
  onRetry?: (() => void) | undefined;
}) {
  if (pending === 0 && failed === 0 && limited === 0) return null;
  const workspaceLabel = (count: number) =>
    `${count} workspace${count === 1 ? "" : "s"}`;
  return (
    <div
      className={styles.catalogProgress}
      role={failed > 0 && pending === 0 && limited === 0 ? "alert" : "status"}
    >
      <span>
        {limited > 0
          ? hasResults
            ? "Only open sessions are shown."
            : "Start a session to open a workspace."
          : hasResults
            ? "Results are incomplete."
            : "Sessions are still loading."}
        {pending > 0 ? ` ${workspaceLabel(pending)} pending.` : ""}
        {failed > 0 ? ` ${workspaceLabel(failed)} could not be loaded.` : ""}
      </span>
      {failed > 0 && onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function ProductSidebarViewOptionsMenu(
  props: ProductSidebarViewOptionsMenuProps,
) {
  const { viewMode, onViewModeChange, onSelectComplete } = props;
  const selectViewMode = (next: ProductSidebarViewMode) => {
    onViewModeChange(next);
    onSelectComplete?.();
  };

  return (
    <>
      <div className={styles.viewOptionsLabel} role="presentation">
        Group by
      </div>
      <div role="group" aria-label="Group sessions by">
        <button
          type="button"
          className={styles.viewOptionsItem}
          role="menuitemradio"
          aria-checked={viewMode === "grouped"}
          onClick={() => selectViewMode("grouped")}
        >
          <span>Workspace</span>
          {viewMode === "grouped" ? <CheckIcon /> : null}
        </button>
        <button
          type="button"
          className={styles.viewOptionsItem}
          role="menuitemradio"
          aria-checked={viewMode === "flat"}
          onClick={() => selectViewMode("flat")}
        >
          <span>In one list</span>
          {viewMode === "flat" ? <CheckIcon /> : null}
        </button>
      </div>
    </>
  );
}

function orderSessions(
  sessions: readonly ProductSidebarSession[],
  orderMode: ProductSidebarOrderMode,
): readonly ProductSidebarSession[] {
  return stableUpdatedOrder(
    sessions,
    orderMode,
    (session) => session.updatedAt,
  );
}

function orderSearchResults(
  results: readonly SearchResult[],
  orderMode: ProductSidebarOrderMode,
): SearchResult[] {
  return stableUpdatedOrder(
    results,
    orderMode,
    ({ session }) => session.updatedAt,
  );
}

function stableUpdatedOrder<T>(
  items: readonly T[],
  orderMode: ProductSidebarOrderMode,
  updatedAt: (item: T) => number | string | undefined,
): T[] {
  if (orderMode === "manual") return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      updatedAt: normalizedTimestamp(updatedAt(item)),
    }))
    .sort((left, right) => {
      if (left.updatedAt === undefined && right.updatedAt === undefined) {
        return left.index - right.index;
      }
      if (left.updatedAt === undefined) return 1;
      if (right.updatedAt === undefined) return -1;
      return right.updatedAt - left.updatedAt || left.index - right.index;
    })
    .map(({ item }) => item);
}

function normalizedTimestamp(
  value: number | string | undefined,
): number | undefined {
  const timestamp = typeof value === "string" ? Date.parse(value) : value;
  return timestamp !== undefined && Number.isFinite(timestamp)
    ? timestamp
    : undefined;
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ProductSidebarSession;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const title = session.blank ? "New session" : session.title;
  const status = session.status ?? "idle";
  const showStatus = status !== "idle";

  return (
    <button
      type="button"
      className={`${styles.sessionRow} ${selected ? styles.selected : ""}`}
      role="treeitem"
      aria-current={selected ? "page" : undefined}
      aria-selected={selected}
      onClick={() => onSelect(session.id)}
    >
      <span className={styles.statusSlot}>
        {showStatus ? (
          <StatusDot status={status} label={session.statusLabel} />
        ) : null}
      </span>
      <span className={styles.sessionTitle}>{title}</span>
      {!session.blank && session.updatedLabel ? (
        <span className={styles.sessionTime}>{session.updatedLabel}</span>
      ) : null}
    </button>
  );
}

function SearchSessionRow({
  session,
  workspace,
  selected,
  onSelect,
}: {
  session: ProductSidebarSession;
  workspace: ProductSidebarWorkspace;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const status = session.status ?? "idle";
  return (
    <button
      type="button"
      className={`${styles.searchResultRow} ${selected ? styles.selected : ""}`}
      role="treeitem"
      aria-current={selected ? "page" : undefined}
      aria-selected={selected}
      onClick={() => onSelect(session.id)}
    >
      <span className={styles.searchResultHeading}>
        <span className={styles.statusSlot}>
          {status !== "idle" ? (
            <StatusDot status={status} label={session.statusLabel} />
          ) : null}
        </span>
        <span className={styles.searchResultTitle}>
          {session.blank ? "New session" : session.title}
        </span>
      </span>
      <span className={styles.searchResultMeta}>{workspace.label}</span>
    </button>
  );
}

function StatusDot({
  status,
  label,
}: {
  status: ProductSessionStatus;
  label?: string | undefined;
}) {
  const accessibleLabel = label ?? defaultStatusLabel(status);
  return (
    <>
      <span
        className={styles.statusDot}
        data-status={status}
        title={accessibleLabel}
        aria-hidden="true"
      />
      <span className={styles.visuallyHidden}>{accessibleLabel}</span>
    </>
  );
}

function defaultStatusLabel(status: ProductSessionStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting for input";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

function LoadingRows() {
  return (
    <div className={styles.loadingState} aria-label="Loading workspaces">
      <span />
      <span />
      <span />
    </div>
  );
}

interface IconProps {
  className?: string | undefined;
}

function SvgIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function OctosMark() {
  return (
    <svg
      className={styles.octosMark}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 10.5a7 7 0 0 1 14 0v3.8c0 1.6-1.3 2.9-2.9 2.9-1 0-1.9-.5-2.4-1.3A3 3 0 0 1 11.2 18a3 3 0 0 1-2.5-1.3 2.9 2.9 0 0 1-3.7-2.8v-3.4Z"
        fill="currentColor"
      />
      <circle
        cx="9.3"
        cy="10.5"
        r="1"
        fill="var(--dsw-specific-sidebar-fill)"
      />
      <circle
        cx="14.7"
        cy="10.5"
        r="1"
        fill="var(--dsw-specific-sidebar-fill)"
      />
    </svg>
  );
}

function PanelIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9 4v16" />
    </SvgIcon>
  );
}

function NewSessionIcon() {
  return (
    <SvgIcon>
      <path d="M5 5.5h8.5a3 3 0 0 1 3 3v3" />
      <path d="M5 5.5v13l3.3-3h3.2" />
      <path d="M17 14v6M14 17h6" />
    </SvgIcon>
  );
}

function SearchIcon() {
  return (
    <SvgIcon>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4 4" />
    </SvgIcon>
  );
}

function AddWorkspaceIcon() {
  return (
    <SvgIcon>
      <path d="M3.5 7.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5Z" />
      <path d="M16.5 3.5v5M14 6h5" />
    </SvgIcon>
  );
}

function ViewIcon() {
  return (
    <SvgIcon>
      <path d="M6 5v14M18 5v14M3.5 9h5M15.5 15h5" />
      <circle cx="6" cy="9" r="1.5" />
      <circle cx="18" cy="15" r="1.5" />
    </SvgIcon>
  );
}

function CheckIcon() {
  return (
    <SvgIcon className={styles.viewOptionsCheck}>
      <path d="m6 12 4 4 8-9" />
    </SvgIcon>
  );
}

function CloseIcon() {
  return (
    <SvgIcon>
      <path d="m7 7 10 10M17 7 7 17" />
    </SvgIcon>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <SvgIcon className={styles.folderIcon}>
      {open ? (
        <path d="M3.5 9h17l-2 10H5.5l-2-10Zm1-4h5l2 2h8v2h-16V6a1 1 0 0 1 1-1Z" />
      ) : (
        <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2H19a1.5 1.5 0 0 1 1.5 1.5V19h-17V6.5Z" />
      )}
    </SvgIcon>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <SvgIcon className={`${styles.chevronIcon} ${className ?? ""}`}>
      <path d="m9 6 6 6-6 6" />
    </SvgIcon>
  );
}

function PlusIcon() {
  return (
    <SvgIcon>
      <path d="M12 5v14M5 12h14" />
    </SvgIcon>
  );
}

function SettingsIcon() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7l-.7-2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7l-2 .7v3l2 .7c.2.6.4 1.2.7 1.7l-.9 1.9 2.1 2.1 1.9-.9c.5.3 1.1.5 1.7.7l.7 2h3l.7-2c.6-.2 1.2-.4 1.7-.7l1.9.9 2.1-2.1-.9-1.9c.3-.5.5-1.1.7-1.7l2-.7Z" />
    </SvgIcon>
  );
}
