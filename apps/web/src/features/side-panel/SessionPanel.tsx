import {
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CloseButton } from "../../ui/CloseButton.tsx";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  clampPanelWidth,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  SESSION_PANEL_TABS,
  type SessionPanelTab,
} from "./panel-layout.ts";
import styles from "./SessionPanel.module.css";

const TAB_LABELS: Record<SessionPanelTab, string> = {
  overview: "Overview",
  files: "Files",
  changes: "Changes",
  outputs: "Outputs",
};

const RESIZE_STEP = 16;

export interface SessionPanelProps {
  /** A column beside the conversation, or a drawer over it on phones. */
  presentation: "column" | "drawer";
  tab: SessionPanelTab;
  width: number;
  /** How wide the panel's container is, so a drag never squeezes the conversation shut. */
  availableWidth: () => number;
  /** A count shown after a tab's name, when it has one. */
  counts: Partial<Record<SessionPanelTab, number>>;
  onTabChange: (tab: SessionPanelTab) => void;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Overview, Files, Changes and Outputs for the open Session, beside the
 * conversation. Only the selected tab renders; the others cost nothing.
 */
export function SessionPanel(props: SessionPanelProps) {
  const t = useUiText();
  const headingId = useId();
  const tabIds = useId();
  const tabRefs = useRef(new Map<SessionPanelTab, HTMLButtonElement>());
  const drag = useRef<{ x: number; width: number } | null>(null);

  const select = (tab: SessionPanelTab, focus = false) => {
    props.onTabChange(tab);
    if (focus) tabRefs.current.get(tab)?.focus();
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = SESSION_PANEL_TABS.indexOf(props.tab);
    const last = SESSION_PANEL_TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(SESSION_PANEL_TABS[next]!, true);
  };

  const resize = (width: number) =>
    props.onWidthChange(clampPanelWidth(width, props.availableWidth()));

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The handle sits on the panel's left edge: moving it left widens the panel.
    const width =
      event.key === "ArrowLeft"
        ? props.width + RESIZE_STEP
        : event.key === "ArrowRight"
          ? props.width - RESIZE_STEP
          : event.key === "Home"
            ? PANEL_MIN_WIDTH
            : event.key === "End"
              ? PANEL_MAX_WIDTH
              : null;
    if (width === null) return;
    event.preventDefault();
    resize(width);
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: props.width };
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    resize(drag.current.width + drag.current.x - event.clientX);
  };

  const endResize = () => {
    drag.current = null;
  };

  const body = (
    <>
      <header className={styles.header}>
        <h2 id={headingId} className="sr-only">
          {t("Session panel")}
        </h2>
        <div className={styles.tabs} role="tablist" aria-labelledby={headingId}>
          {SESSION_PANEL_TABS.map((tab) => {
            const selected = tab === props.tab;
            const count = props.counts[tab];
            return (
              <button
                key={tab}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab, element);
                  else tabRefs.current.delete(tab);
                }}
                id={`${tabIds}-${tab}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tabIds}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab)}
                onKeyDown={onTabKeyDown}
              >
                {t(TAB_LABELS[tab])}
                {count ? (
                  <span className={styles.count}>
                    <span className="sr-only">, </span>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <CloseButton label={t("Close session panel")} onClick={props.onClose} />
      </header>
      <div
        id={`${tabIds}-panel`}
        className={styles.body}
        role="tabpanel"
        aria-labelledby={`${tabIds}-${props.tab}`}
        tabIndex={0}
      >
        {props.children}
      </div>
    </>
  );

  if (props.presentation === "drawer") {
    return (
      <ModalSurface
        backdropClassName={styles.backdrop!}
        dialogClassName={styles.drawer!}
        labelledBy={headingId}
        closeOnBackdrop
        onEscape={props.onClose}
      >
        {body}
      </ModalSurface>
    );
  }

  return (
    <aside
      className={`${styles.column} ${props.className ?? ""}`}
      aria-labelledby={headingId}
    >
      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize session panel")}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={props.width}
        tabIndex={0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => resize(PANEL_DEFAULT_WIDTH)}
      />
      {body}
    </aside>
  );
}
