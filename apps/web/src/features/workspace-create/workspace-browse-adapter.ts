import {
  supportsWorkspaceBrowse,
  workspaceBrowseRefusal,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  WorkspaceBrowseAdapter,
  WorkspaceBrowseOutcome,
} from "./workspace-browse.ts";

/**
 * WEB-WORKSPACE-BROWSER-CONTRACT-5000 §Gate — the ONE place the browsing
 * affordance is admitted. Without the advertised feature (or without a
 * connected client) this returns null, the picker receives no adapter, and the
 * Add workspace form behaves exactly as it did before the feature existed.
 *
 * It is also the boundary where a server refusal stops being a server string:
 * only a typed `data.kind` survives, and everything else becomes `unknown`.
 */
export function workspaceBrowseAdapter(
  client: OctosUiClient | null,
  capabilities: UiProtocolCapabilities | undefined,
): WorkspaceBrowseAdapter | null {
  if (!client || !supportsWorkspaceBrowse(capabilities)) return null;
  return {
    list: async (path) => {
      try {
        const result = await client.listWorkspaceFolders({ path });
        return {
          status: "ok",
          value: {
            canonicalPath: result.canonical_path,
            parentPath: result.parent_path,
            writable: result.writable,
            entries: result.entries,
            truncated: result.truncated,
            hiddenSkipped: result.hidden_skipped,
          },
        };
      } catch (reason) {
        return refused(reason);
      }
    },
    create: async (parent, name) => {
      try {
        const result = await client.createWorkspaceFolder({ parent, name });
        return {
          status: "ok",
          value: { canonicalPath: result.canonical_path },
        };
      } catch (reason) {
        return refused(reason);
      }
    },
  };
}

function refused(reason: unknown): WorkspaceBrowseOutcome<never> {
  return {
    status: "failed",
    failure: workspaceBrowseRefusal(reason)?.kind ?? "unknown",
  };
}
