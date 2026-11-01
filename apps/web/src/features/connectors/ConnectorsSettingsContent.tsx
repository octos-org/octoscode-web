import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  supportsMcpConnectorManagement,
  type McpStdioAllowlistEntry,
  type RuntimeMcp,
  type RuntimeMcpServer,
} from "@octos-org/octoscode-client/inventory";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";
import local from "./ConnectorsSettingsContent.module.css";

interface ConnectorsSettingsContentProps {
  client: OctosUiClient;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
}

type Editor = {
  mode: "add" | "edit";
  transport: "http" | "stdio";
  connectorId?: string;
  name: string;
  url: string;
  /** stdio add: the chosen allowlist entry. */
  entryId: string;
  /** stdio add: the name follows the entry until the user edits it. */
  nameTouched: boolean;
};

const PERMISSION_ERROR =
  /forbidden|permission denied|not authorized|unauthorized|session ingress|host-managed|profile.*write/i;

/** Why the server says this access cannot manage connectors (T-0056). */
function manageUnavailableText(
  reason: string | undefined,
  t: ReturnType<typeof useUiText>,
): string {
  switch (reason) {
    case "requires_profile_write":
      return t(
        "Management is disabled because this access can read sessions but cannot change the profile.",
      );
    case "external_session":
      return t(
        "This session is controlled by an external app, so its connectors can't be changed here.",
      );
    case "feature_disabled":
      return t("Connector management is turned off on this server.");
    case "profile_unavailable":
      return t("This profile can't be changed right now.");
    default:
      // An unknown reason says nothing about permissions; don't guess.
      return t("Connector management isn't available right now.");
  }
}

function addEditor(
  transport: "http" | "stdio",
  allowlist: readonly McpStdioAllowlistEntry[],
): Editor {
  const first = transport === "stdio" ? allowlist[0] : undefined;
  return {
    mode: "add",
    transport,
    name: first?.displayName ?? "",
    url: "",
    entryId: first?.entryId ?? "",
    nameTouched: false,
  };
}

