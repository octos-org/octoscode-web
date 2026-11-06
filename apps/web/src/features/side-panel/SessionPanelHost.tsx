import { useEffect, useRef } from "react";
import type {
  PlanUpdated,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { ChangesView } from "../review/ChangesView.tsx";
import type { DiffReviewRuntimeState } from "../review/use-coding-safety.ts";
import type { SupervisedTask } from "../supervision/model.ts";
import type { AttachmentAccess } from "../timeline/attachment-access.ts";
import type { WorkspaceBrowseAdapter } from "../workspace-create/workspace-browse.ts";
import type { AutonomyClient } from "../autonomy/binding.ts";
import { AutomationTab } from "./AutomationTab.tsx";
import { FilesTab } from "./FilesTab.tsx";
import { OutputsTab } from "./OutputsTab.tsx";
import { OverviewTab } from "./OverviewTab.tsx";
import type { SessionPanelTab } from "./panel-layout.ts";
import { SessionPanel } from "./SessionPanel.tsx";
import {
  workspaceRelativePath,
  type SessionFileChange,
} from "./session-changes.ts";
import { resolvePanelFile } from "./panel-selection.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./SessionPanelTabs.module.css";

export interface SessionPanelHostProps {
  presentation: "column" | "drawer";
  tab: SessionPanelTab;
  width: number;
  availableWidth: () => number;
  onTabChange: (tab: SessionPanelTab) => void;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  className?: string | undefined;

  workspaceRoot: string;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  browse: WorkspaceBrowseAdapter | null;
  changes: readonly SessionFileChange[];
  /** This tab undid the Session's latest turn (and has not redone it). */
  changesUndone?: boolean;
  diffReview: DiffReviewRuntimeState;
  onOpenPreview: (previewId: string) => void;
  onRefreshChanges: () => void;
  onChangesScope: (scope: "turn" | "workspace") => void;

  planAvailable: boolean;
  plan: PlanUpdated | null;
  finishedPlan: PlanUpdated | null;
  taskListAvailable: boolean;
  tasks: readonly SupervisedTask[];
  onOpenTask?: ((taskId: string) => void) | undefined;

  delivered: readonly string[];
  access: AttachmentAccess | null;
  automation: {
    client: AutonomyClient;
    sessionId: string;
    capabilities: UiProtocolCapabilities;
    authorityKey: string;
  } | null;
}

/** The session panel with its tabs wired to the open Session's state. */
export function SessionPanelHost(props: SessionPanelHostProps) {
  const t = useUiText();
  const selected = resolvePanelFile(
    props.selectedPath,
    props.workspaceRoot,
    props.changes,
    props.delivered,
  );
  const selectedPreviewId = selected.change?.previewId ?? null;
  const showingChanges = props.tab === "changes";
  const loaded = props.diffReview.active;
  const requestedPreview = useRef<string | null>(null);
  const refreshRef = useRef(props.onRefreshChanges);
  const openRef = useRef(props.onOpenPreview);
  refreshRef.current = props.onRefreshChanges;
  openRef.current = props.onOpenPreview;
  useEffect(() => {
    if (
      !showingChanges ||
      props.diffReview.loading ||
      (props.selectedPath && !selectedPreviewId)
    )
      return;
    if (
      !loaded ||
      (selectedPreviewId &&
        props.diffReview.scope === "turn" &&
        selectedPreviewId !== props.diffReview.result?.preview.preview_id &&
        selectedPreviewId !== requestedPreview.current)
    ) {
      requestedPreview.current = selectedPreviewId;
      if (selectedPreviewId) openRef.current(selectedPreviewId);
      else refreshRef.current();
    }
  }, [
    showingChanges,
    loaded,
    props.selectedPath,
    selectedPreviewId,
    props.diffReview.scope,
    props.diffReview.loading,
    props.diffReview.result,
  ]);

  const openChange = (change: SessionFileChange) => {
    props.onSelectPath(change.path);
    props.onTabChange("changes");
    if (change.previewId) {
      requestedPreview.current = change.previewId;
      props.onOpenPreview(change.previewId);
    }
  };
  const refresh = () => {
    if (props.diffReview.scope === "turn" && selectedPreviewId)
      props.onOpenPreview(selectedPreviewId);
    else props.onRefreshChanges();
  };
  const missing = props.selectedPath !== null && !selected.found;

  const written = props.changes.filter(
    (change) => change.operation !== "delete",
  ).length;
  const outputs =
    written +
    props.delivered.length +
    props.tasks.filter((task) => task.outputFiles.length).length;

  return (
    <SessionPanel
      presentation={props.presentation}
      tab={props.tab}
      width={props.width}
      availableWidth={props.availableWidth}
      counts={{ changes: props.changes.length, outputs }}
      automationAvailable={props.automation !== null}
      onTabChange={props.onTabChange}
      onWidthChange={props.onWidthChange}
      onClose={props.onClose}
      className={props.className}
    >
      {props.selectedPath ? (
        <div
          className={styles.selection}
          role="group"
          aria-label={t("Selected file")}
        >
          <strong>{props.selectedPath}</strong>
          <div className={styles.selectionActions}>
            <button
              type="button"
              className={styles.action}
              disabled={!selectedPreviewId || !props.diffReview.available}
              onClick={() => {
                if (selected.change) openChange(selected.change);
              }}
            >
              {t("View changes")}
            </button>
            {props.tab !== "outputs" ? (
              <button
                type="button"
                className={styles.action}
                disabled={!selected.found}
                onClick={() => props.onTabChange("outputs")}
              >
                {t("Preview file")}
              </button>
            ) : null}
            {props.tab !== "outputs" ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => props.onSelectPath(null)}
              >
                {t("Clear selection")}
              </button>
            ) : null}
          </div>
          {missing ? (
            <p className={styles.note} role="status">
              {t(
                "This file is no longer in the session's retained files. Select another file.",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {props.tab === "automation" && props.automation ? (
        <AutomationTab
          client={props.automation.client}
          sessionId={props.automation.sessionId}
          capabilities={props.automation.capabilities}
          authorityKey={props.automation.authorityKey}
        />
      ) : props.tab === "overview" ? (
        <OverviewTab
          planAvailable={props.planAvailable}
          plan={props.plan}
          finishedPlan={props.finishedPlan}
          taskListAvailable={props.taskListAvailable}
          tasks={props.tasks}
          onOpenTask={props.onOpenTask}
        />
      ) : props.tab === "files" ? (
        <FilesTab
          root={props.workspaceRoot}
          selectedPath={props.selectedPath}
          browse={props.browse}
          changes={props.changes}
          onOpenChange={openChange}
        />
      ) : props.tab === "changes" ? (
        <ChangesView
          state={
            props.selectedPath &&
            !selectedPreviewId &&
            props.diffReview.scope === "turn"
              ? {
                  ...props.diffReview,
                  result: null,
                  error: null,
                  loading: false,
                }
              : props.diffReview
          }
          selectedPath={props.selectedPath}
          changes={props.changes}
          undone={props.changesUndone ?? false}
          onOpenChange={openChange}
          onRefresh={refresh}
          onScopeChange={props.onChangesScope}
        />
      ) : (
        <OutputsTab
          changes={props.changes}
          delivered={props.delivered}
          access={props.access}
          tasks={props.tasks}
          selectedPath={props.selectedPath}
          selected={selected}
          onSelectPath={props.onSelectPath}
          onOpenDelivered={(reference) =>
            props.onSelectPath(
              workspaceRelativePath(reference, props.workspaceRoot),
            )
          }
          onOpenTask={props.onOpenTask}
        />
      )}
    </SessionPanel>
  );
}
