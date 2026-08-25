import { useRef, useState } from "react";
import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type LlmCatalogResult,
  type LlmSelection,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";

const OFFICIAL_ROUTE = "__official__";
const KEYLESS_CORE_PROBE = "octoscode-web-keyless-probe";
const REQUIRED_METHODS = Object.values(APPUI_ONBOARDING_METHODS);

export type OnboardingPhase =
  | "idle"
  | "loading_catalog"
  | "ready"
  | "creating_profile"
  | "testing_provider"
  | "saving_provider"
  | "opening_session";

export interface OnboardingRuntimeState {
  phase: OnboardingPhase;
  supported: boolean;
  catalog: LlmCatalogResult | null;
  createdProfileId: string | null;
  error: string | null;
}

export interface OnboardingSubmission {
  profileId: string;
  profileName: string;
  makeDefault: boolean;
  familyId: string;
  modelId: string;
  routeId: string;
  apiKey: string;
}

interface UseOnboardingOptions {
  client: () => OctosUiClient | null;
  capabilities: () => UiProtocolCapabilities | undefined;
  onConfigured: (profileId: string, client: OctosUiClient) => Promise<void>;
}

const EMPTY_ONBOARDING: OnboardingRuntimeState = {
  phase: "idle",
  supported: false,
  catalog: null,
  createdProfileId: null,
  error: null,
};

export function useOnboarding(options: UseOnboardingOptions) {
  const generationRef = useRef(0);
  const createdProfileRef = useRef<string | null>(null);
  const [state, setState] = useState<OnboardingRuntimeState>(EMPTY_ONBOARDING);

  const reset = () => {
    generationRef.current += 1;
    createdProfileRef.current = null;
    setState(EMPTY_ONBOARDING);
  };

  const prepare = async () => {
    const client = options.client();
    const capabilities = options.capabilities();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    createdProfileRef.current = null;

    if (
      !client ||
      REQUIRED_METHODS.some((method) => !supportsMethod(capabilities, method))
    ) {
      setState(EMPTY_ONBOARDING);
      return;
    }

    setState({
      phase: "loading_catalog",
      supported: true,
      catalog: null,
      createdProfileId: null,
      error: null,
    });
    try {
      const catalog = await client.getLlmCatalog();
      if (generationRef.current !== generation || options.client() !== client) {
        return;
      }
      setState({
        phase: "ready",
        supported: true,
        catalog,
        createdProfileId: null,
        error: null,
      });
    } catch (reason) {
      if (generationRef.current !== generation || options.client() !== client) {
        return;
      }
      setState({
        phase: "ready",
        supported: true,
        catalog: null,
        createdProfileId: null,
        error: errorMessage(reason),
      });
    }
  };

  const submit = async (submission: OnboardingSubmission) => {
    const client = options.client();
    const catalog = state.catalog;
    const generation = generationRef.current;
    if (!client || !state.supported || !catalog || state.phase !== "ready") {
      return;
    }

    const profileId = submission.profileId.trim();
    const profileName = submission.profileName.trim();
    const apiKey = submission.apiKey.trim();
    try {
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
      let createdProfileId = createdProfileRef.current;
      if (!createdProfileId) {
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
        if (
          generationRef.current !== generation ||
          options.client() !== client
        ) {
          return;
        }
        if (created.profile_id !== profileId) {
          throw new Error("The server created an unexpected profile identity.");
        }
        createdProfileId = created.profile_id;
        createdProfileRef.current = createdProfileId;
        setState((current) => ({
          ...current,
          createdProfileId,
        }));
      } else if (createdProfileId !== profileId) {
        throw new Error(
          `Profile ${createdProfileId} was already created. Reconnect to choose another identity.`,
        );
      }

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
      if (generationRef.current !== generation || options.client() !== client) {
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
      if (generationRef.current !== generation || options.client() !== client) {
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
      await options.onConfigured(createdProfileId, client);
    } catch (reason) {
      if (generationRef.current !== generation || options.client() !== client) {
        return;
      }
      setState((current) => ({
        ...current,
        phase: "ready",
        createdProfileId: createdProfileRef.current,
        error: redactSecret(errorMessage(reason), apiKey),
      }));
    }
  };

  return { state, prepare, reset, submit };
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

export { OFFICIAL_ROUTE };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function redactSecret(message: string, secret: string): string {
  const redacted = secret ? message.replaceAll(secret, "[redacted]") : message;
  return redacted.slice(0, 1_000);
}
