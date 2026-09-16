import { useRef, useState } from "react";
import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type LlmCatalogResult,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { RequestGate } from "../async/request-gate.ts";

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

export interface CreatedProfileBinding {
  requestedId: string;
  profileId: string;
}

const EMPTY_ONBOARDING: OnboardingRuntimeState = {
  phase: "idle",
  supported: false,
  catalog: null,
  createdProfileId: null,
  error: null,
};

export function useOnboarding(options: UseOnboardingOptions) {
  const requestsRef = useRef(new RequestGate());
  const createdProfileRef = useRef<CreatedProfileBinding | null>(null);
  const submissionActiveRef = useRef(false);
  const [state, setState] = useState<OnboardingRuntimeState>(EMPTY_ONBOARDING);

  const reset = () => {
    requestsRef.current.invalidate();
    createdProfileRef.current = null;
    submissionActiveRef.current = false;
    setState(EMPTY_ONBOARDING);
  };

  const prepare = async () => {
    const client = options.client();
    const capabilities = options.capabilities();
    const generation = requestsRef.current.begin();
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
      if (
        !requestsRef.current.isCurrent(generation) ||
        options.client() !== client
      ) {
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
      if (
        !requestsRef.current.isCurrent(generation) ||
        options.client() !== client
      ) {
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
    if (
      !client ||
      !state.supported ||
      !catalog ||
      state.phase !== "ready" ||
      submissionActiveRef.current
    ) {
      return;
    }
    const generation = requestsRef.current.begin();
    submissionActiveRef.current = true;

    const apiKey = submission.apiKey.trim();
    try {
      const { submitOnboarding } = await import("./onboarding-submission.ts");
      const isCurrent = () =>
        requestsRef.current.isCurrent(generation) &&
        options.client() === client;
      if (!isCurrent()) return;
      await submitOnboarding({
        client,
        catalog,
        submission,
        binding: createdProfileRef,
        setState,
        isCurrent,
        onConfigured: options.onConfigured,
      });
    } catch (reason) {
      if (
        !requestsRef.current.isCurrent(generation) ||
        options.client() !== client
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        phase: "ready",
        createdProfileId: createdProfileRef.current?.profileId ?? null,
        error: redactSecret(errorMessage(reason), apiKey),
      }));
    } finally {
      if (requestsRef.current.isCurrent(generation)) {
        submissionActiveRef.current = false;
      }
    }
  };

  return { state, prepare, reset, submit };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function redactSecret(message: string, secret: string): string {
  const redacted = secret ? message.replaceAll(secret, "[redacted]") : message;
  return redacted.slice(0, 1_000);
}
