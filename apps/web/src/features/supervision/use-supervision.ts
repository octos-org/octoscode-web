import { useRef, useState } from "react";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  parsePlanUpdated,
  parseTaskOutputDelta,
  parseTaskUpdated,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type RpcNotification,
  type TaskArtifactRecord,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  appendTaskArtifactPage,
  appendTaskOutputDelta,
  applyTaskUpdated,
  EMPTY_SUPERVISION,
  EMPTY_TASK_DETAIL,
  taskIsCancellable,
  tasksFromList,
  type SupervisionRuntimeState,
} from "./model.ts";
import { RequestGate } from "../async/request-gate.ts";

interface SupervisionDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
}

export interface SupervisionController {
  state: SupervisionRuntimeState;
  reset: () => void;
  configureCapabilities: (
    capabilities: UiProtocolCapabilities | undefined,
  ) => void;
  refresh: (client?: OctosUiClient | null) => Promise<void>;
  openTaskDetail: (taskId: string) => Promise<void>;
  closeTaskDetail: () => void;
  loadMoreTaskOutput: () => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  readTaskArtifact: (artifact: TaskArtifactRecord) => Promise<void>;
  loadMoreTaskArtifact: () => Promise<void>;
  observeNotification: (notification: RpcNotification) => void;
}

