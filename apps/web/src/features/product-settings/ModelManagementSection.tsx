/**
 * Provider rows and the one-card-at-a-time editor flow are adapted from
 * DeepSeek Harness ModelsSection.tsx, ProviderEditor.tsx, and
 * CustomProviderCard.tsx at revision
 * b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek. MIT License; see THIRD_PARTY_NOTICES.md.
 */
import { useId, useMemo, useState, type FormEvent } from "react";
import styles from "./ModelManagementSection.module.css";

export type ModelManagementState =
  | { status: "ready" }
  | { status: "loading"; message?: string }
  | { status: "error"; message: string }
  | { status: "unavailable"; message?: string };

export interface ModelApiProtocolOption {
  id: string;
  label: string;
}

export interface ModelProviderRoute {
  /** Stable Core route id, preserved while editing an existing row. */
  id: string;
  label: string;
  /** Empty asks Core to use its provider default. */
  baseUrl: string;
  /** Core-advertised wire protocol id. */
  apiProtocol: string;
  /** Environment-name reference Core uses for write-only credential storage. */
  apiKeyEnv: string;
}

export interface ModelCatalogSuggestion {
  id: string;
  label?: string;
  /** A catalog model may select a more specific endpoint route. */
  route?: ModelProviderRoute;
}

export type ModelCredentialRequirement = "required" | "optional" | "none";

export interface ModelProviderFamilyOption {
  id: string;
  label: string;
  models: readonly ModelCatalogSuggestion[];
  defaultRoute?: ModelProviderRoute;
  credentialRequirement: ModelCredentialRequirement;
  /** Custom gateways generally require a URL; native providers may not. */
  requiresBaseUrl?: boolean;
}

/**
 * Value-safe configured row. It deliberately carries only a credential
 * boolean, so a stored secret cannot be passed back into presentation.
 */
export interface ConfiguredModelProvider {
  id: string;
  familyId: string;
  familyLabel: string;
  modelId: string;
  modelLabel?: string;
  route: ModelProviderRoute;
  apiKeyConfigured: boolean;
  primary?: boolean;
  editable?: boolean;
  removable?: boolean;
  mutationUnavailableReason?: string;
}

/** Unsaved editor state. This component never persists apiKey. */
export interface ModelProviderDraft {
  familyId: string;
  modelId: string;
  route: ModelProviderRoute;
  /** Write-only replacement. Blank on edit means keep the configured key. */
  apiKey: string;
}

export interface ModelProviderSaveRequest {
  mode: "add" | "edit";
  /** Stable row id when replacing an existing provider configuration. */
  providerId?: string;
  draft: ModelProviderDraft;
}

export interface ModelManagementSectionProps {
  state: ModelManagementState;
  providers: readonly ConfiguredModelProvider[];
  families: readonly ModelProviderFamilyOption[];
  apiProtocols: readonly ModelApiProtocolOption[];
  locked?: boolean;
  onRetry?: () => void;
  /** Omit to render the provider directory as read-only. */
  onSave?: (request: ModelProviderSaveRequest) => Promise<void>;
  /** Omit when Core does not advertise provider testing. */
  onTestConnection?: (draft: ModelProviderDraft) => Promise<void>;
  /** Omit when Core does not advertise endpoint model discovery. */
  onFetchAvailableModels?: (
    draft: ModelProviderDraft,
  ) => Promise<readonly ModelCatalogSuggestion[]>;
  /** Omit when Core does not advertise provider deletion. */
  onDelete?: (provider: ConfiguredModelProvider) => Promise<void>;
}

export interface ModelProviderDraftIssue {
  field:
    | "familyId"
    | "modelId"
    | "routeId"
    | "routeLabel"
    | "baseUrl"
    | "apiProtocol"
    | "apiKeyEnv"
    | "apiKey";
  message: string;
}

type EditorAction = "testing" | "fetching" | "saving";
type Feedback = { tone: "success" | "error"; message: string };

interface OpenEditor {
  mode: "add" | "edit";
  providerId?: string;
  credentialConfigured: boolean;
  configuredApiKeyEnv?: string;
  draft: ModelProviderDraft;
  fetchedModels: readonly ModelCatalogSuggestion[];
}

interface DeleteConfirmation {
  provider: ConfiguredModelProvider;
  value: string;
  busy: boolean;
  failed: boolean;
}

const EMPTY_ROUTE: ModelProviderRoute = {
  id: "",
  label: "",
  baseUrl: "",
  apiProtocol: "",
  apiKeyEnv: "",
};

