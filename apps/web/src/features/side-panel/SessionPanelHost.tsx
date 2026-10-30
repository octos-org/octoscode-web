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
import type { SessionFileChange } from "./session-changes.ts";

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
  browse: WorkspaceBrowseAdapter | null;
  changes: readonly SessionFileChange[];
  diffReview: DiffReviewRuntimeState;
  onOpenPreview: (previewId: string) => void;
  onRefreshChanges: () => void;
  onChangesScope: (scope: "turn" | "workspace") => void;
  /** Opens a changed file's diff in the Changes tab. */
  onOpenChange: (change: SessionFileChange) => void;

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
  const showingChanges = props.tab === "changes";
  const loaded = props.diffReview.active;
  const refreshRef = useRef(props.onRefreshChanges);
  refreshRef.current = props.onRefreshChanges;
  useEffect(() => {
    // The Changes tab loads its snapshot when first shown; Refresh reloads it.
    if (showingChanges && !loaded) refreshRef.current();
  }, [showingChanges, loaded]);

  const written = props.changes.filter(
    (change) => change.operation === "create" || change.operation === "write",
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
          browse={props.browse}
          changes={props.changes}
          onOpenChange={props.onOpenChange}
        />
      ) : props.tab === "changes" ? (
        <ChangesView
          state={props.diffReview}
          changes={props.changes}
          onOpenPreview={props.onOpenPreview}
          onRefresh={props.onRefreshChanges}
          onScopeChange={props.onChangesScope}
        />
      ) : (
        <OutputsTab
          changes={props.changes}
          delivered={props.delivered}
          access={props.access}
          tasks={props.tasks}
          onOpenChange={props.onOpenChange}
          onOpenTask={props.onOpenTask}
        />
      )}
    </SessionPanel>
  );
}
