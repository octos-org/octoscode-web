import type { LaunchRuntimeState } from "./launch-model.ts";

interface LaunchDecisionPanelProps {
  state: LaunchRuntimeState;
  onChooseProfile: (profileId: string) => void;
  onCancel: () => void;
}

export function LaunchDecisionPanel({
  state,
  onChooseProfile,
  onCancel,
}: LaunchDecisionPanelProps) {
  const decision = state.decision;
  if (!decision) return null;
  const opening = state.phase === "opening";

  if (decision.decision === "no_profile") {
    return (
      <section
        className="launch-decision"
        role="alertdialog"
        aria-labelledby="launch-decision-title"
      >
        <span className="eyebrow">Octoscode setup</span>
        <h2 id="launch-decision-title">Create a profile first</h2>
        <p>
          This Octos server has no launchable profile. Run the canonical setup
          flow on the server, then reconnect this workspace.
        </p>
        <code>octoscode onboard</code>
        <div className="launch-actions">
          <button type="button" autoFocus onClick={onCancel}>
            Disconnect
          </button>
        </div>
      </section>
    );
  }

  const resolvedProfile = decision.resolved_profile;
  if (!resolvedProfile) return null;
  const crossProfile = decision.decision === "cross_profile";

  return (
    <section
      className="launch-decision"
      role="dialog"
      aria-labelledby="launch-decision-title"
    >
      <span className="eyebrow">Workspace launch</span>
      <h2 id="launch-decision-title">
        {crossProfile
          ? "Choose this workspace’s profile"
          : "Activate this coding workspace?"}
      </h2>
      <p>
        {crossProfile
          ? "This folder already has conversations under another profile. Choose the same meaning Octoscode offers in its launch menu."
          : `Open ${resolvedProfile} in this folder and create its project conversation.`}
      </p>
      {state.cwd ? <code>{state.cwd}</code> : null}
      <div className="launch-profile-list">
        <button
          type="button"
          autoFocus
          disabled={opening}
          onClick={() => onChooseProfile(resolvedProfile)}
        >
          <strong>
            {crossProfile
              ? `Start ${resolvedProfile} here`
              : `Activate ${resolvedProfile}`}
          </strong>
          <small>
            {crossProfile
              ? "Create this profile’s coding conversation in the folder"
              : "Use the server-resolved profile for this folder"}
          </small>
        </button>
        {decision.existing_profiles.map((profile) => (
          <button
            type="button"
            disabled={opening}
            key={profile}
            onClick={() => onChooseProfile(profile)}
          >
            <strong>Continue with {profile}</strong>
            <small>Resume the profile already used in this folder</small>
          </button>
        ))}
      </div>
      <div className="launch-actions">
        <span>{opening ? "Opening durable session…" : "Server decision"}</span>
        <button type="button" disabled={opening} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