const GLM_FLASH_GUIDE_URL =
  "https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash";

/** Exact, case-sensitive phrase required before destructive removal. */
export function providerDeleteConfirmation(
  provider: ConfiguredModelProvider,
): string {
  return "DELETE " + provider.familyId + "/" + provider.modelId;
}

export function createModelProviderDraft(
  families: readonly ModelProviderFamilyOption[],
  apiProtocols: readonly ModelApiProtocolOption[],
  configuredProviders: readonly ConfiguredModelProvider[] = [],
): ModelProviderDraft {
  const available = families
    .flatMap((family) =>
      family.models.map((suggestion) => ({ family, suggestion })),
    )
    .find(({ family, suggestion }) => {
      const route = suggestion.route ?? family.defaultRoute;
      return !configuredProviders.some(
        (provider) =>
          provider.familyId === family.id &&
          provider.modelId === suggestion.id &&
          (!provider.route.id ||
            provider.route.id === (route?.id ?? family.id)),
      );
    });
  const family = available?.family ?? families[0];
  const suggestion = available?.suggestion;
  const route = suggestion?.route ?? family?.defaultRoute;
  return {
    familyId: family?.id ?? "",
    modelId: suggestion?.id ?? "",
    route: route
      ? { ...route }
      : {
          ...EMPTY_ROUTE,
          id: family?.id ?? "",
          label: family?.label ?? "",
          apiProtocol: apiProtocols[0]?.id ?? "",
        },
    apiKey: "",
  };
}

export function configuredProviderDraft(
  provider: ConfiguredModelProvider,
): ModelProviderDraft {
  return {
    familyId: provider.familyId,
    modelId: provider.modelId,
    route: { ...provider.route },
    // Credentials are write-only. Never synthesize bullets or a fake value.
    apiKey: "",
  };
}

export function validateModelProviderDraft(
  draft: ModelProviderDraft,
  options: {
    credentialConfigured: boolean;
    credentialRequirement: ModelCredentialRequirement;
    requiresBaseUrl: boolean;
    identityAvailable?: boolean;
  },
): readonly ModelProviderDraftIssue[] {
  const issues: ModelProviderDraftIssue[] = [];
  if (!draft.familyId.trim()) {
    issues.push({ field: "familyId", message: "Choose a provider family." });
  }
  if (!draft.modelId.trim()) {
    issues.push({ field: "modelId", message: "Enter a model ID." });
  } else if (options.identityAvailable === false) {
    issues.push({
      field: "modelId",
      message: "This model route already exists. Use Edit instead.",
    });
  }
  if (!draft.route.id.trim()) {
    issues.push({ field: "routeId", message: "Enter a route ID." });
  }
  if (!draft.route.label.trim()) {
    issues.push({ field: "routeLabel", message: "Enter a route label." });
  }
  const baseUrl = draft.route.baseUrl.trim();
  if (options.requiresBaseUrl && !baseUrl) {
    issues.push({ field: "baseUrl", message: "Enter a base URL." });
  } else if (baseUrl && !isHttpUrl(baseUrl)) {
    issues.push({
      field: "baseUrl",
      message: "Base URL must use http or https.",
    });
  }
  if (!draft.route.apiProtocol.trim()) {
    issues.push({
      field: "apiProtocol",
      message: "Choose an API protocol.",
    });
  }
  if (
    options.credentialRequirement !== "none" &&
    !draft.route.apiKeyEnv.trim()
  ) {
    issues.push({
      field: "apiKeyEnv",
      message: "Enter a credential environment name.",
    });
  }
  if (
    options.credentialRequirement === "required" &&
    !options.credentialConfigured &&
    !draft.apiKey.trim()
  ) {
    issues.push({ field: "apiKey", message: "Enter an API key." });
  }
  if (/\r|\n/.test(draft.apiKey)) {
    issues.push({
      field: "apiKey",
      message: "API key must be a single line.",
    });
  }
  return issues;
}

