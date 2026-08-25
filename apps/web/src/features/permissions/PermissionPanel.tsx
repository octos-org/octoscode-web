import type {
  PermissionNetworkPolicy,
  PermissionProfileMode,
  PermissionProfileUpdate,
} from "@octos-org/octoscode-client";
import type { PermissionRuntimeState } from "../session/use-octos-session.ts";

interface PermissionPanelProps {
  state: PermissionRuntimeState;
  connected: boolean;
  onUpdate: (update: PermissionProfileUpdate) => void;
  onRefresh: () => void;
}

const modes: Array<{
  value: PermissionProfileMode;
  label: string;
  shortLabel: string;
}> = [
  { value: "read_only", label: "Read only", shortLabel: "Read" },
  {
    value: "workspace_write",
    label: "Workspace write",
    shortLabel: "Write",
  },
  {
    value: "danger_full_access",
    label: "Full access",
    shortLabel: "Full",
  },
];

const networks: Array<{
  value: PermissionNetworkPolicy;
  label: string;
}> = [
  { value: "deny", label: "Blocked" },
  { value: "allow", label: "Allowed" },
];

export function PermissionPanel({
  state,
  connected,
  onUpdate,
  onRefresh,
}: PermissionPanelProps) {
  if (!connected) return null;
  if (!state.available) {
    return (
      <section className="permission-card permission-unavailable">
        <div className="permission-heading">
          <span className="eyebrow">Permissions</span>
          <span className="permission-state">Unavailable</span>
        </div>
        <p>The server did not advertise session permission profiles.</p>
      </section>
    );
  }

  const current = state.result?.current;
  const advertised = state.result?.profiles ?? [];
  const canMutate =
    state.editable &&
    !state.loading &&
    !state.busy &&
    advertised.length > 0 &&
    current !== undefined;

  return (
    <section
      className="permission-card"
      aria-busy={state.loading || state.busy}
    >
      <div className="permission-heading">
        <span className="eyebrow">Permissions</span>
        <button type="button" onClick={onRefresh} disabled={state.loading}>
          {state.loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="permission-group" aria-label="Filesystem access">
        {modes.map((mode) => {
          const selection =
            advertised.find(
              (profile) =>
                profile.mode === mode.value &&
                profile.network === current?.network,
            ) ?? advertised.find((profile) => profile.mode === mode.value);
          const supported = selection !== undefined;
          return (
            <button
              key={mode.value}
              className={
                mode.value === "danger_full_access" ? "is-dangerous" : ""
              }
              type="button"
              aria-label={mode.label}
              aria-pressed={current?.mode === mode.value}
              disabled={!canMutate || !supported}
              title={
                supported
                  ? mode.label
                  : `${mode.label} is not advertised by this server`
              }
              onClick={() =>
                selection &&
                onUpdate({ mode: selection.mode, network: selection.network })
              }
            >
              {mode.shortLabel}
            </button>
          );
        })}
      </div>
      <div className="permission-network">
        <span>Network</span>
        <div className="permission-group" aria-label="Network access">
          {networks.map((network) => {
            const selection = advertised.find(
              (profile) =>
                profile.network === network.value &&
                profile.mode === current?.mode,
            );
            const supported = selection !== undefined;
            return (
              <button
                key={network.value}
                type="button"
                aria-pressed={current?.network === network.value}
                disabled={!canMutate || !supported}
                onClick={() =>
                  selection && onUpdate({ network: selection.network })
                }
              >
                {network.label}
              </button>
            );
          })}
        </div>
      </div>
      {state.error ? (
        <p className="permission-error" role="alert">
          {state.error}
        </p>
      ) : !state.editable ? (
        <p>Read from the server; changes are not advertised.</p>
      ) : advertised.length === 0 && !state.loading ? (
        <p>No selectable profiles were returned, so changes stay disabled.</p>
      ) : (
        <p>Session scoped · the server is authoritative.</p>
      )}
    </section>
  );
}
