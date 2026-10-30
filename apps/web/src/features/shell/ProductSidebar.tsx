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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { ThemeIcon } from "../../ui/ThemeIcon.tsx";
import styles from "./ProductSidebar.module.css";
import {
  DeleteSessionDialog,
  SessionActionsMenu,
  SessionRenameField,
  type SessionRowActions,
} from "./SessionActions.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  PeerDock,
  type PeerDockManager,
  type PeerDockProps,
} from "../peers/PeerDock.tsx";
import type { ApprovalDecision } from "@octos-org/octoscode-client/protocol";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";

export type ProductSessionStatus =
  "idle" | "running" | "waiting" | "completed" | "attention" | "failed";

export type ProductSidebarViewMode = "grouped" | "flat";
export type ProductSidebarOrderMode = "manual" | "updated" | "oldest";

export interface ProductSidebarSession {
  id: string;
  title: string;
  blank?: boolean | undefined;
  opening?: boolean;
  /** Last-opened time, as epoch milliseconds or an ISO timestamp. */
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
    | "unknown"
    | "loading"
    | "loaded"
    | "error"
    | "current-only"
    | "known-only"
    | undefined;
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
  sessionLimit?: number;
  settingsActive?: boolean;
  /** The Fleet navigation entry descriptor (mounted next to Settings). */
  fleetEntry?: {
    label: string;
    icon: string;
  } | null;
  fleetActive?: boolean;
  /** Peer control/dispatch and external-driver support for the Fleet route. */
  fleetAvailable?: boolean;
  /** Monotonic presentation intent from the /sessions command. */
  searchRequest?: number;
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
  /**
   * Renames a session row. Resolves to the error to show beside the field,
   * or null once the server accepted the title. Absent: no Rename action.
   */
  onSessionRename?:
    ((sessionId: string, title: string) => Promise<string | null>) | undefined;
  /**
   * Deletes a session row after the user confirmed. Resolves to the error to
   * show in the dialog, or null once the server deleted it. Absent: no
   * Delete action.
   */
  onSessionDelete?: ((sessionId: string) => Promise<string | null>) | undefined;
  onSettings: () => void;
  theme?: "system" | "light" | "dark";
  onThemeToggle?: () => void;
  onFleet?: (() => void) | undefined;
  onRetry?: () => void;
  /**
   * Always-visible peer roster dock (dock plan section 1). The dock owns its
   * own hiding rules: it renders nothing when this is null or the roster is
   * empty, so the sidebar never gates it.
   */
  peerDock?: PeerDockManager | null | undefined;
  peerRoster?: PeerDockProps["roster"];
  peerActionRoster?: PeerDockProps["actionRoster"];
  /**
   * Answers a blocked peer's pending APPROVAL (web gap 6). The sidebar is a
   * pass-through only: it threads this straight to the dock, which stays pure.
   * The App wiring to `peer/control` is a LATER grant — until then this stays
   * optional, and the dock renders its row actions only when it is threaded.
   */
  onApprovalRespond?:
    ((entry: PeerRosterEntry, decision: ApprovalDecision) => void) | undefined;
  /** Round 3 item 6 (judge #4): the dock rows' real-id action seam. */
  onPeerDockRowAction?: PeerDockProps["onRowAction"];
  onPeerDockSelect?: PeerDockProps["onSelect"];
  /**
   * Controlled PeerDock fold (reference TUI `peer_dock_collapsed`). The shell
   * owns the state (Alt+P flips it in App) and the sidebar is again a pure
   * pass-through: it threads both straight to the dock, which never folds
   * itself.
   */
  peerDockCollapsed?: boolean;
  onPeerDockToggle?: (() => void) | undefined;
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
  sessionLimit = DEFAULT_SESSION_LIMIT,
  settingsActive = false,
  fleetEntry = null,
  fleetActive = false,
  fleetAvailable = true,
  searchRequest = 0,
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
  onSessionRename,
  onSessionDelete,
  onSettings,
  theme = "system",
  onThemeToggle,
  onFleet,
  onRetry,
  peerDock = null,
  peerRoster,
  peerActionRoster,
  onApprovalRespond,
  onPeerDockRowAction,
  onPeerDockSelect,
  peerDockCollapsed = false,
  onPeerDockToggle,
}: ProductSidebarProps) {
  const t = useUiText();
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
  const searchButton = useRef<HTMLButtonElement>(null);
  const viewOptionsButton = useRef<HTMLButtonElement>(null);
  const viewOptionsMenu = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const viewOptionsMenuId = useId();
  // Roving focus via aria-activedescendant: the tree container keeps DOM
  // focus while Arrow keys move the active row (WAI-ARIA tree pattern).
  const [activeTreeItemId, setActiveTreeItemId] = useState<string | null>(null);
  const treeBodyRef = useRef<HTMLDivElement>(null);
  const sessionMenuId = useId();
  const [sessionMenu, setSessionMenu] = useState<{
    sessionId: string;
    anchor: HTMLElement;
    trigger: HTMLElement | null;
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    sessionId: string;
    rowId: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    sessionId: string;
    rowId: string;
    title: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  // A saved title shows at once; the server's list catches up on refresh.
  const [titleOverrides, setTitleOverrides] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
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
      const title = titleOverrides.get(session.id) ?? session.title;
      return (
        workspaceMatches || title.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [flatSessions, normalizedQuery, titleOverrides]);
  const sessionsById = useMemo(
    () =>
      new Map(
        workspaces.flatMap((workspace) =>
          workspace.sessions.map((session) => [session.id, session] as const),
        ),
      ),
    [workspaces],
  );
  useEffect(() => {
    setTitleOverrides((current) => {
      const stale = [...current].filter(
        ([sessionId, title]) => sessionsById.get(sessionId)?.title !== title,
      );
      if (stale.length === current.size) return current;
      return new Map(stale);
    });
  }, [sessionsById]);
  const displayTitle = (session: ProductSidebarSession) =>
    titleOverrides.get(session.id) ?? session.title;
  const rowActions = (
    session: ProductSidebarSession,
  ): SessionRowActions | null => {
    if (session.blank || (!onSessionRename && !onSessionDelete)) return null;
    const status = session.opening ? "running" : session.status;
    return {
      rename: Boolean(onSessionRename),
      delete: !onSessionDelete
        ? null
        : session.id === selectedSessionId
          ? "open"
          : status === "running" || status === "waiting"
            ? "running"
            : "available",
    };
  };

  /** Puts keyboard focus back on the tree with `rowId` as its active row. */
  const focusTreeRow = (rowId: string | null) => {
    if (rowId && document.getElementById(rowId)) setActiveTreeItemId(rowId);
    treeRef.current?.focus();
  };

  const openSessionMenu = (
    sessionId: string,
    anchor: HTMLElement,
    trigger: HTMLElement | null,
  ) => {
    if (sessionMenu?.sessionId === sessionId && sessionMenu.anchor === anchor) {
      setSessionMenu(null);
      return;
    }
    setActiveTreeItemId(anchor.id);
    setSessionMenu({ sessionId, anchor, trigger });
  };

  const closeSessionMenu = (restoreFocus: boolean) => {
    const menu = sessionMenu;
    setSessionMenu(null);
    if (!restoreFocus || !menu) return;
    if (menu.trigger?.isConnected && menu.trigger.offsetParent !== null) {
      menu.trigger.focus();
    } else {
      focusTreeRow(menu.anchor.id);
    }
  };

  const startRename = (sessionId: string, rowId: string) => {
    setSessionMenu(null);
    setActiveTreeItemId(rowId);
    setRenaming({ sessionId, rowId, saving: false, error: null });
  };

  /** Focus returns to the tree only if the field still had it. */
  const finishRename = (rowId: string) => {
    const row = document.getElementById(rowId);
    const hadFocus = Boolean(row?.contains(document.activeElement));
    setRenaming(null);
    if (hadFocus) focusTreeRow(rowId);
  };

  const saveRename = async (sessionId: string, title: string) => {
    if (!onSessionRename || !renaming) return;
    const { rowId } = renaming;
    setRenaming({ sessionId, rowId, saving: true, error: null });
    let error: string | null;
    try {
      error = await onSessionRename(sessionId, title);
    } catch {
      error = t("Could not rename this session.");
    }
    if (error) {
      setRenaming({ sessionId, rowId, saving: false, error });
      return;
    }
    setTitleOverrides((current) => new Map(current).set(sessionId, title));
    finishRename(rowId);
  };

  const startDelete = (sessionId: string, rowId: string) => {
    const session = sessionsById.get(sessionId);
    if (!session) return;
    setSessionMenu(null);
    setDeleting({
      sessionId,
      rowId,
      title: displayTitle(session),
      busy: false,
      error: null,
    });
  };

  const confirmDelete = async () => {
    if (!onSessionDelete || !deleting || deleting.busy) return;
    const target = deleting;
    setDeleting({ ...target, busy: true, error: null });
    let error: string | null;
    try {
      error = await onSessionDelete(target.sessionId);
    } catch {
      error = t("Could not delete this session.");
    }
    if (error) {
      setDeleting({ ...target, busy: false, error });
      return;
    }
    setDeleting(null);
    // The row is gone; keep the keyboard in the list.
    requestAnimationFrame(() => focusTreeRow(null));
  };

  const cancelDelete = () => {
    const rowId = deleting?.rowId ?? null;
    setDeleting(null);
    requestAnimationFrame(() => focusTreeRow(rowId));
  };

  const renderSessionRow = (
    session: ProductSidebarSession,
    rowId: string,
    meta?: string,
  ) => {
    const actions = rowActions(session);
    return (
      <SessionRow
        key={rowId}
        id={rowId}
        active={activeTreeItemId === rowId}
        session={session}
        title={displayTitle(session)}
        {...(meta === undefined ? {} : { meta })}
        selected={session.id === selectedSessionId}
        onSelect={onSessionSelect}
        actions={actions}
        menuOpen={
          sessionMenu?.sessionId === session.id &&
          sessionMenu.anchor.id === rowId
        }
        menuId={sessionMenuId}
        onMenu={openSessionMenu}
        rename={
          renaming?.sessionId === session.id && renaming.rowId === rowId ? (
            <SessionRenameField
              initialTitle={displayTitle(session)}
              saving={renaming.saving}
              error={renaming.error}
              onSave={(title) => void saveRename(session.id, title)}
              onCancel={() => finishRename(rowId)}
            />
          ) : null
        }
      />
    );
  };

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
      } else if (
        workspace.sessionCatalogStatus === "current-only" ||
        workspace.sessionCatalogStatus === "known-only"
      ) {
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
  }, [collapsed, searchOpen, searchRequest]);
  useEffect(() => {
    if (searchRequest > 0) setSearchOpen(true);
  }, [searchRequest]);

  useLayoutEffect(() => {
    if (
      activeTreeItemId &&
      !treeRef.current?.contains(document.getElementById(activeTreeItemId))
    ) {
      setActiveTreeItemId(null);
    }
  }, [activeTreeItemId, normalizedQuery, viewMode, workspaces]);

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
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229)
        return;
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
    searchButton.current?.focus();
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== "Escape" ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    closeSearch();
  };

  const treeItems = () =>
    Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    );

  const moveTreeActive = (next: HTMLElement) => {
    // Hand focus from a clicked row back to the tree, which tracks the
    // active row from here on.
    if (document.activeElement?.getAttribute("role") === "treeitem")
      treeRef.current?.focus();
    setActiveTreeItemId(next.id);
    next.scrollIntoView({ block: "nearest", inline: "start" });
  };

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The tree owns its roving focus keys. Nested buttons and the rename
    // field keep their own keys (New session, Show more, row actions). A row
    // that took focus from a click is not a button any more, so its keys are
    // the tree's too, acting on that row.
    const focusedRow =
      event.target instanceof HTMLElement &&
      event.target !== event.currentTarget &&
      event.target.getAttribute("role") === "treeitem" &&
      event.target.id
        ? event.target
        : null;
    if (
      (event.target !== event.currentTarget && !focusedRow) ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    const activeId = focusedRow?.id ?? activeTreeItemId;
    if (
      event.key === "F2" ||
      event.key === "Delete" ||
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      const row = activeId ? document.getElementById(activeId) : null;
      const sessionId = row?.getAttribute("data-session-id");
      const session = sessionId ? sessionsById.get(sessionId) : undefined;
      const actions = session ? rowActions(session) : null;
      if (!row || !session || !actions) return;
      event.preventDefault();
      if (event.key === "F2") {
        if (actions.rename) startRename(session.id, row.id);
      } else if (event.key === "Delete" && actions.delete === "available") {
        startDelete(session.id, row.id);
      } else {
        // The menu also explains why Delete is unavailable.
        openSessionMenu(session.id, row, null);
      }
      return;
    }
    const keys = [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "Enter",
    ];
    if (!keys.includes(event.key)) return;
    const items = treeItems();
    const first = items[0];
    if (!first) return;
    // With no active row yet, the first ArrowDown/ArrowUp activates the
    // first/last item instead of skipping past it.
    const currentIndex = activeId
      ? items.findIndex((el) => el.id === activeId)
      : -1;
    const activeElement =
      (activeId ? document.getElementById(activeId) : undefined) ?? first;

    const focusNext = (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
      const next = items[clamped];
      if (!next) return;
      event.preventDefault();
      moveTreeActive(next);
    };

    switch (event.key) {
      case "ArrowDown":
        focusNext(currentIndex < 0 ? 0 : currentIndex + 1);
        return;
      case "ArrowUp":
        focusNext(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
        return;
      case "Home":
        focusNext(0);
        return;
      case "End":
        focusNext(items.length - 1);
        return;
      case "Enter": {
        event.preventDefault();
        const expanded = activeElement.getAttribute("aria-expanded");
        const workspaceId = activeElement.getAttribute("data-workspace-id");
        if (workspaceId !== null && expanded !== null) {
          onWorkspaceExpandedChange(workspaceId, expanded !== "true");
        } else {
          activeElement.click();
        }
        return;
      }
      case "ArrowRight": {
        const workspaceId = activeElement.getAttribute("data-workspace-id");
        if (
          workspaceId !== null &&
          activeElement.getAttribute("aria-expanded") === "false"
        ) {
          event.preventDefault();
          onWorkspaceExpandedChange(workspaceId, true);
        } else if (activeElement.getAttribute("aria-expanded") === "true") {
          const child = activeElement
            .closest('[role="group"]')
            ?.querySelector<HTMLElement>('[role="group"] [role="treeitem"]');
          if (child) {
            event.preventDefault();
            moveTreeActive(child);
          }
        }
        return;
      }
      case "ArrowLeft": {
        const workspaceId = activeElement.getAttribute("data-workspace-id");
        if (
          workspaceId !== null &&
          activeElement.getAttribute("aria-expanded") === "true"
        ) {
          event.preventDefault();
          onWorkspaceExpandedChange(workspaceId, false);
          return;
        }
        const parent = activeElement
          .closest("[data-workspace-id]")
          ?.querySelector(":scope > [role='treeitem']");
        if (parent instanceof HTMLElement) {
          event.preventDefault();
          moveTreeActive(parent);
        }
        return;
      }
    }
  };

  const syncTreeActiveFromClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest('[role="treeitem"]');
    if (item?.id) setActiveTreeItemId(item.id);
  };

  const revealWorkspace = (workspaceId: string) => {
    setRevealedWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
  };

  const onViewOptionsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
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
      aria-label={t("Product navigation")}
    >
      <div className={styles.logoRow}>
        {!collapsed ? (
          sessionCreationAvailable ? (
            <button
              type="button"
              className={styles.brand}
              // WCAG 2.5.3: the visible brand name must be part of the
              // accessible name of the control it labels.
              aria-label={`${t("New session")} — ${brandName}`}
              onClick={() => onNewSession()}
            >
              <span className={styles.brandIdentity} aria-hidden="true">
                <span className={styles.brandMark}>
                  <OctopusLogo size={24} />
                </span>
                <span className={styles.brandName}>{brandName}</span>
              </span>
            </button>
          ) : (
            <div className={`${styles.brand} ${styles.brandStatic}`}>
              <span className={styles.brandIdentity}>
                <span className={styles.brandMark}>
                  <OctopusLogo size={24} />
                </span>
                <span className={styles.brandName}>{brandName}</span>
              </span>
            </div>
          )
        ) : null}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.toggle}`}
          aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
          title={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <>
              <span className={styles.railMark} aria-hidden="true">
                <OctopusLogo size={24} />
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
          aria-label={t("New session")}
          title={collapsed ? t("New session") : undefined}
          onClick={() => onNewSession()}
        >
          <OctopusLogo size={18} />
          {!collapsed ? <span>{t("New Session")}</span> : null}
        </button>
      ) : null}

      <div className={styles.regionArea}>
        {collapsed ? (
          <div className={styles.railActions}>
            <button
              type="button"
              className={styles.railButton}
              aria-label={t("Search sessions")}
              title={t("Search sessions")}
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            {sessionCreationAvailable ? (
              <button
                type="button"
                className={styles.railButton}
                aria-label={t("Add workspace")}
                title={t("Add workspace")}
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
                {viewMode === "flat" ? t("Sessions") : t("Workspaces")}
              </span>
              <div
                className={`${styles.searchSlot} ${searchOpen ? styles.searchSlotExpanded : ""}`}
              >
                <div
                  className={`${styles.search} ${searchOpen ? styles.searchExpanded : ""}`}
                >
                  <button
                    ref={searchButton}
                    type="button"
                    className={styles.searchButton}
                    aria-label={t("Search sessions")}
                    title={searchOpen ? undefined : t("Search sessions")}
                    onClick={openSearch}
                  >
                    <SearchIcon />
                  </button>
                  <input
                    ref={searchInput}
                    className={styles.searchInput}
                    value={query}
                    aria-label={t("Search sessions")}
                    placeholder={t("Search sessions")}
                    tabIndex={searchOpen ? 0 : -1}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onSearchKeyDown}
                  />
                  {searchOpen ? (
                    <button
                      type="button"
                      className={styles.clearButton}
                      aria-label={t("Close search")}
                      title={t("Close search")}
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
                  aria-label={t("Session view options")}
                  title={t("Session view options")}
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
                    aria-label={t("Add workspace")}
                    title={t("Add workspace")}
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
                aria-label={t("Session view options")}
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
              ref={treeBodyRef}
              className={styles.treeBody}
              aria-busy={loading || catalogProgress.pending > 0}
            >
              {/* Status, progress, and empty states stay outside the tree:
                  interactive elements and bare content are not permitted as
                  direct tree children, so the tree only contains its items. */}
              {error ? (
                <div className={styles.errorState} role="alert">
                  <span>{error}</span>
                  {onRetry ? (
                    <button type="button" onClick={onRetry}>
                      {t("Retry")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!error && loading && workspaces.length === 0 ? (
                <LoadingRows />
              ) : null}

              <div
                ref={treeRef}
                className={styles.tree}
                role="tree"
                tabIndex={0}
                aria-activedescendant={activeTreeItemId ?? undefined}
                aria-label={
                  normalizedQuery
                    ? t("Session search results")
                    : viewMode === "flat"
                      ? t("Sessions")
                      : t("Workspaces and sessions")
                }
                onKeyDown={onTreeKeyDown}
                onClickCapture={syncTreeActiveFromClick}
              >
                {!error && !loading && normalizedQuery ? (
                  searchResults.length > 0 ? (
                    <div className={styles.searchResults}>
                      {searchResults.map(({ session, workspace }) =>
                        renderSessionRow(
                          session,
                          `tree-search-${session.id}`,
                          workspace.label,
                        ),
                      )}
                    </div>
                  ) : null
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
                        <div
                          key={workspace.id}
                          data-workspace-id={workspace.id}
                          className={`${styles.workspaceGroup} ${activeTreeItemId === `tree-workspace-${workspace.id}` ? styles.treeActive : ""}`}
                          role="group"
                        >
                          <div
                            id={`tree-workspace-${workspace.id}`}
                            data-workspace-id={workspace.id}
                            className={`${styles.workspaceRow} ${activeTreeItemId === `tree-workspace-${workspace.id}` ? styles.treeActive : ""}`}
                            role="treeitem"
                            tabIndex={-1}
                            aria-label={workspace.label}
                            aria-expanded={expanded}
                          >
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
                                aria-label={t("New session in {value0}", {
                                  value0: String(workspace.label),
                                })}
                                title={t("New session in {value0}", {
                                  value0: String(workspace.label),
                                })}
                                onClick={() => onNewSession(workspace.id)}
                              >
                                <OctopusLogo size={16} />
                              </button>
                            ) : null}
                          </div>

                          {expanded ? (
                            <div className={styles.sessionRun} role="group">
                              {visibleSessions.map((session) =>
                                renderSessionRow(
                                  session,
                                  `tree-session-${session.id}`,
                                ),
                              )}
                              {orderedSessions.length === 0 ? (
                                <p className={styles.emptyWorkspace}>
                                  {workspace.sessionCatalogStatus === "loading"
                                    ? t("Loading sessions…")
                                    : workspace.sessionCatalogStatus === "error"
                                      ? (workspace.sessionCatalogError ??
                                        "Could not load sessions.")
                                      : workspace.sessionCatalogStatus ===
                                            "current-only" ||
                                          workspace.sessionCatalogStatus ===
                                            "known-only"
                                        ? t(
                                            "Start a session to open this workspace.",
                                          )
                                        : workspace.sessionCatalogStatus ===
                                            "unknown"
                                          ? t("Expand to load sessions.")
                                          : t("No sessions yet.")}
                                </p>
                              ) : null}
                              {orderedSessions.length > 0 &&
                              workspace.sessionCatalogStatus ===
                                "current-only" ? (
                                <p className={styles.emptyWorkspace}>
                                  {t("Only the open session is shown.")}
                                </p>
                              ) : null}
                              {hiddenCount > 0 ? (
                                <button
                                  type="button"
                                  className={styles.showMore}
                                  onClick={() => revealWorkspace(workspace.id)}
                                >
                                  {t("Show") + " "}
                                  {hiddenCount}
                                  {" " + t("more")}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  : null}

                {!normalizedQuery &&
                viewMode === "flat" &&
                workspaces.length > 0 &&
                flatSessions.length > 0 ? (
                  <div className={styles.flatSessionList} role="group">
                    {flatSessions.map(({ session }) =>
                      renderSessionRow(session, `tree-session-${session.id}`),
                    )}
                  </div>
                ) : null}
              </div>

              {!error && !loading && normalizedQuery ? (
                <>
                  {searchResults.length === 0 ? (
                    <div className={styles.emptyState}>
                      <p>
                        {t("No sessions match “{query}”.", {
                          query: query.trim(),
                        })}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          searchInput.current?.focus();
                        }}
                      >
                        {t("Clear search")}
                      </button>
                    </div>
                  ) : null}
                  <CatalogProgress
                    {...catalogProgress}
                    hasResults={searchResults.length > 0}
                    searching
                    onRetry={onRetry}
                  />
                </>
              ) : null}

              {!normalizedQuery &&
              viewMode === "flat" &&
              workspaces.length > 0 ? (
                flatSessions.length > 0 ? (
                  <CatalogProgress
                    {...catalogProgress}
                    hasResults
                    onRetry={onRetry}
                  />
                ) : catalogsIncomplete ? (
                  <CatalogProgress
                    {...catalogProgress}
                    hasResults={false}
                    onRetry={onRetry}
                  />
                ) : (
                  <p className={styles.emptyState}>{t("No sessions yet.")}</p>
                )
              ) : null}

              {!error &&
              !loading &&
              !normalizedQuery &&
              workspaces.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>{t("No workspaces yet.")}</p>
                  <button type="button" onClick={onAddWorkspace}>
                    {t("Add workspace")}
                  </button>
                </div>
              ) : null}
              <div className={styles.fade} aria-hidden="true" />
              {sessionMenu && treeBodyRef.current ? (
                <SessionActionsMenu
                  id={sessionMenuId}
                  anchor={sessionMenu.anchor}
                  container={treeBodyRef.current}
                  actions={
                    rowActions(
                      sessionsById.get(sessionMenu.sessionId) ?? {
                        id: sessionMenu.sessionId,
                        title: "",
                        blank: true,
                      },
                    ) ?? { rename: false, delete: null }
                  }
                  onRename={() =>
                    startRename(sessionMenu.sessionId, sessionMenu.anchor.id)
                  }
                  onDelete={() =>
                    startDelete(sessionMenu.sessionId, sessionMenu.anchor.id)
                  }
                  onClose={closeSessionMenu}
                />
              ) : null}
              {deleting ? (
                <DeleteSessionDialog
                  title={deleting.title}
                  deleting={deleting.busy}
                  error={deleting.error}
                  onCancel={cancelDelete}
                  onConfirm={() => void confirmDelete()}
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      <PeerDock
        manager={peerDock}
        roster={peerRoster}
        actionRoster={peerActionRoster}
        onApprovalRespond={onApprovalRespond}
        onRowAction={onPeerDockRowAction}
        {...(onPeerDockSelect ? { onSelect: onPeerDockSelect } : {})}
        collapsed={peerDockCollapsed}
        // PeerDock's `onToggle?` omits `| undefined` (exactOptionalPropertyTypes),
        // so thread it only when the shell actually supplies the fold control.
        {...(onPeerDockToggle ? { onToggle: onPeerDockToggle } : {})}
      />

      <div className={styles.footer}>
        {fleetEntry && onFleet ? (
          <>
            <button
              type="button"
              className={`${styles.settings} ${fleetActive ? styles.settingsActive : ""}`}
              aria-current={fleetActive ? "page" : undefined}
              aria-label={t(fleetEntry.label)}
              title={
                !fleetAvailable
                  ? t("Current server does not support Fleet yet")
                  : collapsed
                    ? t(fleetEntry.label)
                    : undefined
              }
              data-fleet-nav="entry"
              disabled={!fleetAvailable}
              onClick={fleetAvailable ? onFleet : undefined}
            >
              <span aria-hidden="true">{fleetEntry.icon}</span>
              {!collapsed ? <span>{t(fleetEntry.label)}</span> : null}
            </button>
            {!fleetAvailable && !collapsed ? (
              <small className={styles.fleetUnavailable}>
                {t("Current server does not support Fleet yet")}
              </small>
            ) : null}
          </>
        ) : null}
        {onThemeToggle ? (
          <button
            type="button"
            className={styles.settings}
            aria-label={t("Theme: {value0}", { value0: t(theme) })}
            title={
              collapsed ? t("Theme: {value0}", { value0: t(theme) }) : undefined
            }
            onClick={onThemeToggle}
          >
            <ThemeIcon mode={theme} />
            {!collapsed ? (
              <span>
                {theme === "dark"
                  ? t("Dark")
                  : theme === "light"
                    ? t("Light")
                    : t("System")}
              </span>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.settings} ${settingsActive ? styles.settingsActive : ""}`}
          aria-current={settingsActive ? "page" : undefined}
          aria-label={t("Settings")}
          title={collapsed ? t("Settings") : undefined}
          onClick={onSettings}
        >
          <SettingsIcon />
          {!collapsed ? <span>{t("Settings")}</span> : null}
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
  searching = false,
  onRetry,
}: {
  pending: number;
  failed: number;
  limited: number;
  hasResults: boolean;
  searching?: boolean;
  onRetry?: (() => void) | undefined;
}) {
  const t = useUiText();
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
            ? t("Showing sessions confirmed in this tab.")
            : searching
              ? t(
                  "Search includes sessions confirmed in this tab. The server cannot list older sessions.",
                )
              : t("Start a session to open a workspace.")
          : hasResults
            ? t("Results are incomplete.")
            : t("Sessions are still loading.")}
        {pending > 0
          ? " " +
            t("{value0} pending.", { value0: String(workspaceLabel(pending)) })
          : ""}
        {failed > 0
          ? " " +
            t("{value0} could not be loaded.", {
              value0: String(workspaceLabel(failed)),
            })
          : ""}
      </span>
      {failed > 0 && onRetry ? (
        <button type="button" onClick={onRetry}>
          {t("Retry")}
        </button>
      ) : null}
    </div>
  );
}

