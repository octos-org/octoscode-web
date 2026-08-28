import type {
  PlanUpdated,
  SessionStatusReadResult,
  TaskArtifactListResult,
  TaskArtifactReadResult,
  TaskListEntry,
  TaskOutputDelta,
  TaskOutputReadResult,
  TaskUpdated,
} from "@octos-org/octoscode-client";

export interface SupervisedTask {
  id: string;
  title: string;
  toolName: string;
  state: string;
  status: string;
  role?: string;
  source?: string;
  summary?: string;
  phase?: string;
  artifactCount: number;
  updatedAt?: string;
  outputFiles: string[];
  error?: string;
}

export interface TaskDetailState {
  active: boolean;
  taskId: string | null;
  loading: boolean;
  loadingMore: boolean;
  output: TaskOutputReadResult | null;
  text: string;
  artifacts: TaskArtifactListResult | null;
  selectedArtifact: TaskArtifactReadResult | null;
  artifactLoading: boolean;
  error: string | null;
}

export interface SupervisionRuntimeState {
  planAvailable: boolean;
  taskListAvailable: boolean;
  taskOutputAvailable: boolean;
  artifactsAvailable: boolean;
  cancelAvailable: boolean;
  statusAvailable: boolean;
  loading: boolean;
  error: string | null;
  tasks: SupervisedTask[];
  plan: PlanUpdated | null;
  runtimeStatus: SessionStatusReadResult | null;
  detail: TaskDetailState;
}

export const EMPTY_TASK_DETAIL: TaskDetailState = {
  active: false,
  taskId: null,
  loading: false,
  loadingMore: false,
  output: null,
  text: "",
  artifacts: null,
  selectedArtifact: null,
  artifactLoading: false,
  error: null,
};

export const EMPTY_SUPERVISION: SupervisionRuntimeState = {
  planAvailable: false,
  taskListAvailable: false,
  taskOutputAvailable: false,
  artifactsAvailable: false,
  cancelAvailable: false,
  statusAvailable: false,
  loading: false,
  error: null,
  tasks: [],
  plan: null,
  runtimeStatus: null,
  detail: EMPTY_TASK_DETAIL,
};

export function tasksFromList(
  entries: readonly TaskListEntry[],
): SupervisedTask[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.summary ?? entry.role ?? entry.tool_name,
    toolName: entry.tool_name,
    state: entry.state,
    status: entry.status,
    ...(entry.role ? { role: entry.role } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.current_phase ? { phase: entry.current_phase } : {}),
    artifactCount: entry.artifact_count ?? 0,
    updatedAt: entry.updated_at,
    outputFiles: entry.output_files,
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

export function applyTaskUpdated(
  tasks: readonly SupervisedTask[],
  event: TaskUpdated,
): SupervisedTask[] {
  const existing = tasks.find((task) => task.id === event.taskId);
  const next: SupervisedTask = {
    id: event.taskId,
    title: event.summary ?? event.role ?? event.title,
    toolName: existing?.toolName ?? event.title,
    state: event.state,
    status: event.runtimeDetail ?? event.state,
    ...(event.role
      ? { role: event.role }
      : existing?.role
        ? { role: existing.role }
        : {}),
    ...(event.source
      ? { source: event.source }
      : existing?.source
        ? { source: existing.source }
        : {}),
    ...(event.summary
      ? { summary: event.summary }
      : existing?.summary
        ? { summary: existing.summary }
        : {}),
    artifactCount: event.artifactCount ?? existing?.artifactCount ?? 0,
    outputFiles: existing?.outputFiles ?? [],
    ...(event.state === "failed" && event.runtimeDetail
      ? { error: event.runtimeDetail }
      : existing?.error
        ? { error: existing.error }
        : {}),
  };
  return [next, ...tasks.filter((task) => task.id !== event.taskId)];
}

export function taskIsCancellable(task: SupervisedTask): boolean {
  return task.state === "pending" || task.state === "running";
}

export function appendTaskOutputDelta(
  detail: TaskDetailState,
  event: TaskOutputDelta,
): TaskDetailState {
  if (detail.taskId !== event.taskId || !detail.output) return detail;

  const expectedOffset = detail.output.next_cursor.offset;
  const deltaBytes = new TextEncoder().encode(event.text);
  const deltaEndOffset = event.cursor.offset + deltaBytes.byteLength;
  if (deltaEndOffset <= expectedOffset) return detail;
  if (event.cursor.offset > expectedOffset) {
    return {
      ...detail,
      error:
        "Live task output has a cursor gap. Load more output to resynchronize.",
    };
  }

  const overlap = expectedOffset - event.cursor.offset;
  const suffix = new TextDecoder().decode(deltaBytes.slice(overlap));
  return {
    ...detail,
    text: `${detail.text}${suffix}`,
    output: {
      ...detail.output,
      next_cursor: { offset: deltaEndOffset },
      total_bytes: Math.max(detail.output.total_bytes, deltaEndOffset),
      complete: false,
    },
  };
}

export function appendTaskArtifactPage(
  current: TaskArtifactReadResult,
  next: TaskArtifactReadResult,
): TaskArtifactReadResult {
  if (
    current.session_id !== next.session_id ||
    current.task_id !== next.task_id ||
    current.artifact.id !== next.artifact.id
  ) {
    return current;
  }
  return {
    ...next,
    content: `${current.content ?? ""}${next.content ?? ""}`,
  };
}
