import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  OFFICIAL_ROUTE,
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "./use-onboarding.ts";

interface OnboardingPanelProps {
  state: OnboardingRuntimeState;
  onSubmit: (submission: OnboardingSubmission) => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function OnboardingPanel({
  state,
  onSubmit,
  onRetry,
  onCancel,
}: OnboardingPanelProps) {
  const initialFamily = state.catalog?.families[0];
  const [profileId, setProfileId] = useState("coding");
  const [profileName, setProfileName] = useState("Coding");
  const [makeDefault, setMakeDefault] = useState(true);
  const [familyId, setFamilyId] = useState(initialFamily?.id ?? "");
  const [modelId, setModelId] = useState(initialFamily?.models[0]?.id ?? "");
  const [routeId, setRouteId] = useState(OFFICIAL_ROUTE);
  const [apiKey, setApiKey] = useState("");

  const families = state.catalog?.families ?? [];
  const family = families.find((candidate) => candidate.id === familyId);
  const models = family?.models ?? [];
  const model = models.find((candidate) => candidate.id === modelId);
  const selectedEndpoint = model?.endpoints.find(
    (candidate) => candidate.id === routeId,
  );
  const requiresApiKey = Boolean(
    routeId === OFFICIAL_ROUTE
      ? family?.env
      : (selectedEndpoint?.api_key_env ?? family?.env),
  );

  useEffect(() => {
    if (!families.length) return;
    const nextFamily = families.find((candidate) => candidate.id === familyId)
      ? familyId
      : (families[0]?.id ?? "");
    const nextModels =
      families.find((candidate) => candidate.id === nextFamily)?.models ?? [];
    const nextModel = nextModels.find((candidate) => candidate.id === modelId)
      ? modelId
      : (nextModels[0]?.id ?? "");
    setFamilyId(nextFamily);
    setModelId(nextModel);
    setRouteId(OFFICIAL_ROUTE);
  }, [state.catalog]);

  useEffect(() => {
    if (state.phase === "opening_session") setApiKey("");
  }, [state.phase]);

  useEffect(() => {
    if (!requiresApiKey) setApiKey("");
  }, [requiresApiKey]);

  const routes = useMemo(
    () => [
      { id: OFFICIAL_ROUTE, label: "Official API" },
      ...(model?.endpoints.map((endpoint) => ({
        id: endpoint.id,
        label: endpoint.label ?? endpoint.id,
      })) ?? []),
    ],
    [model],
  );
  const busy = state.phase !== "ready";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      profileId,
      profileName,
      makeDefault,
      familyId,
      modelId,
      routeId,
      apiKey,
    });
  };

  return (
    <section
      className="launch-decision onboarding-panel"
      role="dialog"
      aria-labelledby="launch-decision-title"
    >
      <span className="eyebrow">Octoscode setup</span>
      <h2 id="launch-decision-title">Create your local coding profile</h2>
      <p>
        This follows Octoscode’s solo onboarding: create a named profile, test a
        server-advertised model route, save it, then open the canonical coding
        session.
      </p>

      {!state.supported ? (
        <OnboardingFallback onCancel={onCancel} />
      ) : state.phase === "loading_catalog" ? (
        <div className="onboarding-progress" role="status">
          <span /> Loading providers from Octos…
        </div>
      ) : !state.catalog ? (
        <div className="onboarding-failure" role="alert">
          <strong>Provider catalog unavailable</strong>
          <span>
            {state.error ?? "The server returned an invalid catalog."}
          </span>
          <div className="launch-actions">
            <button type="button" onClick={onRetry}>
              Retry
            </button>
            <button type="button" onClick={onCancel}>
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form className="onboarding-form" onSubmit={submit}>
          <div className="onboarding-fields onboarding-fields-profile">
            <label>
              <span>Profile ID</span>
              <input
                name="profile-id"
                value={profileId}
                disabled={busy || Boolean(state.createdProfileId)}
                autoComplete="off"
                onChange={(event) => setProfileId(event.target.value)}
              />
            </label>
            <label>
              <span>Profile name</span>
              <input
                name="profile-name"
                value={profileName}
                disabled={busy || Boolean(state.createdProfileId)}
                autoComplete="off"
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
          </div>
          <label className="onboarding-checkbox">
            <input
              type="checkbox"
              checked={makeDefault}
              disabled={busy || Boolean(state.createdProfileId)}
              onChange={(event) => setMakeDefault(event.target.checked)}
            />
            <span>Use as the default local profile</span>
          </label>
          <div className="onboarding-fields">
            <label>
              <span>Provider</span>
              <select
                name="provider"
                value={familyId}
                disabled={busy}
                onChange={(event) => {
                  const nextFamilyId = event.target.value;
                  const nextFamily = families.find(
                    (candidate) => candidate.id === nextFamilyId,
                  );
                  setFamilyId(nextFamilyId);
                  setModelId(nextFamily?.models[0]?.id ?? "");
                  setRouteId(OFFICIAL_ROUTE);
                }}
              >
                {families.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select
                name="model"
                value={modelId}
                disabled={busy}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setRouteId(OFFICIAL_ROUTE);
                }}
              >
                {models.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Route</span>
              <select
                name="route"
                value={routeId}
                disabled={busy}
                onChange={(event) => setRouteId(event.target.value)}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {requiresApiKey ? (
            <label className="onboarding-secret">
              <span>API key</span>
              <input
                name="api-key"
                type="password"
                value={apiKey}
                disabled={busy}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <small>
                Sent only to your Octos server for test and save; never stored
                by this browser client.
              </small>
            </label>
          ) : (
            <div className="onboarding-keyless" role="status">
              <strong>No API key required</strong>
              <span>{familyId} is marked keyless by the Core catalog.</span>
            </div>
          )}
          {state.createdProfileId ? (
            <div className="onboarding-recovery" role="status">
              Profile <code>{state.createdProfileId}</code> exists. A retry only
              repeats provider test and save.
            </div>
          ) : null}
          {state.error ? (
            <div className="onboarding-error" role="alert">
              {state.error}
            </div>
          ) : null}
          <div className="launch-actions">
            <span>{onboardingStatus(state.phase)}</span>
            <div>
              <button type="button" disabled={busy} onClick={onCancel}>
                Disconnect
              </button>
              <button
                className="onboarding-submit"
                type="submit"
                disabled={
                  busy ||
                  !familyId ||
                  !modelId ||
                  (requiresApiKey && !apiKey.trim())
                }
              >
                {busy ? "Working…" : "Test, save & open"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function OnboardingFallback({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="onboarding-failure" role="alert">
      <strong>This server cannot onboard from the Web</strong>
      <span>
        Run the canonical setup on the server, then reconnect this workspace.
      </span>
      <code>octoscode onboard</code>
      <div className="launch-actions">
        <button type="button" autoFocus onClick={onCancel}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function onboardingStatus(phase: OnboardingRuntimeState["phase"]): string {
  switch (phase) {
    case "creating_profile":
      return "Creating profile";
    case "testing_provider":
      return "Testing provider";
    case "saving_provider":
      return "Saving provider";
    case "opening_session":
      return "Opening coding session";
    default:
      return "Server-verified setup";
  }
}
