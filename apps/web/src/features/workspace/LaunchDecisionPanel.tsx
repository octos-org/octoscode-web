import type { LaunchRuntimeState } from "./launch-model.ts";
import { OnboardingPanel } from "../onboarding/OnboardingPanel.tsx";
import type {
  OnboardingRuntimeState,
  OnboardingSubmission,
} from "../onboarding/use-onboarding.ts";

interface LaunchDecisionPanelProps {
  state: LaunchRuntimeState;
  onboarding: OnboardingRuntimeState;
  error?: string | null;
  onSubmitOnboarding: (submission: OnboardingSubmission) => void;
  onRetryOnboarding: () => void;
  onChooseProfile: (profileId: string) => void;
  onCancel: () => void;
}

export function LaunchDecisionPanel({
  state,
  onboarding,
  error = null,
  onSubmitOnboarding,
  onRetryOnboarding,
  onChooseProfile,
  onCancel,
}: LaunchDecisionPanelProps) {
  const decision = state.decision;
  if (!decision) return null;
  const opening = state.phase === "opening";

  if (decision.decision === "no_profile") {
    return (
      <>
        {error ? (
          <p className="launch-error" role="alert">
            {error}
          </p>
        ) : null}
        <OnboardingPanel
          state={onboarding}
          onSubmit={onSubmitOnboarding}
          onRetry={onRetryOnboarding}
          onCancel={onCancel}
        />
      </>
    );
  }

  if (decision.decision !== "cross_profile") return null;
  const resolvedProfile = decision.resolved_profile;
  if (!resolvedProfile) return null;

  return (
    <section
      className="launch-decision"
      role="dialog"
      aria-labelledby="launch-decision-title"
    >
      <span className="eyebrow">Workspace launch</span>
      <h2 id="launch-decision-title">Choose this workspace’s profile</h2>
      <p>
        This folder is known to more than one profile. Choose which profile
        should own the new Session.
      </p>
      {state.cwd ? <code>{state.cwd}</code> : null}
      {error ? (
        <p className="launch-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="launch-profile-list">
        <button
          type="button"
          autoFocus
          disabled={opening}
          onClick={() => onChooseProfile(resolvedProfile)}
        >
          <strong>Start {resolvedProfile} here</strong>
          <small>Create this profile’s coding conversation in the folder</small>
        </button>
        {decision.existing_profiles.map((profile) => (
          <button
            type="button"
            disabled={opening}
            key={profile}
            onClick={() => onChooseProfile(profile)}
          >
            <strong>Start new session with {profile}</strong>
            <small>Use this existing profile for a new Session</small>
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
