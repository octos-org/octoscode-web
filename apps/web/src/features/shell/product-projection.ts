import type { ProfileLlmModel } from "@octos-org/octoscode-client/protocol";

export function profileDefaultNeedsRestart(
  runtimeModel: { model: string; provider: string } | null | undefined,
  models: readonly ProfileLlmModel[],
  serverHint: boolean,
): boolean {
  const profileDefault = models.find((model) => model.selected);
  if (!runtimeModel || !profileDefault) return serverHint;
  // Session status exposes provider/model but not Core's route or policy
  // revision. Equal strings therefore cannot disprove an authoritative
  // restart_required response after a route-only policy change.
  return (
    serverHint ||
    runtimeModel.provider !== profileDefault.provider ||
    runtimeModel.model !== profileDefault.model
  );
}

export { formatRelativeTime } from "./relative-time.ts";

export {
  permissionControlState,
  permissionOptionId,
  permissionOptions,
} from "./permission-projection.ts";
export {
  findModel,
  modelControlState,
  modelGroups,
  modelOptionId,
  selectedModel,
} from "./model-projection.ts";
