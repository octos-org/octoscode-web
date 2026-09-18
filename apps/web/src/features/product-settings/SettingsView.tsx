import { lazy, Suspense } from "react";
import { SkeletonRows } from "../../ui/Skeleton.tsx";
import type { AttentionSettings } from "../attention/desktop-notifications.ts";
import { SettingsDialog } from "../product-controls/SettingsDialog.tsx";
import type {
  ModelSelection,
  SettingsSectionId,
} from "../product-controls/types.ts";
import type { OctosSessionRuntime } from "../session/use-octos-session.ts";
import {
  findModel,
  modelControlState,
  modelGroups,
  selectedModel,
} from "../shell/model-projection.ts";
import { workspaceName } from "../workspace/workspace-recents.ts";

const GeneralSettingsContent = lazy(async () => ({
  default: (await import("./GeneralSettingsContent.tsx"))
    .GeneralSettingsContent,
}));
const ModelsSettingsContent = lazy(async () => ({
  default: (await import("./ModelsSettingsContent.tsx")).ModelsSettingsContent,
}));
const ModelManagementSettings = lazy(async () => ({
  default: (await import("./ModelManagementSettings.tsx"))
    .ModelManagementSettings,
}));

interface SettingsViewProps {
  attentionSettings?: AttentionSettings;
  session: OctosSessionRuntime["connection"];
  models: OctosSessionRuntime["models"];
  activeSection: SettingsSectionId;
  serverOrigin: string;
  workspacePath: string | null;
  locked: boolean;
  modelChangesLocked: boolean;
  runtimeModelLabel: string | null;
  restartPending: boolean;
  onDisconnect: () => void;
  onForgetConnection: () => void;
  /** The server offers `server/shutdown` (local `octos serve --solo`). */
  canStopServer?: boolean;
  onStopServer?: () => Promise<void>;
  onModelsChanged: () => Promise<void>;
  onSectionChange: (section: SettingsSectionId) => void;
  onClose: () => void;
}

/** Settings composition loads only when opened; session state stays in App. */
export function SettingsView({
  attentionSettings,
  session,
  models,
  activeSection,
  serverOrigin,
  workspacePath,
  locked,
  modelChangesLocked,
  runtimeModelLabel,
  restartPending,
  onDisconnect,
  onForgetConnection,
  canStopServer = false,
  onStopServer,
  onModelsChanged,
  onSectionChange,
  onClose,
}: SettingsViewProps) {
  const projectedModelGroups = modelGroups(models.state.models);
  const currentProfileModel = selectedModel(models.state.models);
  const showModelsSettings = Boolean(
    session.opened && (models.state.available || models.management.available),
  );
  const selectModel = async (selection: ModelSelection) => {
    const target = findModel(models.state.models, selection);
    if (!target) return;
    await models.select(target);
    await onModelsChanged();
  };
  const loading = (
    <div role="status">
      <SkeletonRows rows={6} />
      <span className="sr-only">Loading settings…</span>
    </div>
  );
  return (
    <SettingsDialog
      open
      activeSection={activeSection}
      labels={SETTINGS_LABELS}
      slots={{
        general: (
          <Suspense fallback={loading}>
            <GeneralSettingsContent
              {...(session.opened?.active_profile_id &&
              session.opened.workspace_root
                ? {
                    sessionReference: {
                      workspaceRoot: session.opened.workspace_root,
                      profileId: session.opened.active_profile_id,
                      sessionId: session.opened.session_id,
                    },
                  }
                : {})}
              {...(attentionSettings ? { attentionSettings } : {})}
              serverOrigin={serverOrigin}
              connectionStatus={session.status}
              workspaceLabel={
                workspacePath ? workspaceName(workspacePath) : null
              }
              workspacePath={workspacePath || null}
              displayProfile={session.opened?.active_profile_id ?? null}
              locked={locked}
              onDisconnect={onDisconnect}
              onForgetConnection={onForgetConnection}
              canStopServer={canStopServer}
              {...(onStopServer ? { onStopServer } : {})}
              onCopyDiagnostics={() => {
                // Redacted by construction: origin only (never the
                // token, never the WS query string), plus state the
                // settings screen already displays.
                const snapshot = {
                  generated_at: new Date().toISOString(),
                  user_agent: navigator.userAgent,
                  connection: {
                    endpoint: serverOrigin,
                    status: session.status,
                    error: session.error ?? null,
                    recovery: session.recovery,
                  },
                  // Runtime lifecycle ring — newest-last entries of
                  // {at, kind, detail?}: method names and recovery
                  // phases only, never task output or params.
                  diagnostics: session.diagnostics,
                  session: session.opened
                    ? {
                        session_id: session.opened.session_id,
                        active_profile_id:
                          session.opened.active_profile_id ?? null,
                        capabilities: session.opened.capabilities ?? null,
                      }
                    : null,
                };
                return navigator.clipboard.writeText(
                  JSON.stringify(snapshot, null, 2),
                );
              }}
            />
          </Suspense>
        ),
        ...(showModelsSettings
          ? {
              models: (
                <Suspense fallback={loading}>
                  {models.state.available ? (
                    <ModelsSettingsContent
                      state={modelControlState(models.state)}
                      groups={projectedModelGroups}
                      selected={currentProfileModel}
                      runtimeModel={runtimeModelLabel}
                      restartRequired={restartPending}
                      selectionEnabled={models.state.editable}
                      locked={modelChangesLocked || models.state.busy}
                      onRefresh={() => void models.refresh()}
                      onSelect={(selection) => void selectModel(selection)}
                    />
                  ) : null}
                  <ModelManagementSettings
                    key={models.management.authorityKey}
                    client={models.management.client}
                    profileId={models.management.profileId}
                    capabilities={models.management.capabilities}
                    profileDefaultKey={`${currentProfileModel?.providerId ?? ""}:${currentProfileModel?.modelId ?? ""}`}
                    locked={modelChangesLocked}
                    onConfiguredModelsChange={models.refresh}
                  />
                </Suspense>
              ),
            }
          : {}),
      }}
      onSectionChange={onSectionChange}
      onClose={onClose}
    />
  );
}

const SETTINGS_LABELS = {
  title: "Settings",
  navigation: "Settings sections",
  general: "General",
  models: "Models",
  close: "Close settings",
} as const;
