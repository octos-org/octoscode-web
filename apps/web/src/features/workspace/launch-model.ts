import type { LaunchResolveResult } from "@octos-org/octoscode-client";

export interface LaunchRuntimeState {
  phase: "idle" | "resolving" | "awaiting_choice" | "opening";
  cwd: string | null;
  decision: LaunchResolveResult | null;
}

export const EMPTY_LAUNCH_RUNTIME: LaunchRuntimeState = {
  phase: "idle",
  cwd: null,
  decision: null,
};

export function codingSessionIdForProfile(profileId: string): string {
  return `${profileId}:local:tui#coding`;
}
