import { useEffect, useState } from "react";
import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type LlmCatalogResult,
  type OctosUiClient,
  type ProfileLlmConfigResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";

export interface ModelFactSources {
  catalog: LlmCatalogResult | null;
  config: ProfileLlmConfigResult;
}

/**
 * The two server answers model facts are read from. Neither blocks anything:
 * until both are in for this client and profile there are no facts, and a
 * failed read leaves the selector as it is. A configuration that could not be
 * read yields none at all, because it may override what the catalog says.
 */
export function useModelFactSources(options: {
  client: OctosUiClient | null;
  capabilities: UiProtocolCapabilities | undefined;
  profileId: string;
  /** A new list means the configuration may have changed: read it again. */
  models: unknown;
}): ModelFactSources | null {
  const { client, capabilities, profileId, models } = options;
  const canList = supportsMethod(
    capabilities,
    APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
  );
  const canReadCatalog = supportsMethod(
    capabilities,
    APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
  );
  const [catalog, setCatalog] = useState<{
    client: OctosUiClient;
    result: LlmCatalogResult | null;
  } | null>(null);
  const [config, setConfig] = useState<{
    client: OctosUiClient;
    result: ProfileLlmConfigResult;
  } | null>(null);

  useEffect(() => {
    if (!client || !canReadCatalog) return;
    let current = true;
    client.getLlmCatalog().then(
      (result) => {
        if (current) setCatalog({ client, result });
      },
      () => {
        if (current) setCatalog({ client, result: null });
      },
    );
    return () => {
      current = false;
    };
  }, [client, canReadCatalog]);

  useEffect(() => {
    if (!client || !canList || !profileId) return;
    let current = true;
    client.readProfileLlmConfig({ profile_id: profileId }).then(
      (result) => {
        if (current) setConfig({ client, result });
      },
      () => {
        if (current) setConfig(null);
      },
    );
    return () => {
      current = false;
    };
  }, [client, canList, profileId, models]);

  if (!client || config?.client !== client) return null;
  // Every read carries its profile, so an older answer can never pass for this one.
  if (config.result.profile_id !== profileId) return null;
  if (!canReadCatalog) return { catalog: null, config: config.result };
  if (catalog?.client !== client) return null;
  return { catalog: catalog.result, config: config.result };
}
