import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  supportsMcpConnectorManagement,
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
  connectorId?: string;
  name: string;
  url: string;
};

const PERMISSION_ERROR =
  /forbidden|permission denied|not authorized|unauthorized|session ingress|host-managed|profile.*write/i;

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
  const [manageDenied, setManageDenied] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const generation = useRef(0);
  const managementAvailable = supportsMcpConnectorManagement(capabilities);
  const managementDisabled = !managementAvailable || manageDenied;

  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setRefreshing(true);
    setError(null);
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
    if (busy || refreshing) return;
    const ticket = ++generation.current;
    setBusy(key);
    setError(null);
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
      if (PERMISSION_ERROR.test(message)) {
        setManageDenied(true);
        setError(
          t("You do not have permission to manage this profile's connectors."),
        );
      } else {
        setError(message);
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
      return;
    }
    if (editor.mode === "add" && !validHttpUrl(url)) {
      setError(t("Enter a valid HTTP(S) URL without embedded credentials."));
      return;
    }
    if (url && !validHttpUrl(url)) {
      setError(t("Enter a valid HTTP(S) URL without embedded credentials."));
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
          {managementAvailable ? (
            <button
              type="button"
              className={local.primary}
              disabled={
                managementDisabled || Boolean(busy) || loading || refreshing
              }
              onClick={() => {
                setError(null);
                setConfirmDelete(null);
                setEditor({ mode: "add", name: "", url: "" });
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
      ) : (
        <p className={styles.notice}>
          {t(
            "HTTP connectors can be added here. stdio connectors require an operator-configured server allowlist.",
          )}
        </p>
      )}
      {manageDenied ? (
        <p className={styles.notice} role="status">
          {t(
            "Management is disabled because this access can read sessions but cannot change the profile.",
          )}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}

      {editor ? (
        <form
          className={local.editor}
          aria-label={t(
            editor.mode === "add" ? "Add HTTP connector" : "Edit connector",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            saveEditor();
          }}
        >
          <h3>
            {t(editor.mode === "add" ? "Add HTTP connector" : "Edit connector")}
          </h3>
          <label className={local.field}>
            <span>{t("Connector name")}</span>
            <input
              value={editor.name}
              disabled={formBusy || manageDenied || refreshing}
              maxLength={200}
              autoComplete="off"
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
          </label>
          {editor.mode === "add" ||
          state?.servers.find((row) => row.id === editor.connectorId)
            ?.transport === "http" ? (
            <label className={local.field}>
              <span>{t("HTTP URL")}</span>
              <input
                type="url"
                value={editor.url}
                disabled={formBusy || manageDenied || refreshing}
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
              disabled={formBusy || manageDenied || refreshing}
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
                          setConfirmDelete(null);
                          setEditor({
                            mode: "edit",
                            connectorId: server.id,
                            name,
                            url: "",
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
                          disabled={manageDenied || Boolean(busy) || refreshing}
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
