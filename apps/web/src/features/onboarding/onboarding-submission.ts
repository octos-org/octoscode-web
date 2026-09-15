import type { Dispatch, SetStateAction } from "react";
import type {
  LlmCatalogResult,
  LlmSelection,
  OctosUiClient,
} from "@octos-org/octoscode-client";
import type {
  CreatedProfileBinding,
  OnboardingRuntimeState,
  OnboardingSubmission,
} from "./use-onboarding.ts";

export const OFFICIAL_ROUTE = "__official__";
const KEYLESS_CORE_PROBE = "octoscode-web-keyless-probe";

interface OnboardingSubmissionContext {
  client: OctosUiClient;
  catalog: LlmCatalogResult;
  submission: OnboardingSubmission;
  binding: { current: CreatedProfileBinding | null };
  setState: Dispatch<SetStateAction<OnboardingRuntimeState>>;
  isCurrent: () => boolean;
  onConfigured: (profileId: string, client: OctosUiClient) => Promise<void>;
}

/** Loaded with setup; an already-configured session never needs provisioning. */
export async function submitOnboarding({
  client,
  catalog,
  submission,
  binding,
  setState,
  isCurrent,
  onConfigured,
}: OnboardingSubmissionContext): Promise<void> {
  const profileId = submission.profileId.trim();
  const profileName = submission.profileName.trim();
  const apiKey = submission.apiKey.trim();
  const selection = selectionFromCatalog(catalog, submission);
  const requiresApiKey = Boolean(selection.route.api_key_env);
  if (!profileId || !profileName || (requiresApiKey && !apiKey)) {
    throw new Error(
      requiresApiKey
        ? "Profile ID, profile name, and API key are required."
        : "Profile ID and profile name are required.",
    );
  }
  // v2.0.3-rc.9 asks for a non-empty test value even when its registry
  // marks the family keyless (octos#2123). An empty key env means upsert
  // never persists this non-secret compatibility probe.
  const wireApiKey = apiKey || KEYLESS_CORE_PROBE;
  let createdProfile = binding.current;
  if (!createdProfile) {
    setState((current) => ({
      ...current,
      phase: "creating_profile",
      error: null,
    }));
    const created = await client.createLocalProfile({
      requested_id: profileId,
      name: profileName,
      username: "",
      email: "",
      make_default: submission.makeDefault,
    });
    if (!isCurrent()) {
      return;
    }
    createdProfile = {
      requestedId: profileId,
      profileId: created.profile_id,
    };
    binding.current = createdProfile;
    setState((current) => ({
      ...current,
      createdProfileId: created.profile_id,
    }));
  } else if (createdProfile.requestedId !== profileId) {
    throw new Error(
      `Profile ${createdProfile.profileId} was already created. Reconnect to choose another identity.`,
    );
  }
  const createdProfileId = createdProfile.profileId;

  setState((current) => ({
    ...current,
    phase: "testing_provider",
    error: null,
  }));
  const tested = await client.testLlmProfile({
    profile_id: createdProfileId,
    selection,
    api_key: wireApiKey,
  });
  if (!isCurrent()) {
    return;
  }
  if (
    tested.profile_id !== createdProfileId ||
    !tested.applied ||
    tested.error
  ) {
    throw new Error(
      tested.error || tested.message || "The provider test did not pass.",
    );
  }

  setState((current) => ({
    ...current,
    phase: "saving_provider",
    error: null,
  }));
  const saved = await client.upsertLlmProfile({
    profile_id: createdProfileId,
    selection,
    api_key: wireApiKey,
    set_primary: true,
  });
  if (!isCurrent()) {
    return;
  }
  if (saved.profile_id !== createdProfileId || !saved.applied) {
    throw new Error("The server did not apply the tested provider.");
  }

  setState((current) => ({
    ...current,
    phase: "opening_session",
    error: null,
  }));
  await onConfigured(createdProfileId, client);
}

export function selectionFromCatalog(
  catalog: LlmCatalogResult,
  selection: Pick<OnboardingSubmission, "familyId" | "modelId" | "routeId">,
): LlmSelection {
  const family = catalog.families.find(
    (candidate) => candidate.id === selection.familyId,
  );
  const model = family?.models.find(
    (candidate) => candidate.id === selection.modelId,
  );
  if (!family || !model) {
    throw new Error("The selected provider or model is no longer advertised.");
  }
  if (selection.routeId === OFFICIAL_ROUTE) {
    return {
      family_id: family.id,
      model_id: model.id,
      route: {
        route_id: family.id,
        label: "Official API",
        api_key_env: family.env,
        api_type: "openai",
      },
    };
  }
  const endpoint = model.endpoints.find(
    (candidate) => candidate.id === selection.routeId,
  );
  if (!endpoint) {
    throw new Error("The selected provider route is no longer advertised.");
  }
  return {
    family_id: family.id,
    model_id: model.id,
    route: {
      route_id: endpoint.id,
      ...(endpoint.label ? { label: endpoint.label } : {}),
      ...(endpoint.base_url ? { base_url: endpoint.base_url } : {}),
      api_key_env: endpoint.api_key_env ?? family.env,
      api_type: endpoint.api_type ?? "openai",
    },
  };
}
