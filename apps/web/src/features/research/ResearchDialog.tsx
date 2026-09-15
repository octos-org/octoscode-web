import { useEffect, useRef, useState } from "react";
import {
  APPUI_RESEARCH_METHODS,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  ResearchLane,
  ResearchLanes,
  ResearchLaneMutation,
} from "@octos-org/octoscode-client/research";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./ResearchDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

const emptyLane: ResearchLane = {
  key: "",
  provider: "",
  model: null,
  apiKeyEnv: null,
  baseUrl: null,
  description: null,
  contextWindow: null,
  maxOutputTokens: null,
  apiType: null,
};
type Confirmation =
  { kind: "save"; lane: ResearchLane } | { kind: "remove"; key: string };
export function ResearchDialog({
  client,
  profileId,
  capabilities,
  profileBusy,
  onMutationStart,
  onClose,
}: {
  client: OctosUiClient;
  profileId: string;
  capabilities: UiProtocolCapabilities;
  profileBusy: boolean;
  onMutationStart: () => () => void;
  onClose: () => void;
}) {
  const t = useUiText();
  const [data, setData] = useState<ResearchLanes | null>(null);
  const [draft, setDraft] = useState<ResearchLane>(emptyLane);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const blocked = useRef(profileBusy);
  blocked.current = profileBusy;
  const available = (method: string) => supportsMethod(capabilities, method);
  async function run(
    work: (
      commands: Awaited<ReturnType<OctosUiClient["researchCommands"]>>,
      current: () => boolean,
    ) => Promise<void>,
    mutation = false,
  ) {
    if (pending.current || (mutation && blocked.current)) return;
    pending.current = true;
    const ticket = generation.current;
    const current = () => ticket === generation.current;
    setBusy(true);
    setError(null);
    let release: (() => void) | undefined;
    try {
      const commands = await client.researchCommands(profileId, capabilities);
      if (!current() || (mutation && blocked.current)) return;
      if (mutation) {
        release = onMutationStart();
        setMutating(true);
      }
      await work(commands, current);
    } catch (cause) {
      if (current())
        setError(
          (mutation
            ? "Could not confirm the server change. It may have been applied; refresh before a new attempt and re-enter any credential."
            : cause instanceof Error
              ? cause.message
              : "Research request failed"
          ).slice(0, 512),
        );
    } finally {
      release?.();
      if (current()) {
        pending.current = false;
        setBusy(false);
        setMutating(false);
      }
    }
  }
  const refresh = () =>
    run(async (commands, current) => {
      const result = await commands.list();
      if (current()) setData(result);
    });
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    void refresh();
    return () => {
      generation.current += 1;
    };
    // App keys this surface by the full confirmed authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, profileId]);
  function resetCredential() {
    if (passwordInput.current) passwordInput.current.value = "";
  }
  function recordMutation(result: ResearchLaneMutation) {
    setData(result);
    setConfirmation(null);
    setNotice(
      result.restartRequired
        ? "Saved on the server. A serve restart is required before these research lanes become effective. No restart was performed."
        : result.applied
          ? "Saved on the server; the server reports no restart requirement."
          : "No server configuration change was applied.",
    );
  }
  function confirm() {
    const choice = confirmation;
    if (!choice) return;
    void run(async (commands, current) => {
      // Read the credential only at dispatch, then immediately clear the input.
      // It is never a React state field, storage item, or confirmation payload.
      const secret =
        choice.kind === "save" ? passwordInput.current?.value : undefined;
      resetCredential();
      setConfirmation(null);
      const result =
        choice.kind === "save"
          ? await commands.upsert(choice.lane, secret || undefined)
          : await commands.remove(choice.key);
      if (current()) recordMutation(result);
    }, true);
  }
  function field(
    key: keyof Pick<
      ResearchLane,
      "model" | "apiKeyEnv" | "baseUrl" | "description" | "apiType"
    >,
    label: string,
  ) {
    return (
      <label>
        {t(label)}
        <input
          value={draft[key] ?? ""}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, [key]: event.target.value || null })
          }
        />
      </label>
    );
  }
  function countField(key: "contextWindow" | "maxOutputTokens", label: string) {
    return (
      <label>
        {t(label)}
        <input
          type="number"
          min="0"
          max="4294967295"
          step="1"
          value={draft[key] ?? ""}
          disabled={busy}
          onChange={(event) =>
            setDraft({
              ...draft,
              [key]:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </label>
    );
  }

  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="research-title"
      onEscape={() => {
        if (!mutating) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="research-title">{t("Research provider lanes")}</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {t("Refresh lanes")}
        </button>
        <button type="button" disabled={mutating} onClick={onClose}>
          {t("Close research lanes")}
        </button>
      </header>
      <p className={styles.scope}>
        {t("Server Profile:") + " "}
        {profileId}
      </p>
      <p>
        {t(
          "Named provider routes for the server research pipeline. This is not a separate browser agent loop. Provider identity and API style are separate fields.",
        )}
      </p>
      {profileBusy ? (
        <p role="status">
          {t(
            "Configuration changes are paused while known Profile work is running.",
          )}
        </p>
      ) : null}
      {busy ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{t(notice)}</p> : null}
      {data?.lanes.length === 0 ? (
        <p>{t("No research lanes configured in this Profile.")}</p>
      ) : null}
      <div className={styles.rows}>
        {data?.lanes.map((lane) => (
          <article key={lane.key}>
            <h3>{lane.key}</h3>
            <p>
              {lane.provider} · {lane.model ?? t("Model not specified")}
            </p>
            <p>
              {t("API style:") + " "}
              {lane.apiType ?? t("Provider default")}
            </p>
            {lane.description ? <p>{lane.description}</p> : null}
            {available(APPUI_RESEARCH_METHODS.UPSERT) ? (
              <button
                type="button"
                disabled={busy || profileBusy}
                onClick={() => {
                  resetCredential();
                  setDraft({ ...lane });
                  setConfirmation(null);
                }}
              >
                {t("Edit") + " "}
                {lane.key}
              </button>
            ) : null}
            {available(APPUI_RESEARCH_METHODS.REMOVE) ? (
              <button
                type="button"
                disabled={busy || profileBusy}
                onClick={() => {
                  resetCredential();
                  setConfirmation({ kind: "remove", key: lane.key });
                }}
              >
                {t("Remove") + " "}
                {lane.key}
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {available(APPUI_RESEARCH_METHODS.UPSERT) ? (
        <section>
          <h3>{t("Add or replace a lane")}</h3>
          <p>
            {t(
              "Saving an existing key replaces that lane. Empty optional fields use the server/provider defaults.",
            )}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setConfirmation({ kind: "save", lane: { ...draft } });
            }}
          >
            <fieldset disabled={busy || Boolean(confirmation)}>
              <label>
                {t("Lane key")}
                <input
                  required
                  value={draft.key}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, key: event.target.value })
                  }
                />
              </label>
              <label>
                {t("Provider identity")}
                <input
                  required
                  value={draft.provider}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, provider: event.target.value })
                  }
                />
              </label>
              {field("model", "Model")}
              {field("apiType", "API style")}
              {field("baseUrl", "Base URL")}
              {field("apiKeyEnv", "API key environment name")}
              <label>
                {t(
                  "New credential (optional; otherwise reuse server configuration)",
                )}
                <input
                  type="password"
                  autoComplete="off"
                  ref={passwordInput}
                  disabled={busy}
                />
              </label>
              {field("description", "Description")}
              {countField("contextWindow", "Context window (optional)")}
              {countField(
                "maxOutputTokens",
                "Maximum output tokens (optional)",
              )}
              <button
                type="submit"
                disabled={
                  busy ||
                  profileBusy ||
                  !draft.key.trim() ||
                  !draft.provider.trim()
                }
              >
                {t("Review lane save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  resetCredential();
                  setDraft(emptyLane);
                  setConfirmation(null);
                }}
              >
                {t("Clear lane draft")}
              </button>
            </fieldset>
          </form>
        </section>
      ) : null}
      {confirmation ? (
        <section
          className={styles.confirmation}
          aria-label={t("Confirm research lane change")}
        >
          <h3>
            {confirmation.kind === "save"
              ? t("Confirm lane save")
              : t("Confirm lane removal")}
          </h3>
          <p>
            {confirmation.kind === "save"
              ? `${confirmation.lane.key} · ${confirmation.lane.provider} · ${confirmation.lane.model ?? "default model"}`
              : confirmation.key}
          </p>
          <p>
            {t("This changes server Profile") + " "}
            {profileId}
            {t(
              ". The response will report whether a restart is required. Removing a lane requires re-adding its configuration to recover it.",
            )}
          </p>
          <button
            type="button"
            disabled={busy || profileBusy}
            onClick={confirm}
          >
            {t("Confirm") + " "}
            {confirmation.kind === "save" ? t("save") : t("removal")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              resetCredential();
              setConfirmation(null);
            }}
          >
            {t("Cancel lane change")}
          </button>
        </section>
      ) : null}
    </ModalSurface>
  );
}
