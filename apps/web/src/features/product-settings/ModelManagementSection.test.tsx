import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ModelManagementSection,
  configuredProviderDraft,
  createModelProviderDraft,
  providerDeleteConfirmation,
  validateModelProviderDraft,
  type ConfiguredModelProvider,
  type ModelProviderFamilyOption,
} from "./ModelManagementSection.tsx";

const families: readonly ModelProviderFamilyOption[] = [
  {
    id: "zai",
    label: "Z.AI",
    credentialRequirement: "required",
    requiresBaseUrl: true,
    defaultRoute: {
      id: "coding-plan",
      label: "Z.AI Coding Plan",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiProtocol: "openai-chat-completions",
      apiKeyEnv: "ZAI_API_KEY",
    },
    models: [
      {
        id: "glm-5.3-flash",
        label: "GLM-5.3-Flash",
        route: {
          id: "coding-plan",
          label: "Z.AI Coding Plan",
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
          apiProtocol: "openai-chat-completions",
          apiKeyEnv: "ZAI_API_KEY",
        },
      },
    ],
  },
];

const provider: ConfiguredModelProvider = {
  id: "zai:glm-5.3-flash:coding-plan",
  familyId: "zai",
  familyLabel: "Z.AI",
  modelId: "glm-5.3-flash",
  modelLabel: "GLM-5.3-Flash",
  route: {
    id: "coding-plan",
    label: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    apiProtocol: "openai-chat-completions",
    apiKeyEnv: "ZAI_API_KEY",
  },
  apiKeyConfigured: true,
  primary: true,
};

const protocols = [
  { id: "openai-chat-completions", label: "OpenAI Chat Completions" },
] as const;

describe("ModelManagementSection", () => {
  it("renders configured facts without manufacturing a credential", () => {
    const html = renderToStaticMarkup(
      <ModelManagementSection
        state={{ status: "ready" }}
        providers={[provider]}
        families={families}
        apiProtocols={protocols}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
        onFetchAvailableModels={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("Model providers");
    expect(html).toContain("GLM-5.3-Flash");
    expect(html).toContain("Z.AI Coding Plan");
    expect(html).toContain("Credential configured");
    expect(html).toContain("Add provider");
    expect(html).toContain("Edit GLM-5.3-Flash");
    expect(html).toContain("Delete GLM-5.3-Flash");
    expect(html).toContain(
      "Restart Octos before relying on route or credential changes",
    );
    expect(html).not.toContain("••••");
    expect(html).not.toContain("********");
    expect(html).not.toContain("sk-");
  });

  it("fails closed into read-only and accessible capability states", () => {
    const readOnly = renderToStaticMarkup(
      <ModelManagementSection
        state={{ status: "ready" }}
        providers={[provider]}
        families={families}
        apiProtocols={protocols}
      />,
    );
    const loading = renderToStaticMarkup(
      <ModelManagementSection
        state={{ status: "loading" }}
        providers={[]}
        families={[]}
        apiProtocols={[]}
      />,
    );
    const failed = renderToStaticMarkup(
      <ModelManagementSection
        state={{ status: "error", message: "Provider catalog timed out" }}
        providers={[]}
        families={[]}
        apiProtocols={[]}
        onRetry={vi.fn()}
      />,
    );

    expect(readOnly).toContain("Provider configuration is read-only");
    expect(readOnly).not.toContain("Add provider");
    expect(readOnly).not.toContain("Edit GLM-5.3-Flash");
    expect(readOnly).not.toContain("Delete GLM-5.3-Flash");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading model providers");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Provider catalog timed out");
    expect(failed).toContain("Try again");
  });
});

describe("model provider draft boundary", () => {
  it("starts from catalog identity and keeps API keys write-only", () => {
    const created = createModelProviderDraft(families, protocols);
    const edited = configuredProviderDraft(provider);

    expect(created).toMatchObject({
      familyId: "zai",
      modelId: "glm-5.3-flash",
      route: {
        id: "coding-plan",
        apiProtocol: "openai-chat-completions",
        apiKeyEnv: "ZAI_API_KEY",
      },
      apiKey: "",
    });
    expect(edited.apiKey).toBe("");
    expect(edited.route).not.toBe(provider.route);
  });

  it("never presents an existing Core model identity as a new provider", () => {
    const created = createModelProviderDraft(families, protocols, [provider]);

    expect(created.familyId).toBe("zai");
    expect(created.modelId).toBe("");
    expect(created.route.id).toBe("coding-plan");
    expect(
      validateModelProviderDraft(configuredProviderDraft(provider), {
        credentialConfigured: true,
        credentialRequirement: "required",
        requiresBaseUrl: true,
        identityAvailable: false,
      }),
    ).toContainEqual({
      field: "modelId",
      message: "This model route already exists. Use Edit instead.",
    });
  });

  it("validates Core identity, route, and credential without fake parameters", () => {
    const draft = createModelProviderDraft(families, protocols);
    expect(
      validateModelProviderDraft(draft, {
        credentialConfigured: false,
        credentialRequirement: "required",
        requiresBaseUrl: true,
      }),
    ).toEqual([{ field: "apiKey", message: "Enter an API key." }]);

    expect(
      validateModelProviderDraft(
        { ...draft, apiKey: "temporary-browser-draft" },
        {
          credentialConfigured: false,
          credentialRequirement: "required",
          requiresBaseUrl: true,
        },
      ),
    ).toEqual([]);
  });

  it("requires exact deletion against the immutable provider identity", () => {
    expect(providerDeleteConfirmation(provider)).toBe(
      "DELETE zai/glm-5.3-flash",
    );
    expect(providerDeleteConfirmation(provider)).not.toBe(
      "delete zai/glm-5.3-flash",
    );
  });
});
