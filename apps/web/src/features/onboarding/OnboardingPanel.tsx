import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "./use-onboarding.ts";
import {
  CUSTOM_OPENAI_ROUTE,
  OFFICIAL_ROUTE,
} from "./onboarding-submission.ts";
import {
  orderedProviderFamilies,
  providerPresentation,
} from "./provider-presentation.ts";
import styles from "./OnboardingPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

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
  const t = useUiText();
  const families = useMemo(
    () => (state.catalog ? orderedProviderFamilies(state.catalog) : []),
    [state.catalog],
  );
  const initialFamily = families[0];
  const [step, setStep] = useState<"service" | "connect">("service");
  const [profileId, setProfileId] = useState("coding");
  const [profileName, setProfileName] = useState("Coding");
  const [makeDefault, setMakeDefault] = useState(true);
  const [familyId, setFamilyId] = useState(initialFamily?.id ?? "");
  const [modelId, setModelId] = useState(initialFamily?.models[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  const family = families.find((candidate) => candidate.id === familyId);
  const models = family?.models ?? [];
  const requiresApiKey = Boolean(family?.env);
  const provider = providerPresentation(familyId);

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
  }, [state.catalog]);

  useEffect(() => {
    if (state.phase === "opening_session") setApiKey("");
  }, [state.phase]);

  useEffect(() => {
    if (!requiresApiKey) setApiKey("");
  }, [requiresApiKey]);

  const busy = state.phase !== "ready";
  const routeId = customEndpoint ? CUSTOM_OPENAI_ROUTE : OFFICIAL_ROUTE;
  const customUrlValid = !customEndpoint || isHttpUrl(baseUrl);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === "service") {
      if (familyId && modelId) setStep("connect");
      return;
    }
    onSubmit({
      profileId,
      profileName,
      makeDefault,
      familyId,
      modelId,
      routeId,
      baseUrl,
      apiKey,
    });
  };
  const status = onboardingStatus(state.phase);

  return (
    <section
      className={`launch-decision ${styles.panel}`}
      role="dialog"
      aria-labelledby="launch-decision-title"
    >
      <span className="eyebrow">{t("Octoscode setup")}</span>
      <h2 id="launch-decision-title">{t("Set up your coding assistant")}</h2>
      <p>
        {t(
          "Choose a model service, connect it, and start coding in two steps.",
        )}
      </p>

      {!state.supported ? (
        <OnboardingFallback onCancel={onCancel} />
      ) : state.phase === "loading_catalog" ? (
        <div className={styles.progress} role="status">
          <span aria-hidden="true" />
          {t("Loading model providers from your server…")}
        </div>
      ) : !state.catalog || !families.length ? (
        <div className={styles.failure} role="alert">
          <strong>{t("Model setup could not be loaded")}</strong>
          <span>
            {state.error ?? t("The server returned an invalid catalog.")}
          </span>
          <div className={`launch-actions ${styles.actions}`}>
            <button type="button" onClick={onRetry}>
              {t("Retry")}
            </button>
            <button type="button" onClick={onCancel}>
              {t("Disconnect")}
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <p className={styles.step}>
            {step === "service"
              ? t("Step 1 of 2 · Model service")
              : t("Step 2 of 2 · Connect")}
          </p>
          {step === "service" ? (
            <>
              <fieldset className={styles.providerGroup} disabled={busy}>
                <legend>{t("Choose a provider")}</legend>
                <div className={styles.providers}>
                  {families.map((candidate) => {
                    const presentation = providerPresentation(candidate.id);
                    return (
                      <label
                        key={candidate.id}
                        className={
                          candidate.id === familyId
                            ? `${styles.provider} ${styles.selected}`
                            : styles.provider
                        }
                      >
                        <input
                          type="radio"
                          name="provider"
                          value={candidate.id}
                          checked={candidate.id === familyId}
                          onChange={() => {
                            setFamilyId(candidate.id);
                            setModelId(candidate.models[0]?.id ?? "");
                            setCustomEndpoint(false);
                            setBaseUrl("");
                          }}
                        />
                        <span className={styles.providerText}>
                          <strong>{t(presentation.name)}</strong>
                          <small>{t(presentation.tag)}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className={styles.modelField}>
                <span>{t("Model")}</span>
                <select
                  name="model"
                  value={modelId}
                  disabled={busy}
                  onChange={(event) => setModelId(event.target.value)}
                >
                  {models.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.id}
                    </option>
                  ))}
                </select>
              </label>
              <details className={styles.advanced}>
                <summary>{t("Advanced")}</summary>
                <p>
                  {t(
                    "An ID and name are generated automatically. Change them only if needed.",
                  )}
                </p>
                <div className={`${styles.fields} ${styles.profileFields}`}>
                  <label>
                    <span>{t("Profile ID")}</span>
                    <input
                      name="profile-id"
                      value={profileId}
                      disabled={busy || Boolean(state.createdProfileId)}
                      autoComplete="off"
                      onChange={(event) => setProfileId(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{t("Profile name")}</span>
                    <input
                      name="profile-name"
                      value={profileName}
                      disabled={busy || Boolean(state.createdProfileId)}
                      autoComplete="off"
                      onChange={(event) => setProfileName(event.target.value)}
                    />
                  </label>
                </div>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    disabled={busy || Boolean(state.createdProfileId)}
                    onChange={(event) => setMakeDefault(event.target.checked)}
                  />
                  <span>{t("Use as the default local profile")}</span>
                </label>
              </details>
            </>
          ) : (
            <>
              <div className={styles.selectionSummary}>
                <strong>{t(provider.name)}</strong>
                <span>{modelId}</span>
              </div>
              {requiresApiKey ? (
                <label className={styles.secret}>
                  <span>{t("API key")}</span>
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
                    {t(
                      "Sent only to your Octos server for test and save; never stored by this browser client.",
                    )}
                  </small>
                </label>
              ) : (
                <div className={styles.keyless} role="status">
                  <strong>{t("No API key required")}</strong>
                  <span>
                    {t(provider.name)}
                    {" " + t("is marked keyless by the Core catalog.")}
                  </span>
                </div>
              )}
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={customEndpoint}
                  disabled={busy}
                  onChange={(event) => setCustomEndpoint(event.target.checked)}
                />
                <span>{t("Use a custom OpenAI-compatible endpoint")}</span>
              </label>
              {customEndpoint ? (
                <label>
                  <span>{t("Custom OpenAI-compatible base URL")}</span>
                  <input
                    name="base-url"
                    type="url"
                    value={baseUrl}
                    placeholder="http://127.0.0.1:8080/v1"
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </label>
              ) : null}
              {state.createdProfileId ? (
                <div className={styles.recovery} role="status">
                  {t("Profile") + " "}
                  <code>{state.createdProfileId}</code>
                  {" " +
                    t("exists. A retry only repeats provider test and save.")}
                </div>
              ) : null}
              {state.error ? (
                <div className={styles.error} role="alert">
                  {state.error}
                </div>
              ) : null}
            </>
          )}
          <div className={`launch-actions ${styles.actions}`}>
            <span>{status}</span>
            <div>
              {step === "connect" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep("service")}
                >
                  {t("Back")}
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={onCancel}>
                {t("Disconnect")}
              </button>
              <button
                className={styles.submit}
                type="submit"
                disabled={
                  busy ||
                  !familyId ||
                  !modelId ||
                  (step === "connect" &&
                    ((requiresApiKey && !apiKey.trim()) || !customUrlValid))
                }
              >
                {step === "service"
                  ? t("Continue")
                  : busy
                    ? t("Working…")
                    : t("Test, save & open")}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function OnboardingFallback({ onCancel }: { onCancel: () => void }) {
  const t = useUiText();
  return (
    <div className={styles.failure}>
      <strong>{t("This server cannot onboard from the Web")}</strong>
      <span>
        {t(
          "Run the canonical setup on the server, then reconnect this workspace.",
        )}
      </span>
      <code>octoscode onboard</code>
      <div className={`launch-actions ${styles.actions}`}>
        <button type="button" autoFocus onClick={onCancel}>
          {t("Disconnect")}
        </button>
      </div>
    </div>
  );
}

function onboardingStatus(phase: OnboardingRuntimeState["phase"]): string {
  switch (phase) {
    case "creating_profile":
      return "Creating your workspace profile";
    case "testing_provider":
      return "Testing the connection";
    case "saving_provider":
      return "Saving your provider";
    case "opening_session":
      return "Opening your coding session";
    default:
      return "";
  }
}