/** Owns task/status/artifact state outside the session transport lifecycle. */
export function useSupervision(
  dependencies: SupervisionDependencies,
): SupervisionController {
  const detailRequestsRef = useRef(new RequestGate());
  const refreshRequestsRef = useRef(new RequestGate());
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const [state, setState] =
    useState<SupervisionRuntimeState>(EMPTY_SUPERVISION);

  const reset = () => {
    detailRequestsRef.current.invalidate();
    refreshRequestsRef.current.invalidate();
    setState(EMPTY_SUPERVISION);
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    setState((current) => ({
      ...current,
      planAvailable: supportsFeature(
        capabilities,
        CORE_UI_FEATURES.PLAN_TODOS_V1,
      ),
      taskListAvailable: supportsMethod(
        capabilities,
        CORE_UI_METHODS.TASK_LIST,
      ),
      taskOutputAvailable: supportsMethod(
        capabilities,
        CORE_UI_METHODS.TASK_OUTPUT_READ,
      ),
      cancelAvailable: supportsMethod(
        capabilities,
        CORE_UI_METHODS.TASK_CANCEL,
      ),
      artifactsAvailable:
        supportsFeature(
          capabilities,
          CORE_UI_FEATURES.HARNESS_TASK_ARTIFACTS_V1,
        ) &&
        supportsMethod(capabilities, CORE_UI_METHODS.TASK_ARTIFACT_LIST) &&
        supportsMethod(capabilities, CORE_UI_METHODS.TASK_ARTIFACT_READ),
      statusAvailable: supportsMethod(
        capabilities,
        CORE_UI_METHODS.SESSION_STATUS_READ,
      ),
    }));
  };

  const refresh = async (
    requestedClient = dependenciesRef.current.client(),
  ) => {
    const currentDependencies = dependenciesRef.current;
    const sessionId = currentDependencies.sessionId();
    if (!requestedClient || !sessionId) return;
    const canList = supportsMethod(
      currentDependencies.capabilities(),
      CORE_UI_METHODS.TASK_LIST,
    );
    const canReadStatus = supportsMethod(
      currentDependencies.capabilities(),
      CORE_UI_METHODS.SESSION_STATUS_READ,
    );
    if (!canList && !canReadStatus) return;
    const request = refreshRequestsRef.current.begin();
    setState((current) => ({ ...current, loading: true, error: null }));
    const [tasks, runtimeStatus] = await Promise.allSettled([
      canList
        ? requestedClient.listTasks({ session_id: sessionId })
        : Promise.resolve(null),
      canReadStatus
        ? requestedClient.readSessionStatus(sessionId)
        : Promise.resolve(null),
    ]);
    if (
      dependenciesRef.current.client() !== requestedClient ||
      !refreshRequestsRef.current.isCurrent(request) ||
      dependenciesRef.current.sessionId() !== sessionId
    ) {
      return;
    }
    const errors: string[] = [];
    if (tasks.status === "rejected") errors.push(errorMessage(tasks.reason));
    if (runtimeStatus.status === "rejected") {
      errors.push(errorMessage(runtimeStatus.reason));
    }
    const taskResult = tasks.status === "fulfilled" ? tasks.value : null;
    const statusResult =
      runtimeStatus.status === "fulfilled" ? runtimeStatus.value : null;
    if (taskResult && taskResult.session_id !== sessionId) {
      errors.push("task/list returned another session");
    }
    if (statusResult && statusResult.session_id !== sessionId) {
      errors.push("session/status/read returned another session");
    }
    setState((current) => ({
      ...current,
      loading: false,
      error: errors.length ? errors.join(" · ") : null,
      ...(taskResult?.session_id === sessionId
        ? { tasks: tasksFromList(taskResult.tasks) }
        : {}),
      ...(statusResult?.session_id === sessionId
        ? { runtimeStatus: statusResult }
        : {}),
    }));
  };

  const openTaskDetail = async (taskId: string) => {
    const client = dependenciesRef.current.client();
    const sessionId = dependenciesRef.current.sessionId();
    if (
      !client ||
      !sessionId ||
      !state.taskListAvailable ||
      (!state.taskOutputAvailable && !state.artifactsAvailable) ||
      !state.tasks.some((task) => task.id === taskId)
    ) {
      return;
    }
    const request = detailRequestsRef.current.begin();
    setState((current) => ({
      ...current,
      detail: { ...EMPTY_TASK_DETAIL, active: true, taskId, loading: true },
    }));
    const [output, artifacts] = await Promise.allSettled([
      state.taskOutputAvailable
        ? client.readTaskOutput({
            session_id: sessionId,
            task_id: taskId,
            limit_bytes: 131_072,
          })
        : Promise.resolve(null),
      state.artifactsAvailable
        ? client.listTaskArtifacts({ session_id: sessionId, task_id: taskId })
        : Promise.resolve(null),
    ]);
    if (
      dependenciesRef.current.client() !== client ||
      !detailRequestsRef.current.isCurrent(request) ||
      dependenciesRef.current.sessionId() !== sessionId
    ) {
      return;
    }
    const errors: string[] = [];
    if (output.status === "rejected") errors.push(errorMessage(output.reason));
    if (artifacts.status === "rejected") {
      errors.push(errorMessage(artifacts.reason));
    }
    const outputResult = output.status === "fulfilled" ? output.value : null;
    const artifactResult =
      artifacts.status === "fulfilled" ? artifacts.value : null;
    if (
      outputResult &&
      (outputResult.session_id !== sessionId || outputResult.task_id !== taskId)
    ) {
      errors.push("task/output/read returned a mismatched task");
    }
    if (
      artifactResult &&
      (artifactResult.session_id !== sessionId ||
        artifactResult.task_id !== taskId)
    ) {
      errors.push("task/artifact/list returned a mismatched task");
    }
    setState((current) => ({
      ...current,
      detail: {
        ...current.detail,
        loading: false,
        output:
          outputResult?.session_id === sessionId &&
          outputResult.task_id === taskId
            ? outputResult
            : null,
        text:
          outputResult?.session_id === sessionId &&
          outputResult.task_id === taskId
            ? outputResult.text
            : "",
        artifacts:
          artifactResult?.session_id === sessionId &&
          artifactResult.task_id === taskId
            ? artifactResult
            : null,
        error: errors.length ? errors.join(" · ") : null,
      },
    }));
  };

  const closeTaskDetail = () => {
    detailRequestsRef.current.invalidate();
    setState((current) => ({ ...current, detail: EMPTY_TASK_DETAIL }));
  };

  const loadMoreTaskOutput = async () => {
    const client = dependenciesRef.current.client();
    const sessionId = dependenciesRef.current.sessionId();
    const detail = state.detail;
    if (
      !client ||
      !sessionId ||
      !detail.taskId ||
      !detail.output ||
      detail.output.complete ||
      detail.loadingMore
    ) {
      return;
    }
    const taskId = detail.taskId;
    setState((current) => ({
      ...current,
      detail: { ...current.detail, loadingMore: true, error: null },
    }));
    try {
      const result = await client.readTaskOutput({
        session_id: sessionId,
        task_id: taskId,
        cursor: detail.output.next_cursor,
        limit_bytes: 131_072,
      });
      if (
        dependenciesRef.current.client() !== client ||
        dependenciesRef.current.sessionId() !== sessionId ||
        result.session_id !== sessionId ||
        result.task_id !== taskId
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          loadingMore: false,
          output: result,
          text: `${current.detail.text}${result.text}`,
        },
      }));
    } catch (reason) {
      if (dependenciesRef.current.client() !== client) return;
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          loadingMore: false,
          error: errorMessage(reason),
        },
      }));
    }
  };

  const cancelTask = async (taskId: string) => {
    const client = dependenciesRef.current.client();
    const sessionId = dependenciesRef.current.sessionId();
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (
      !client ||
      !sessionId ||
      !state.cancelAvailable ||
      !task ||
      !taskIsCancellable(task)
    ) {
      return;
    }
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === taskId
          ? { ...item, state: "cancelling", status: "cancelling" }
          : item,
      ),
    }));
    try {
      const result = await client.cancelTask({
        task_id: taskId,
        session_id: sessionId,
      });
      if (
        dependenciesRef.current.client() !== client ||
        result.task_id !== taskId
      )
        return;
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === taskId
            ? { ...item, state: result.status, status: result.status }
            : item,
        ),
      }));
    } catch (reason) {
      if (dependenciesRef.current.client() !== client) return;
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === taskId && item.state === "cancelling" ? task : item,
        ),
        error: errorMessage(reason),
      }));
    }
  };

  const readTaskArtifact = async (artifact: TaskArtifactRecord) => {
    const client = dependenciesRef.current.client();
    const sessionId = dependenciesRef.current.sessionId();
    const taskId = state.detail.taskId;
    if (!client || !sessionId || !taskId || !state.artifactsAvailable) return;
    if (artifact.content !== undefined) {
      const content = artifact.content;
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          selectedArtifact: {
            session_id: sessionId,
            task_id: taskId,
            artifact,
            content,
            has_more: false,
          },
        },
      }));
      return;
    }
    setState((current) => ({
      ...current,
      detail: { ...current.detail, artifactLoading: true, error: null },
    }));
    try {
      const result = await client.readTaskArtifact({
        session_id: sessionId,
        task_id: taskId,
        artifact_id: artifact.id,
        limit_bytes: 262_144,
      });
      if (
        dependenciesRef.current.client() !== client ||
        result.session_id !== sessionId ||
        result.task_id !== taskId
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          artifactLoading: false,
          selectedArtifact: result,
        },
      }));
    } catch (reason) {
      if (dependenciesRef.current.client() !== client) return;
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          artifactLoading: false,
          error: errorMessage(reason),
        },
      }));
    }
  };

  const loadMoreTaskArtifact = async () => {
    const client = dependenciesRef.current.client();
    const sessionId = dependenciesRef.current.sessionId();
    const taskId = state.detail.taskId;
    const selected = state.detail.selectedArtifact;
    if (
      !client ||
      !sessionId ||
      !taskId ||
      !selected?.has_more ||
      !selected.next_cursor ||
      state.detail.artifactLoading
    ) {
      return;
    }
    setState((current) => ({
      ...current,
      detail: { ...current.detail, artifactLoading: true, error: null },
    }));
    try {
      const result = await client.readTaskArtifact({
        session_id: sessionId,
        task_id: taskId,
        artifact_id: selected.artifact.id,
        cursor: selected.next_cursor,
        limit_bytes: 262_144,
      });
      if (
        dependenciesRef.current.client() !== client ||
        result.session_id !== sessionId ||
        result.task_id !== taskId
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          artifactLoading: false,
          selectedArtifact: current.detail.selectedArtifact
            ? appendTaskArtifactPage(current.detail.selectedArtifact, result)
            : result,
        },
      }));
    } catch (reason) {
      if (dependenciesRef.current.client() !== client) return;
      setState((current) => ({
        ...current,
        detail: {
          ...current.detail,
          artifactLoading: false,
          error: errorMessage(reason),
        },
      }));
    }
  };

  const observeNotification = (notification: RpcNotification) => {
    const sessionId = dependenciesRef.current.sessionId();
    const taskUpdate = parseTaskUpdated(notification);
    if (taskUpdate && taskUpdate.sessionId === sessionId) {
      setState((current) => ({
        ...current,
        tasks: applyTaskUpdated(current.tasks, taskUpdate),
      }));
    }
    const planUpdate = parsePlanUpdated(notification);
    if (planUpdate && planUpdate.sessionId === sessionId) {
      setState((current) => ({ ...current, plan: planUpdate }));
    }
    const outputDelta = parseTaskOutputDelta(notification);
    if (outputDelta && outputDelta.sessionId === sessionId) {
      setState((current) => ({
        ...current,
        detail: appendTaskOutputDelta(current.detail, outputDelta),
      }));
    }
  };

  return {
    state,
    reset,
    configureCapabilities,
    refresh,
    openTaskDetail,
    closeTaskDetail,
    loadMoreTaskOutput,
    cancelTask,
    readTaskArtifact,
    loadMoreTaskArtifact,
    observeNotification,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
