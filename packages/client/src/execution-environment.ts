import { isRecord } from "./rpc.ts";

export const SESSION_EXECUTION_ENVIRONMENT_FEATURE =
  "session.execution_environment.v1";
export const SESSION_EXECUTION_ENVIRONMENT_READ =
  "session/execution_environment/read";

const BACKENDS = new Set([
  "bwrap",
  "landlock",
  "docker",
  "macos",
  "appcontainer",
  "none",
  "unavailable",
  "unknown",
]);
const TOOL_STATES = new Set(["available", "missing", "unknown"]);
const PROBE_STATES = new Set(["complete", "failed", "unsupported"]);

export interface ExecutionEnvironmentReadParams {
  session_id: string;
  profile_id?: string;
}

export interface ExecutionEnvironmentResult {
  backend:
    | "bwrap"
    | "landlock"
    | "docker"
    | "macos"
    | "appcontainer"
    | "none"
    | "unavailable"
    | "unknown";
  docker_image: string | null;
  tools: {
    node: "available" | "missing" | "unknown";
    npm: "available" | "missing" | "unknown";
    git: "available" | "missing" | "unknown";
    python: "available" | "missing" | "unknown";
  };
  probe_status: "complete" | "failed" | "unsupported";
  probed_at: string;
  probe_error?: string | null;
}

export function parseExecutionEnvironmentResult(
  value: unknown,
): ExecutionEnvironmentResult | null {
  if (
    !isRecord(value) ||
    typeof value.backend !== "string" ||
    !BACKENDS.has(value.backend) ||
    !(typeof value.docker_image === "string" || value.docker_image === null) ||
    !isRecord(value.tools) ||
    typeof value.probe_status !== "string" ||
    !PROBE_STATES.has(value.probe_status) ||
    typeof value.probed_at !== "string" ||
    (value.probe_error !== undefined &&
      value.probe_error !== null &&
      typeof value.probe_error !== "string")
  ) {
    return null;
  }
  const rawTools = value.tools;
  const tools = Object.fromEntries(
    (["node", "npm", "git", "python"] as const).map((name) => [
      name,
      rawTools[name],
    ]),
  );
  if (
    Object.values(tools).some(
      (state) => typeof state !== "string" || !TOOL_STATES.has(state),
    )
  ) {
    return null;
  }
  return {
    backend: value.backend as ExecutionEnvironmentResult["backend"],
    docker_image: value.docker_image,
    tools: tools as ExecutionEnvironmentResult["tools"],
    probe_status:
      value.probe_status as ExecutionEnvironmentResult["probe_status"],
    probed_at: value.probed_at,
    ...(value.probe_error !== undefined
      ? { probe_error: value.probe_error as string | null }
      : {}),
  };
}