function probeIssues(
  issues: readonly ModelProviderDraftIssue[],
): readonly ModelProviderDraftIssue[] {
  return issues.filter(
    (issue) => issue.field !== "modelId" && issue.field !== "routeLabel",
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function providerName(provider: ConfiguredModelProvider): string {
  return provider.modelLabel?.trim() || provider.modelId;
}

function configuredIdentityExists(
  providers: readonly ConfiguredModelProvider[],
  editor: OpenEditor,
): boolean {
  const familyId = editor.draft.familyId.trim();
  const modelId = editor.draft.modelId.trim();
  const routeId = editor.draft.route.id.trim();
  return providers.some(
    (provider) =>
      provider.id !== editor.providerId &&
      provider.familyId === familyId &&
      provider.modelId === modelId &&
      (!provider.route.id || provider.route.id === routeId),
  );
}

function copyDraft(draft: ModelProviderDraft): ModelProviderDraft {
  return { ...draft, route: { ...draft.route } };
}

function draftCredentialConfigured(editor: OpenEditor): boolean {
  return (
    editor.credentialConfigured &&
    editor.configuredApiKeyEnv === editor.draft.route.apiKeyEnv
  );
}

function uniqueSuggestions(
  suggestions: readonly ModelCatalogSuggestion[],
): readonly ModelCatalogSuggestion[] {
  const seen = new Set<string>();
  const result: ModelCatalogSuggestion[] = [];
  for (const suggestion of suggestions) {
    const id = suggestion.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...suggestion, id });
    if (result.length === 100) break;
  }
  return result;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M7 2.2v9.6M2.2 7h9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CredentialIndicator({ configured }: { configured: boolean }) {
  return (
    <span className={styles.credentialStatus}>
      <span
        className={
          styles.credentialDot +
          " " +
          (configured ? styles.credentialConfigured : styles.credentialMissing)
        }
        aria-hidden="true"
      />
      {configured ? "Credential configured" : "Credential not configured"}
    </span>
  );
}

function SuggestionGroup({
  title,
  suggestions,
  selectedId,
  disabled,
  onChoose,
}: {
  title: string;
  suggestions: readonly ModelCatalogSuggestion[];
  selectedId: string;
  disabled: boolean;
  onChoose: (suggestion: ModelCatalogSuggestion) => void;
}) {
  return (
    <section className={styles.suggestionGroup} aria-label={title}>
      <div className={styles.suggestionHeading}>
        <h4>{title}</h4>
        <span>{suggestions.length}</span>
      </div>
      <ul className={styles.suggestionList}>
        {suggestions.map((suggestion, index) => {
          const selected = suggestion.id === selectedId;
          const routeKey = suggestion.route?.id ?? "default";
          return (
            <li key={suggestion.id + ":" + routeKey + ":" + String(index)}>
              <button
                type="button"
                className={
                  styles.suggestionButton +
                  " " +
                  (selected ? styles.suggestionSelected : "")
                }
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onChoose(suggestion)}
              >
                <span>{suggestion.label ?? suggestion.id}</span>
                {suggestion.label && suggestion.label !== suggestion.id ? (
                  <code>{suggestion.id}</code>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GlmFlashGuidance() {
  const guidance = [
    ["temperature", "1"],
    ["top_p", "0.95"],
    ["reasoning_effort", "max"],
    ["thinking.type", "enabled"],
    ["thinking.clear_thinking", "false"],
    ["stream + tool_stream", "true + true"],
  ] as const;
  return (
    <aside className={styles.guidance} aria-label="GLM-5.3-Flash guidance">
      <div className={styles.guidanceHeading}>
        <div>
          <strong>GLM-5.3-Flash recommended settings</strong>
          <span>Read-only provider guidance</span>
        </div>
        <a href={GLM_FLASH_GUIDE_URL} target="_blank" rel="noreferrer">
          Official guide
        </a>
      </div>
      <dl className={styles.guidanceGrid}>
        {guidance.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Z.AI requires thinking to stay enabled for this model and recommends
        preserving thinking across coding turns.
      </p>
    </aside>
  );
}

function ModelProviderEditor({
  editor,
  families,
  apiProtocols,
  locked,
  action,
  feedback,
  onChange,
  onCancel,
  onTest,
  onFetch,
  onSave,
  identityAvailable,
}: {
  editor: OpenEditor;
  families: readonly ModelProviderFamilyOption[];
  apiProtocols: readonly ModelApiProtocolOption[];
  locked: boolean;
  action: EditorAction | null;
  feedback: Feedback | null;
  onChange: (draft: ModelProviderDraft) => void;
  onCancel: () => void;
  onTest?: () => void;
  onFetch?: () => void;
  onSave: () => void;
  identityAvailable: boolean;
}) {
  const formId = useId();
  const selectedFamily = families.find(
    (family) => family.id === editor.draft.familyId,
  );
  const credentialRequirement =
    selectedFamily?.credentialRequirement ?? "optional";
  const requiresBaseUrl = selectedFamily?.requiresBaseUrl ?? !selectedFamily;
  const credentialConfigured = draftCredentialConfigured(editor);
  const issues = validateModelProviderDraft(editor.draft, {
    credentialConfigured,
    credentialRequirement,
    requiresBaseUrl,
    identityAvailable,
  });
  const issueFor = (field: ModelProviderDraftIssue["field"]) =>
    issues.find((issue) => issue.field === field)?.message;
  const catalogModels = selectedFamily?.models ?? [];
  const allSuggestions = uniqueSuggestions([
    ...catalogModels,
    ...editor.fetchedModels,
  ]);
  const protocolOptions = apiProtocols.some(
    (option) => option.id === editor.draft.route.apiProtocol,
  )
    ? apiProtocols
    : editor.draft.route.apiProtocol
      ? [
          ...apiProtocols,
          {
            id: editor.draft.route.apiProtocol,
            label: editor.draft.route.apiProtocol,
          },
        ]
      : apiProtocols;
  const busy = action !== null;
  const disabled = locked || busy;
  const apiKeyHintId = formId + "-api-key-hint";
  const endpointIssues = probeIssues(issues);

  const update = (patch: Partial<ModelProviderDraft>) => {
    onChange({ ...editor.draft, ...patch });
  };
  const updateRoute = (patch: Partial<ModelProviderRoute>) => {
    update({ route: { ...editor.draft.route, ...patch } });
  };
  const chooseFamily = (familyId: string) => {
    const family = families.find((candidate) => candidate.id === familyId);
    const suggestion = family?.models[0];
    const catalogRoute = suggestion?.route ?? family?.defaultRoute;
    update({
      familyId,
      modelId: suggestion?.id ?? "",
      // A key typed for another provider must never follow the identity switch.
      apiKey: "",
      route: catalogRoute
        ? { ...catalogRoute }
        : {
            ...editor.draft.route,
            id: familyId,
            label: family?.label ?? familyId,
          },
    });
  };
  const chooseSuggestion = (suggestion: ModelCatalogSuggestion) => {
    const credentialChanged =
      suggestion.route !== undefined &&
      suggestion.route.apiKeyEnv !== editor.draft.route.apiKeyEnv;
    update({
      modelId: suggestion.id,
      ...(credentialChanged ? { apiKey: "" } : {}),
      ...(suggestion.route ? { route: { ...suggestion.route } } : {}),
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && issues.length === 0) onSave();
  };

  return (
    <form
      className={styles.editor}
      aria-label={
        editor.mode === "add" ? "Add model provider" : "Edit model provider"
      }
      aria-busy={busy}
      onSubmit={submit}
    >
      <div className={styles.editorHeading}>
        <div>
          <h3 className={styles.editorTitle}>
            {editor.mode === "add" ? "Add provider" : "Provider settings"}
          </h3>
          <p className={styles.editorIntro}>
            Configure one Core model identity, endpoint route, and write-only
            credential.
          </p>
        </div>
        {editor.mode === "edit" ? (
          <CredentialIndicator configured={credentialConfigured} />
        ) : null}
      </div>

      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Provider / family ID</span>
          <input
            className={styles.input}
            type="text"
            list={formId + "-families"}
            value={editor.draft.familyId}
            disabled={disabled || editor.mode === "edit"}
            aria-invalid={Boolean(issueFor("familyId")) || undefined}
            onChange={(event) => chooseFamily(event.target.value)}
          />
          <datalist id={formId + "-families"}>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.label}
              </option>
            ))}
          </datalist>
          {editor.mode === "edit" ? (
            <span className={styles.fieldHint}>
              Provider identity is fixed. Add another provider to change it.
            </span>
          ) : null}
          {issueFor("familyId") ? (
            <span className={styles.fieldError}>{issueFor("familyId")}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Model ID</span>
          <input
            className={styles.input + " " + styles.codeInput}
            type="text"
            list={formId + "-models"}
            value={editor.draft.modelId}
            disabled={disabled || editor.mode === "edit"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(issueFor("modelId")) || undefined}
            onChange={(event) => update({ modelId: event.target.value })}
          />
          <datalist id={formId + "-models"}>
            {allSuggestions.map((suggestion) => (
              <option key={suggestion.id} value={suggestion.id}>
                {suggestion.label ?? suggestion.id}
              </option>
            ))}
          </datalist>
          {issueFor("modelId") ? (
            <span className={styles.fieldError}>{issueFor("modelId")}</span>
          ) : null}
          {editor.mode === "edit" ? (
            <span className={styles.fieldHint}>
              Model identity is fixed. Add the new model, switch the profile
              default, then delete this route.
            </span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Route ID</span>
          <input
            className={styles.input + " " + styles.codeInput}
            type="text"
            value={editor.draft.route.id}
            disabled={disabled || editor.mode === "edit"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(issueFor("routeId")) || undefined}
            onChange={(event) => updateRoute({ id: event.target.value })}
          />
          {editor.mode === "edit" ? (
            <span className={styles.fieldHint}>
              Route identity is fixed for existing configurations.
            </span>
          ) : null}
          {issueFor("routeId") ? (
            <span className={styles.fieldError}>{issueFor("routeId")}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Route label</span>
          <input
            className={styles.input}
            type="text"
            value={editor.draft.route.label}
            disabled={disabled}
            aria-invalid={Boolean(issueFor("routeLabel")) || undefined}
            onChange={(event) => updateRoute({ label: event.target.value })}
          />
          {issueFor("routeLabel") ? (
            <span className={styles.fieldError}>{issueFor("routeLabel")}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>API protocol</span>
          <select
            className={styles.input + " " + styles.selectInput}
            value={editor.draft.route.apiProtocol}
            disabled={disabled}
            aria-invalid={Boolean(issueFor("apiProtocol")) || undefined}
            onChange={(event) =>
              updateRoute({ apiProtocol: event.target.value })
            }
          >
            {!editor.draft.route.apiProtocol ? (
              <option value="">Choose a protocol</option>
            ) : null}
            {protocolOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {issueFor("apiProtocol") ? (
            <span className={styles.fieldError}>{issueFor("apiProtocol")}</span>
          ) : null}
        </label>

        {credentialRequirement !== "none" ? (
          <label className={styles.field + " " + styles.wideField}>
            <span className={styles.fieldLabel}>Credential environment</span>
            <input
              className={styles.input + " " + styles.codeInput}
              type="text"
              value={editor.draft.route.apiKeyEnv}
              disabled={disabled}
              placeholder="ZAI_API_KEY"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(issueFor("apiKeyEnv")) || undefined}
              onChange={(event) =>
                updateRoute({ apiKeyEnv: event.target.value })
              }
            />
            {issueFor("apiKeyEnv") ? (
              <span className={styles.fieldError}>{issueFor("apiKeyEnv")}</span>
            ) : (
              <span className={styles.fieldHint}>
                Core stores the write-only key under this environment-name
                reference; the value itself is never read back.
              </span>
            )}
          </label>
        ) : null}

        <label className={styles.field + " " + styles.wideField}>
          <span className={styles.fieldLabel}>Base URL</span>
          <input
            className={styles.input + " " + styles.codeInput}
            type="url"
            value={editor.draft.route.baseUrl}
            disabled={disabled}
            placeholder={
              requiresBaseUrl
                ? "https://provider.example/v1"
                : "Provider default"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(issueFor("baseUrl")) || undefined}
            onChange={(event) => updateRoute({ baseUrl: event.target.value })}
          />
          {issueFor("baseUrl") ? (
            <span className={styles.fieldError}>{issueFor("baseUrl")}</span>
          ) : (
            <span className={styles.fieldHint}>
              Model discovery tests the unsaved endpoint shown here.
            </span>
          )}
        </label>

        {credentialRequirement === "none" ? (
          <div className={styles.field + " " + styles.wideField}>
            <span className={styles.fieldLabel}>API key</span>
            <div className={styles.credentialNone}>
              This provider uses its native or local authentication path.
            </div>
          </div>
        ) : (
          <label className={styles.field + " " + styles.wideField}>
            <span className={styles.fieldLabel}>API key</span>
            <input
              className={styles.input + " " + styles.codeInput}
              type="password"
              value={editor.draft.apiKey}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={apiKeyHintId}
              aria-invalid={Boolean(issueFor("apiKey")) || undefined}
              placeholder={
                credentialConfigured
                  ? "Leave blank to keep the configured key"
                  : "Enter API key"
              }
              onChange={(event) => update({ apiKey: event.target.value })}
            />
            <span id={apiKeyHintId} className={styles.fieldHint}>
              {credentialConfigured
                ? "Configured. Enter a value only to replace it; the stored key is never read back."
                : "Write-only. Sent to Core only when you test, fetch, or save."}
            </span>
            {issueFor("apiKey") ? (
              <span className={styles.fieldError}>{issueFor("apiKey")}</span>
            ) : null}
          </label>
        )}
      </div>

      {catalogModels.length || editor.fetchedModels.length ? (
        <div className={styles.suggestions} aria-label="Model suggestions">
          {catalogModels.length ? (
            <SuggestionGroup
              title="Provider catalog"
              suggestions={catalogModels}
              selectedId={editor.draft.modelId}
              disabled={disabled}
              onChoose={chooseSuggestion}
            />
          ) : null}
          {editor.fetchedModels.length ? (
            <SuggestionGroup
              title="Available from endpoint"
              suggestions={editor.fetchedModels}
              selectedId={editor.draft.modelId}
              disabled={disabled}
              onChoose={chooseSuggestion}
            />
          ) : null}
        </div>
      ) : null}

      <div className={styles.parameterBoundary}>
        <strong>Model request parameters</strong>
        <p>
          Octos Core currently stores model identity, route, and credential
          only. Request parameters are read-only guidance here until Core
          advertises a writable parameter schema.
        </p>
      </div>

      {editor.draft.modelId.trim().toLowerCase() === "glm-5.3-flash" ? (
        <GlmFlashGuidance />
      ) : null}

      {feedback ? (
        <div
          className={
            feedback.tone === "error"
              ? styles.operationError
              : styles.operationSuccess
          }
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.message}
        </div>
      ) : null}

      {issues.length ? (
        <p className={styles.validationHint}>
          Complete the required provider fields to save.
        </p>
      ) : null}

      <div className={styles.editorFooter}>
        <div className={styles.probeActions}>
          {onTest ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled || issues.length > 0}
              onClick={onTest}
            >
              {action === "testing" ? "Testing…" : "Test connection"}
            </button>
          ) : null}
          {onFetch ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled || endpointIssues.length > 0}
              onClick={onFetch}
            >
              {action === "fetching" ? "Fetching…" : "Fetch available models"}
            </button>
          ) : null}
        </div>
        <div className={styles.commitActions}>
          <button
            type="button"
            className={styles.textButton}
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={disabled || issues.length > 0}
          >
            {action === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

function DeleteProviderDialog({
  confirmation,
  onChange,
  onCancel,
  onConfirm,
}: {
  confirmation: DeleteConfirmation;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const phrase = providerDeleteConfirmation(confirmation.provider);
  const matches = confirmation.value === phrase;
  return (
    <div className={styles.dialogBackdrop}>
      <div
        className={styles.deleteDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={confirmation.busy}
      >
        <h3 id={titleId}>Delete model provider?</h3>
        <p id={descriptionId}>
          This removes the configured route for{" "}
          <strong>{providerName(confirmation.provider)}</strong>. Existing
          sessions may still refer to it.
        </p>
        <label className={styles.deleteField}>
          <span>
            Type <code>{phrase}</code> to confirm
          </span>
          <input
            className={styles.input + " " + styles.codeInput}
            type="text"
            value={confirmation.value}
            disabled={confirmation.busy}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        {confirmation.failed ? (
          <p className={styles.operationError} role="alert">
            Could not delete this provider. The configuration was kept; try
            again.
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.textButton}
            disabled={confirmation.busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.deleteButton}
            disabled={!matches || confirmation.busy}
            onClick={onConfirm}
          >
            {confirmation.busy ? "Deleting…" : "Delete provider"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModelManagementSection({
  state,
  providers,
  families,
  apiProtocols,
  locked = false,
  onRetry,
  onSave,
  onTestConnection,
  onFetchAvailableModels,
  onDelete,
}: ModelManagementSectionProps) {
  const headingId = useId();
  const [editor, setEditor] = useState<OpenEditor | null>(null);
  const [editorAction, setEditorAction] = useState<EditorAction | null>(null);
  const [editorFeedback, setEditorFeedback] = useState<Feedback | null>(null);
  const [sectionFeedback, setSectionFeedback] = useState<Feedback | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);

  const setDraft = (draft: ModelProviderDraft) => {
    setEditor((current) => (current ? { ...current, draft } : current));
    setEditorFeedback(null);
  };

  const openAdd = () => {
    setEditor({
      mode: "add",
      credentialConfigured: false,
      draft: createModelProviderDraft(families, apiProtocols, providers),
      fetchedModels: [],
    });
    setEditorFeedback(null);
    setSectionFeedback(null);
  };

  const openEdit = (provider: ConfiguredModelProvider) => {
    setEditor({
      mode: "edit",
      providerId: provider.id,
      credentialConfigured: provider.apiKeyConfigured,
      configuredApiKeyEnv: provider.route.apiKeyEnv,
      draft: configuredProviderDraft(provider),
      fetchedModels: [],
    });
    setEditorFeedback(null);
    setSectionFeedback(null);
  };

  const validCurrentDraft = (): ModelProviderDraft | null => {
    if (!editor) return null;
    const family = families.find(
      (candidate) => candidate.id === editor.draft.familyId,
    );
    const requirements = {
      credentialConfigured: draftCredentialConfigured(editor),
      credentialRequirement: family?.credentialRequirement ?? "optional",
      requiresBaseUrl: family?.requiresBaseUrl ?? !family,
      identityAvailable:
        editor.mode === "edit" || !configuredIdentityExists(providers, editor),
    } satisfies Parameters<typeof validateModelProviderDraft>[1];
    return validateModelProviderDraft(editor.draft, requirements).length
      ? null
      : copyDraft(editor.draft);
  };

  const validProbeDraft = (): ModelProviderDraft | null => {
    if (!editor) return null;
    const family = families.find(
      (candidate) => candidate.id === editor.draft.familyId,
    );
    const requirements = {
      credentialConfigured: draftCredentialConfigured(editor),
      credentialRequirement: family?.credentialRequirement ?? "optional",
      requiresBaseUrl: family?.requiresBaseUrl ?? !family,
    } satisfies Parameters<typeof validateModelProviderDraft>[1];
    return probeIssues(validateModelProviderDraft(editor.draft, requirements))
      .length
      ? null
      : copyDraft(editor.draft);
  };

  const testConnection = async () => {
    const draft = validCurrentDraft();
    if (!draft || !onTestConnection || editorAction) return;
    setEditorAction("testing");
    setEditorFeedback(null);
    try {
      await onTestConnection(draft);
      setEditorFeedback({ tone: "success", message: "Connection succeeded." });
    } catch {
      // Provider errors may echo submitted secrets, so render fixed copy only.
      setEditorFeedback({
        tone: "error",
        message:
          "Connection failed. Check the endpoint, protocol, model, and credential.",
      });
    } finally {
      setEditorAction(null);
    }
  };

  const fetchModels = async () => {
    const draft = validProbeDraft();
    if (!draft || !onFetchAvailableModels || editorAction) return;
    setEditorAction("fetching");
    setEditorFeedback(null);
    try {
      const fetchedModels = uniqueSuggestions(
        await onFetchAvailableModels(draft),
      );
      setEditor((current) =>
        current ? { ...current, fetchedModels } : current,
      );
      setEditorFeedback({
        tone: "success",
        message: fetchedModels.length
          ? String(fetchedModels.length) + " available models found."
          : "The endpoint returned no models.",
      });
    } catch {
      setEditorFeedback({
        tone: "error",
        message:
          "Could not fetch available models. The unsaved provider draft was kept.",
      });
    } finally {
      setEditorAction(null);
    }
  };

  const save = async () => {
    const draft = validCurrentDraft();
    if (!draft || !editor || !onSave || editorAction) return;
    const request: ModelProviderSaveRequest = {
      mode: editor.mode,
      ...(editor.providerId ? { providerId: editor.providerId } : {}),
      draft,
    };
    const replacesConfiguredRoute = editor.mode === "edit";
    setEditorAction("saving");
    setEditorFeedback(null);
    try {
      await onSave(request);
      setEditor(null);
      setSectionFeedback({
        tone: "success",
        message: replacesConfiguredRoute
          ? "Provider saved. Restart Octos before relying on this route or credential change."
          : "Provider saved.",
      });
    } catch {
      setEditorFeedback({
        tone: "error",
        message: "Could not save this provider. The unsaved draft was kept.",
      });
    } finally {
      setEditorAction(null);
    }
  };

  const confirmDelete = async () => {
    if (
      !deleteConfirmation ||
      !onDelete ||
      deleteConfirmation.busy ||
      deleteConfirmation.value !==
        providerDeleteConfirmation(deleteConfirmation.provider)
    ) {
      return;
    }
    const provider = deleteConfirmation.provider;
    setDeleteConfirmation((current) =>
      current ? { ...current, busy: true, failed: false } : current,
    );
    try {
      await onDelete(provider);
      setDeleteConfirmation(null);
      setSectionFeedback({
        tone: "success",
        message:
          "Provider deleted. Restart Octos before relying on the updated runtime policy.",
      });
    } catch {
      setDeleteConfirmation((current) =>
        current ? { ...current, busy: false, failed: true } : current,
      );
    }
  };

  const statusContent = useMemo(() => {
    if (state.status === "loading") {
      return (
        <div className={styles.stateNotice} role="status" aria-live="polite">
          {state.message ?? "Loading model providers…"}
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div className={styles.stateError} role="alert">
          <span>{state.message}</span>
          {onRetry ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      );
    }
    if (state.status === "unavailable") {
      return (
        <div className={styles.stateNotice} role="status">
          {state.message ??
            "This Octos server does not advertise provider management."}
        </div>
      );
    }
    return null;
  }, [onRetry, state]);

  const editorProps = editor
    ? {
        editor,
        families,
        apiProtocols,
        locked,
        action: editorAction,
        feedback: editorFeedback,
        identityAvailable:
          editor.mode === "edit" ||
          !configuredIdentityExists(providers, editor),
        onChange: setDraft,
        onCancel: () => {
          setEditor(null);
          setEditorFeedback(null);
        },
        ...(onTestConnection ? { onTest: () => void testConnection() } : {}),
        ...(onFetchAvailableModels
          ? { onFetch: () => void fetchModels() }
          : {}),
        onSave: () => void save(),
      }
    : null;

  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      aria-busy={state.status === "loading"}
      data-model-management="providers"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id={headingId}>Model providers</h2>
          <p>
            Manage the active profile’s provider routes and credentials. Model
            selection and the current Session runtime remain separate.
          </p>
        </div>
        {state.status === "ready" && onSave ? (
          <button
            type="button"
            className={styles.addButton}
            disabled={locked || Boolean(editor)}
            onClick={openAdd}
          >
            <PlusIcon />
            Add provider
          </button>
        ) : null}
      </div>

      {!onSave && state.status === "ready" ? (
        <div className={styles.readOnlyNotice} role="status">
          Provider configuration is read-only on this server.
        </div>
      ) : null}

      {state.status === "ready" && (onSave || onDelete) ? (
        <div className={styles.runtimeWarning} role="note">
          Provider changes update the saved Profile configuration. Restart Octos
          before relying on route or credential changes in an already
          bootstrapped runtime.
        </div>
      ) : null}

      {sectionFeedback ? (
        <div
          className={
            sectionFeedback.tone === "error"
              ? styles.operationError
              : styles.operationSuccess
          }
          role={sectionFeedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {sectionFeedback.message}
        </div>
      ) : null}

      {statusContent}

      {state.status === "ready" ? (
        <>
          {providers.length ? (
            <ul
              className={styles.providerRows}
              aria-label="Configured providers"
            >
              {providers.map((provider) => {
                const open =
                  editor?.mode === "edit" && editor.providerId === provider.id;
                return (
                  <li className={styles.providerCard} key={provider.id}>
                    <div className={styles.providerRow}>
                      <div className={styles.providerIdentity}>
                        <div className={styles.providerTitleLine}>
                          <strong>{providerName(provider)}</strong>
                          {provider.primary ? (
                            <span className={styles.primaryTag}>Primary</span>
                          ) : null}
                        </div>
                        <span className={styles.providerMeta}>
                          {provider.familyLabel} · {provider.route.label}
                        </span>
                        <span className={styles.providerEndpoint}>
                          <code>{provider.modelId}</code>
                          {provider.route.apiProtocol ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <code>{provider.route.apiProtocol}</code>
                            </>
                          ) : null}
                          {provider.route.baseUrl ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{provider.route.baseUrl}</span>
                            </>
                          ) : null}
                        </span>
                        {provider.mutationUnavailableReason ? (
                          <span className={styles.providerMutationWarning}>
                            {provider.mutationUnavailableReason}
                          </span>
                        ) : null}
                      </div>
                      <CredentialIndicator
                        configured={provider.apiKeyConfigured}
                      />
                      <div className={styles.rowActions}>
                        {onSave && provider.editable !== false ? (
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={locked || Boolean(editor)}
                            aria-label={"Edit " + providerName(provider)}
                            onClick={() => openEdit(provider)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {onDelete && provider.removable !== false ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={locked || Boolean(editor)}
                            aria-label={"Delete " + providerName(provider)}
                            onClick={() => {
                              setDeleteConfirmation({
                                provider,
                                value: "",
                                busy: false,
                                failed: false,
                              });
                              setSectionFeedback(null);
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {open && editorProps ? (
                      <ModelProviderEditor {...editorProps} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              <strong>No model providers configured</strong>
              <span>
                Add a provider route to make a model available to Core.
              </span>
            </div>
          )}

          {editor?.mode === "add" && editorProps ? (
            <ModelProviderEditor {...editorProps} />
          ) : null}
        </>
      ) : null}

      {deleteConfirmation ? (
        <DeleteProviderDialog
          confirmation={deleteConfirmation}
          onChange={(value) =>
            setDeleteConfirmation((current) =>
              current ? { ...current, value, failed: false } : current,
            )
          }
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  );
}