export function ProductSidebarViewOptionsMenu(
  props: ProductSidebarViewOptionsMenuProps,
) {
  const t = useUiText();
  const {
    viewMode,
    orderMode,
    onViewModeChange,
    onOrderModeChange,
    onSelectComplete,
  } = props;
  const selectViewMode = (next: ProductSidebarViewMode) => {
    onViewModeChange(next);
    onSelectComplete?.();
  };

  return (
    <>
      <div className={styles.viewOptionsLabel} role="presentation">
        {t("Group by")}
      </div>
      <div role="group" aria-label={t("Group sessions by")}>
        <button
          type="button"
          className={styles.viewOptionsItem}
          role="menuitemradio"
          aria-checked={viewMode === "grouped"}
          onClick={() => selectViewMode("grouped")}
        >
          <span>{t("Workspace")}</span>
          {viewMode === "grouped" ? <CheckIcon /> : null}
        </button>
        <button
          type="button"
          className={styles.viewOptionsItem}
          role="menuitemradio"
          aria-checked={viewMode === "flat"}
          onClick={() => selectViewMode("flat")}
        >
          <span>{t("In one list")}</span>
          {viewMode === "flat" ? <CheckIcon /> : null}
        </button>
      </div>
      <div className={styles.viewOptionsLabel} role="presentation">
        {t("Sort by")}
      </div>
      <div role="group" aria-label={t("Sort sessions by")}>
        {(["manual", "updated", "oldest"] as const).map((order) => (
          <button
            key={order}
            type="button"
            className={styles.viewOptionsItem}
            role="menuitemradio"
            aria-checked={orderMode === order}
            onClick={() => {
              onOrderModeChange(order);
              onSelectComplete?.();
            }}
          >
            <span>
              {order === "manual"
                ? t("Fixed order")
                : order === "updated"
                  ? t("Last opened")
                  : t("Least recently opened")}
            </span>
            {orderMode === order ? <CheckIcon /> : null}
          </button>
        ))}
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
      const difference = left.updatedAt - right.updatedAt;
      return (
        (orderMode === "oldest" ? difference : -difference) ||
        left.index - right.index
      );
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

/**
 * One session in the tree, in the list or as a search result (`meta` adds the
 * workspace line). Both truncate the same way: status and the start of the
 * title stay put and the full title is the tooltip. The row is a treeitem,
 * not a button, so it can hold the actions button and the rename field.
 */
function SessionRow({
  session,
  title,
  meta,
  selected,
  onSelect,
  id,
  active,
  actions,
  menuOpen,
  menuId,
  onMenu,
  rename,
}: {
  session: ProductSidebarSession;
  title: string;
  meta?: string;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  id: string;
  active?: boolean;
  actions: SessionRowActions | null;
  menuOpen: boolean;
  menuId: string;
  onMenu: (
    sessionId: string,
    anchor: HTMLElement,
    trigger: HTMLElement | null,
  ) => void;
  rename: ReactNode;
}) {
  const t = useUiText();
  const rowRef = useRef<HTMLDivElement>(null);
  const label = session.blank ? t("New session") : title;
  const status = session.opening ? "running" : (session.status ?? "idle");
  const statusLabel = session.opening
    ? t("Opening conversation")
    : session.statusLabel && t(session.statusLabel);
  const showStatus = status !== "idle";
  // "now" reads as a word; "5m"/"2h" stay compact in every language.
  const updated = session.updatedLabel && t(session.updatedLabel);
  const time = session.opening
    ? t("Opening…")
    : !session.blank && updated
      ? updated
      : "";
  const search = meta !== undefined;
  const className = [
    search ? styles.searchResultRow : styles.sessionRow,
    selected ? styles.selected : "",
    active ? styles.treeActive : "",
    actions ? styles.hasActions : "",
    menuOpen ? styles.menuOpen : "",
    rename ? styles.renaming : "",
  ]
    .filter(Boolean)
    .join(" ");

  const statusSlot = (
    <span className={styles.statusSlot}>
      {showStatus ? <StatusDot status={status} label={statusLabel} /> : null}
    </span>
  );
  const titleText = rename ?? (
    <span
      className={search ? styles.searchResultTitle : styles.sessionTitle}
      title={label}
    >
      {label}
    </span>
  );
  const menuButton =
    actions && !rename ? (
      <button
        type="button"
        className={styles.rowMenuButton}
        aria-label={t("More actions for {title}", { title: label })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        // One Tab stop: only the open or keyboard-active row's button.
        tabIndex={selected || active ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation();
          if (rowRef.current)
            onMenu(session.id, rowRef.current, event.currentTarget);
        }}
      >
        <MoreIcon />
      </button>
    ) : null;

  return (
    <div
      ref={rowRef}
      id={id}
      data-session-id={session.id}
      className={className}
      role="treeitem"
      tabIndex={-1}
      aria-current={selected ? "page" : undefined}
      aria-selected={selected}
      aria-busy={session.opening || undefined}
      // WCAG 2.5.3 (axe label-content-name-mismatch): the accessible name
      // must contain the row's visible text, and axe compares it as the
      // whitespace-free concatenation of the row's text nodes ("Completed"
      // + title + time). Build the name from the same strings so it matches
      // that concatenation exactly. Search rows are named by their content.
      aria-label={
        search
          ? undefined
          : [showStatus ? statusLabel : "", label, time].join("")
      }
      onClick={() => {
        if (!rename) onSelect(session.id);
      }}
      onContextMenu={
        actions && !rename
          ? (event) => {
              event.preventDefault();
              if (rowRef.current) onMenu(session.id, rowRef.current, null);
            }
          : undefined
      }
    >
      {search ? (
        <>
          <span className={styles.searchResultHeading}>
            {statusSlot}
            {titleText}
            {menuButton}
          </span>
          <span className={styles.searchResultMeta}>
            {session.opening ? t("Opening…") : meta}
          </span>
        </>
      ) : (
        <>
          {statusSlot}
          {titleText}
          {!rename && time ? (
            <span className={styles.sessionTime}>{time}</span>
          ) : null}
          {menuButton}
        </>
      )}
    </div>
  );
}

function StatusDot({
  status,
  label,
}: {
  status: ProductSessionStatus;
  label?: string | undefined;
}) {
  const t = useUiText();
  const accessibleLabel = label ?? t(defaultStatusLabel(status));
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
    case "attention":
      return "Completed with failed steps";
    case "failed":
      return "Failed";
  }
}

function LoadingRows() {
  const t = useUiText();
  return (
    <div className={styles.loadingState} aria-label={t("Loading workspaces")}>
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

function PanelIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9 4v16" />
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

function MoreIcon() {
  return (
    <SvgIcon>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
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