function connectorName(server: RuntimeMcpServer): string {
  return server.displayName?.trim() || server.id;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function ConnectorsSettingsContent({
  client,
  profileId,
  sessionId,
  capabilities,
}: ConnectorsSettingsContentProps) {
  const t = useUiText();
  const [state, setState] = useState<RuntimeMcp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [manageDenied, setManageDenied] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const generation = useRef(0);
  const entryDescriptionId = useId();
  const managementAvailable = supportsMcpConnectorManagement(capabilities);
  // A server with the T-0056 facts says up front whether this access may
  // manage; an older one is only learned from a refused mutation.
  const serverDenied = state?.management?.canManage === false;
  // Facts the server sent but in a broken shape (T-0138): management stays
  // off and the page says why, instead of passing for an older server.
  const factsInvalid = Boolean(state?.invalidFacts?.length);
  const managementDisabled =
    !managementAvailable || manageDenied || serverDenied || factsInvalid;
  const allowlist = factsInvalid ? undefined : state?.stdioAllowlist;
  const allowlistEntry = (entryId: string) =>
    allowlist?.find((entry) => entry.entryId === entryId);

  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setRefreshing(true);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.inventoryCommands(
        sessionId,
        profileId,
        capabilities,
      );
      const result = await commands.mcp();
      if (ticket === generation.current) setState(result);
    } catch (reason) {
      if (ticket === generation.current)
        setError(errorMessage(reason).slice(0, 512));
      setErrorDetail(null);
    } finally {
      if (ticket === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [capabilities, client, profileId, sessionId]);

  useEffect(() => {
    setState(null);
    setLoading(true);
    setManageDenied(false);
    setEditor(null);
    setConfirmDelete(null);
    setBusy(null);
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  async function runMutation(
    key: string,
    operation: (
      commands: Awaited<ReturnType<typeof client.inventoryCommands>>,
    ) => Promise<RuntimeMcp>,
  ) {
    // The buttons are already disabled; this also holds for a form left open.
    if (busy || refreshing || managementDisabled) return;
    const ticket = ++generation.current;
    setBusy(key);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.inventoryCommands(
        sessionId,
        profileId,
        capabilities,
      );
      const result = await operation(commands);
      if (ticket !== generation.current) return;
      setState(result);
      setEditor(null);
      setConfirmDelete(null);
    } catch (reason) {
      if (ticket !== generation.current) return;
      const message = errorMessage(reason).slice(0, 512);
      if (/private or loopback MCP endpoints are refused/i.test(message)) {
        setError(
          t(
            "This connector uses a private or loopback address, which the server refuses. Use an approved public HTTP(S) endpoint.",
          ),
        );
        setErrorDetail(message);
      } else if (PERMISSION_ERROR.test(message)) {
        setManageDenied(true);
        setError(
          t("You do not have permission to manage this profile's connectors."),
        );
        setErrorDetail(message);
      } else {
        setError(message);
        setErrorDetail(null);
      }
    } finally {
      if (ticket === generation.current) setBusy(null);
    }
  }

  function saveEditor() {
    if (!editor || busy || refreshing) return;
    const name = editor.name.trim();
    const url = editor.url.trim();
    if (!name) {
      setError(t("Enter a connector name."));
      setErrorDetail(null);
      return;
    }
    if (editor.mode === "add" && editor.transport === "stdio") {
      const entryId = editor.entryId;
      if (!allowlistEntry(entryId)) {
        setError(t("Choose an entry from the server's allowlist."));
        return;
      }
      void runMutation("add", (commands) =>
        commands.createStdioConnector(name, entryId),
      );
      return;
    }
    if (editor.mode === "add" && !validHttpUrl(url)) {
      setError(t("Enter a valid HTTP(S) URL without embedded credentials."));
      setErrorDetail(null);
      return;
    }
    if (url && !validHttpUrl(url)) {
      setError(t("Enter a valid HTTP(S) URL without embedded credentials."));
      setErrorDetail(null);
      return;
    }
    if (editor.mode === "add") {
      void runMutation("add", (commands) =>
        commands.createHttpConnector(name, url),
      );
      return;
    }
    if (!editor.connectorId) return;
    const connectorId = editor.connectorId;
    const server = state?.servers.find((row) => row.id === connectorId);
    const patch: { name?: string; url?: string } = {};
    if (!server || name !== connectorName(server)) patch.name = name;
    if (server?.transport === "http" && url) patch.url = url;
    if (!patch.name && !patch.url) {
      setEditor(null);
      return;
    }
    void runMutation(`edit:${connectorId}`, (commands) =>
      commands.updateConnector(connectorId, patch),
    );
  }

  const formBusy = busy === "add" || busy?.startsWith("edit:") === true;
  return (
    <div
      className={styles.page}
      aria-busy={loading || refreshing || Boolean(busy)}
    >
      <header className={styles.heading}>
        <div>
          <h2>{t("Connectors")}</h2>
          <p>
            {managementAvailable
              ? t("Manage MCP connectors for this profile.")
              : t("Read-only MCP server status for this Session.")}
          </p>
        </div>
        <div className={local.headingActions}>
          <button
            type="button"
            disabled={loading || refreshing || Boolean(busy)}
            onClick={() => void refresh()}
          >
            {refreshing ? t("Refreshing…") : t("Refresh")}
          </button>
          {managementAvailable && allowlist?.length ? (
            <button
              type="button"
              disabled={
                managementDisabled || Boolean(busy) || loading || refreshing
              }
              onClick={() => {
                setError(null);
                setConfirmDelete(null);
                setEditor(addEditor("stdio", allowlist));
              }}
            >
              {t("Add stdio connector")}
            </button>
          ) : null}
          {managementAvailable ? (
            <button
              type="button"
              className={local.primary}
              disabled={
                managementDisabled || Boolean(busy) || loading || refreshing
              }
              onClick={() => {
                setError(null);
                setErrorDetail(null);
                setConfirmDelete(null);
                setEditor(addEditor("http", []));
              }}
            >
              {t("Add HTTP connector")}
            </button>
          ) : null}
        </div>
      </header>

      {!managementAvailable ? (
        <p className={styles.notice}>
          {t(
            "This server provides read-only connector status. Management is unavailable.",
          )}
        </p>
      ) : factsInvalid ? (
        <p className={styles.error} role="alert">
          {t(
            "The server sent connector management details this page can't read, so management is turned off. Refresh, or check the server version.",
          )}
        </p>
      ) : serverDenied || manageDenied ? (
        // Only the reason: "you can add…" next to greyed-out buttons would
        // contradict it.
        <p className={styles.notice} role="status">
          {serverDenied
            ? manageUnavailableText(state?.management?.reason, t)
            : t(
                "Management is disabled because this access can read sessions but cannot change the profile.",
              )}
        </p>
      ) : allowlist === undefined ? (
        <p className={styles.notice}>
          {t(
            "HTTP connectors can be added here. stdio connectors require an operator-configured server allowlist.",
          )}
        </p>
      ) : allowlist.length ? (
        <p className={styles.notice}>
          {t(
            "Add HTTP connectors, or stdio connectors from the server's allowlist.",
          )}
        </p>
      ) : (
        <p className={styles.notice}>
          {t(
            "No stdio connectors can be added: an operator needs to configure the server allowlist first.",
          )}
        </p>
      )}
      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          {errorDetail ? (
            <details>
              <summary>{t("Technical details")}</summary>
              <code>{errorDetail}</code>
            </details>
          ) : null}
        </div>
      ) : null}
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}

      {editor ? (
        <form
          className={local.editor}
          aria-label={editorTitle(editor, t)}
          onSubmit={(event) => {
            event.preventDefault();
            saveEditor();
          }}
        >
          <h3>{editorTitle(editor, t)}</h3>
          {editor.mode === "add" && editor.transport === "stdio" ? (
            <label className={local.field}>
              <span>{t("Allowlist entry")}</span>
              <select
                value={editor.entryId}
                disabled={formBusy || managementDisabled || refreshing}
                aria-describedby={
                  allowlistEntry(editor.entryId)?.description
                    ? entryDescriptionId
                    : undefined
                }
                onChange={(event) => {
                  const entry = allowlistEntry(event.target.value);
                  setEditor((current) =>
                    current
                      ? {
                          ...current,
                          entryId: event.target.value,
                          name:
                            current.nameTouched || !entry
                              ? current.name
                              : entry.displayName,
                        }
                      : current,
                  );
                }}
              >
                {(allowlist ?? []).map((entry) => (
                  <option key={entry.entryId} value={entry.entryId}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
              {allowlistEntry(editor.entryId)?.description ? (
                <small id={entryDescriptionId}>
                  {allowlistEntry(editor.entryId)?.description}
                </small>
              ) : null}
            </label>
          ) : null}
          <label className={local.field}>
            <span>{t("Connector name")}</span>
            <input
              value={editor.name}
              disabled={formBusy || managementDisabled || refreshing}
              maxLength={200}
              autoComplete="off"
              onChange={(event) =>
                setEditor((current) =>
                  current
                    ? {
                        ...current,
                        name: event.target.value,
                        nameTouched: true,
                      }
                    : current,
                )
              }
            />
          </label>
          {(editor.mode === "add" && editor.transport === "http") ||
          state?.servers.find((row) => row.id === editor.connectorId)
            ?.transport === "http" ? (
            <label className={local.field}>
              <span>{t("HTTP URL")}</span>
              <input
                type="url"
                value={editor.url}
                disabled={formBusy || managementDisabled || refreshing}
                placeholder="https://example.com/mcp"
                autoComplete="off"
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, url: event.target.value } : current,
                  )
                }
              />
              {editor.mode === "edit" ? (
                <small>{t("Leave blank to keep the current URL.")}</small>
              ) : null}
            </label>
          ) : null}
          <div className={local.actions}>
            <button
              type="submit"
              className={local.primary}
              disabled={formBusy || managementDisabled || refreshing}
            >
              {formBusy ? t("Saving…") : t("Save connector")}
            </button>
            <button
              type="button"
              disabled={formBusy}
              onClick={() => setEditor(null)}
            >
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {state ? (
        <>
          <p className={styles.meta}>
            {t(
              "{connected} connected · {connecting} connecting · {failed} failed · {disabled} disabled",
              {
                connected: state.summary.connected,
                connecting: state.summary.connecting,
                failed: state.summary.failed,
                disabled: state.summary.disabled,
              },
            )}
          </p>
          {!state.servers.length ? (
            <p>{t("No MCP servers are configured for this Session.")}</p>
          ) : null}
          <div className={styles.rows}>
            {state.servers.map((server) => {
              const name = connectorName(server);
              const rowBusy = busy?.endsWith(`:${server.id}`) === true;
              const needsAuthorization =
                server.authorization && server.authorization !== "authorized";
              return (
                <article
                  key={server.id}
                  className={styles.row}
                  aria-busy={rowBusy}
                  data-connector-id={server.id}
                >
                  <div className={styles.rowHeading}>
                    <strong>{name}</strong>
                    <span
                      data-status={server.enabled ? server.status : "disabled"}
                    >
                      {!server.enabled
                        ? t("disabled")
                        : needsAuthorization
                          ? t("Authorization required")
                          : t(server.status)}
                    </span>
                  </div>
                  <p className={styles.meta}>
                    {server.transport === "http"
                      ? t("HTTP")
                      : (server.transport ?? server.id)}
                    {" · "}
                    {t("{count} tools", { count: server.toolCount })}
                  </p>
                  {server.error ? (
                    <p className={styles.error}>{server.error.slice(0, 512)}</p>
                  ) : null}
                  {server.tools.length ? (
                    <details>
                      <summary>{t("Tools")}</summary>
                      <ul>
                        {server.tools.map((tool) => (
                          <li key={tool}>{tool}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {managementAvailable ? (
                    <div className={local.actions}>
                      <button
                        type="button"
                        disabled={
                          managementDisabled || Boolean(busy) || refreshing
                        }
                        onClick={() => {
                          setError(null);
                          setErrorDetail(null);
                          setConfirmDelete(null);
                          setEditor({
                            mode: "edit",
                            transport:
                              server.transport === "http" ? "http" : "stdio",
                            connectorId: server.id,
                            name,
                            url: "",
                            entryId: "",
                            nameTouched: true,
                          });
                        }}
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          managementDisabled || Boolean(busy) || refreshing
                        }
                        onClick={() =>
                          void runMutation(`enabled:${server.id}`, (commands) =>
                            commands.setConnectorEnabled(
                              server.id,
                              !server.enabled,
                            ),
                          )
                        }
                      >
                        {busy === `enabled:${server.id}`
                          ? t("Updating…")
                          : server.enabled
                            ? t("Disable")
                            : t("Enable")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          managementDisabled ||
                          Boolean(busy) ||
                          refreshing ||
                          !server.enabled
                        }
                        title={
                          !server.enabled
                            ? t("Enable the connector before reconnecting.")
                            : undefined
                        }
                        onClick={() =>
                          void runMutation(
                            `reconnect:${server.id}`,
                            (commands) =>
                              commands.reconnectConnector(server.id),
                          )
                        }
                      >
                        {busy === `reconnect:${server.id}`
                          ? t("Reconnecting…")
                          : t("Reconnect")}
                      </button>
                      <button
                        type="button"
                        className={local.danger}
                        disabled={
                          managementDisabled || Boolean(busy) || refreshing
                        }
                        onClick={() => {
                          setEditor(null);
                          setConfirmDelete(server.id);
                        }}
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  ) : null}
                  {confirmDelete === server.id ? (
                    <div className={local.confirm} role="alert">
                      <p>
                        {t(
                          "Delete {name}? Its tools will no longer be available.",
                          { name },
                        )}
                      </p>
                      <div className={local.actions}>
                        <button
                          type="button"
                          className={local.danger}
                          disabled={
                            managementDisabled || Boolean(busy) || refreshing
                          }
                          onClick={() =>
                            void runMutation(
                              `delete:${server.id}`,
                              (commands) => commands.deleteConnector(server.id),
                            )
                          }
                        >
                          {busy === `delete:${server.id}`
                            ? t("Deleting…")
                            : t("Confirm delete")}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t("Cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function editorTitle(editor: Editor, t: ReturnType<typeof useUiText>): string {
  if (editor.mode === "edit") return t("Edit connector");
  return editor.transport === "stdio"
    ? t("Add stdio connector")
    : t("Add HTTP connector");
}
