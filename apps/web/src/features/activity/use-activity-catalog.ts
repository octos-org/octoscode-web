import { useEffect, useMemo, useState } from "react";
import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  EMPTY_WORKSPACE_PRODUCT,
  type WorkspaceProductState,
} from "../workspace/model.ts";
import { readActivityCatalog } from "./catalog.ts";

export function useActivityCatalog({
  open,
  client,
  authorityKey,
  sessionIds,
  sessionLabels,
  capabilities,
}: {
  open: boolean;
  client: OctosUiClient | null;
  authorityKey: string;
  sessionIds: readonly string[];
  sessionLabels: Readonly<Record<string, string>>;
  capabilities: UiProtocolCapabilities | undefined;
}) {
  const [state, setState] = useState<WorkspaceProductState>(
    EMPTY_WORKSPACE_PRODUCT,
  );
  const serializedIds = JSON.stringify([...new Set(sessionIds)].sort());
  const ids = useMemo(
    () => JSON.parse(serializedIds) as string[],
    [serializedIds],
  );
  const available = supportsMethod(capabilities, CORE_UI_METHODS.TASK_LIST);
  const serializedLabels = JSON.stringify(sessionLabels);
  const labels = useMemo(
    () => JSON.parse(serializedLabels) as Record<string, string>,
    [serializedLabels],
  );
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ ...EMPTY_WORKSPACE_PRODUCT, activityAvailable: available });
    if (!open || !client || !available)
      return () => {
        current = false;
      };
    const refresh = async () => {
      if (!current) return;
      setState((previous) => ({ ...previous, activityLoading: true }));
      const catalog = await readActivityCatalog(client, ids);
      if (!current) return;
      setState({
        ...EMPTY_WORKSPACE_PRODUCT,
        activityAvailable: true,
        activityLoading: false,
        activityTasksBySession: catalog.tasksBySession,
        activitySessionLabels: labels,
        activityUpdatedAt: Date.now(),
        error: catalog.unavailableSessions.length
          ? `${catalog.unavailableSessions.length} Session task snapshots unavailable`
          : null,
      });
      timer = setTimeout(() => void refresh(), 10000);
    };
    void refresh();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, client, authorityKey, ids, available, labels]);
  return state;
}
