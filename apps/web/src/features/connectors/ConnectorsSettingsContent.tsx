import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  supportsMcpConnectorManagement,
  supportsMcpOAuth,
  type McpConnectorMutation,
  type McpStdioAllowlistEntry,
  type RuntimeMcp,
  type RuntimeMcpServer,
} from "@octos-org/octoscode-client/inventory";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";
import local from "./ConnectorsSettingsContent.module.css";
import { ConnectorSignIn } from "./ConnectorSignIn.tsx";
import {
  connectorOAuthState,
  knownToUseOAuth,
  needsSignIn,
  noteConnectorUnauthorized,
  oauthSettled,
  oauthVersion,
  rememberConnectorOAuth,
  subscribeConnectorOAuth,
} from "./connector-oauth.ts";
import {
  afterMutation,
  readSavedConnectors,
  withoutListed,
  writeSavedConnectors,
  type SavedConnector,
} from "./saved-connectors.ts";

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
const NOT_FOUND_ERROR = /mcp_connector not found/i;

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

function savedConnectorText(
  row: SavedConnector,
  t: ReturnType<typeof useUiText>,
): string {
  if (!row.enabled) return t("Saved as disabled, won't run");
  switch (row.takesEffect) {
    case "restart":
      return t("Saved, takes effect after the server restarts");
    case "next_turn":
      return t("Saved, takes effect from the next turn");
    default:
      return t("Saved, not in effect yet");
  }
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
  const [saved, setSaved] = useState(() =>
    readSavedConnectors(client, profileId),
  );
  const [restartNotice, setRestartNotice] = useState<string | null>(null);
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
  const signInAvailable = managementAvailable && supportsMcpOAuth(capabilities);
  // Sign-ins outlive this page: one can finish while settings are closed.
  useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        subscribeConnectorOAuth(client, profileId, listener),
      [client, profileId],
    ),
    () => oauthVersion(client, profileId),
  );
  const settled = oauthSettled(client, profileId);
  const allowlistEntry = (entryId: string) =>
    allowlist?.find((entry) => entry.entryId === entryId);

  // Written through to the store: the server has saved it whether or not this
  // page is still open when the answer arrives.
  const updateSaved = useCallback(
    (
      change: (rows: readonly SavedConnector[]) => readonly SavedConnector[],
      visible: boolean,
    ) => {
      const next = change(readSavedConnectors(client, profileId));
      writeSavedConnectors(client, profileId, next);
      if (visible) setSaved(next);
    },
    [client, profileId],
  );

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
      if (ticket === generation.current) {
        setState(result);
        updateSaved((rows) => withoutListed(rows, result.servers), true);
        // The provider revoked a token out of band: a remembered "Signed in"
        // must not outlive the server's report (T-0371).
        for (const server of result.servers) {
          if (
            needsSignIn(server.error) ||
            (server.authorization && server.authorization !== "authorized")
          ) {
            noteConnectorUnauthorized(client, profileId, server.id);
          }
        }
      }
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
  }, [capabilities, client, profileId, sessionId, updateSaved]);

  useEffect(() => {
    setState(null);
    setLoading(true);
    setManageDenied(false);
    setEditor(null);
    setConfirmDelete(null);
    setBusy(null);
    setRestartNotice(null);
    setSaved(readSavedConnectors(client, profileId));
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [client, profileId, refresh]);

  // A finished sign-in or revocation changed what the server runs.
  const seenSettled = useRef(settled);
  useEffect(() => {
    if (settled === seenSettled.current) return;
    seenSettled.current = settled;
    void refresh();
  }, [refresh, settled]);

  async function runMutation(
    key: string,
    operation: (
      commands: Awaited<ReturnType<typeof client.inventoryCommands>>,
    ) => Promise<McpConnectorMutation>,
    connectorId?: string,
  ) {
    // The buttons are already disabled; this also holds for a form left open.
    if (busy || refreshing || managementDisabled) return;
    const ticket = ++generation.current;
    const savedRow = saved.some((row) => row.id === connectorId);
    setBusy(key);
    setError(null);
    setErrorDetail(null);
    setRestartNotice(null);
    try {
      const commands = await client.inventoryCommands(
        sessionId,
        profileId,
        capabilities,
      );
      const mutation = await operation(commands);
      rememberConnectorOAuth(client, profileId, mutation);
      const open = ticket === generation.current;
      updateSaved((rows) => afterMutation(rows, mutation, connectorId), open);
      if (!open) return;
      setEditor(null);
      setConfirmDelete(null);
      // A listed row keeps showing what runs now, so the page has to say why.
      if (mutation.runtime?.restartRequired && connectorId && !savedRow) {
        setRestartNotice(
          key.startsWith("reconnect:")
            ? t("This server only reconnects connectors when it restarts.")
            : t(
                "Saved. This server only loads connector changes when it restarts, so this list still shows what is running now.",
              ),
        );
      }
      const result = await commands.mcp();
      if (ticket !== generation.current) return;
      setState(result);
      updateSaved((rows) => withoutListed(rows, result.servers), true);
    } catch (reason) {
      if (ticket !== generation.current) return;
      const message = errorMessage(reason).slice(0, 512);
      if (savedRow && NOT_FOUND_ERROR.test(message)) {
        updateSaved(
          (rows) => rows.filter((row) => row.id !== connectorId),
          true,
        );
        setConfirmDelete(null);
        setEditor(null);
        setError(t("This connector is no longer in the saved setup."));
        setErrorDetail(null);
      } else if (
        /private or loopback MCP endpoints are refused/i.test(message)
      ) {
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
    const savedRow = saved.find((row) => row.id === connectorId);
    const currentName = savedRow?.name ?? (server && connectorName(server));
    const patch: { name?: string; url?: string } = {};
    if (name !== currentName) patch.name = name;
    if ((savedRow ?? server)?.transport === "http" && url) patch.url = url;
    if (!patch.name && !patch.url) {
      setEditor(null);
      return;
    }
    void runMutation(
      `edit:${connectorId}`,
      (commands) => commands.updateConnector(connectorId, patch),
      connectorId,
    );
  }

  function openEditor(
    connectorId: string,
    name: string,
    transport: string | undefined,
  ) {
    setError(null);
    setErrorDetail(null);
    setConfirmDelete(null);
    setEditor({
      mode: "edit",
      transport: transport === "http" ? "http" : "stdio",
      connectorId,
      name,
      url: "",
      entryId: "",
      nameTouched: true,
    });
  }

  const formBusy = busy === "add" || busy?.startsWith("edit:") === true;
  const managementLocked = managementDisabled || Boolean(busy) || refreshing;
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
      {restartNotice ? (
        <p className={styles.notice} role="status">
          {restartNotice}
        </p>
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
          {editor.transport === "http" ? (
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

      {state || saved.length ? (
        <>
          {state ? (
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
              {saved.length
                ? ` · ${t("{count} waiting to take effect", {
                    count: saved.length,
                  })}`
                : ""}
            </p>
          ) : null}
          {state && !state.servers.length && !saved.length ? (
            <p>
              {t(
                "No connectors are loaded for this Session. One that was saved but hasn't taken effect isn't listed here.",
              )}
            </p>
          ) : null}
          <div className={styles.rows}>
            {(state?.servers ?? []).map((server) => {
              const name = connectorName(server);
              const rowBusy = busy?.endsWith(`:${server.id}`) === true;
              const signIn = connectorOAuthState(client, profileId, server.id);
              const usesOAuth = knownToUseOAuth(client, profileId, server.id);
              const signInNeeded = needsSignIn(server.error);
              const needsAuthorization =
                (server.authorization &&
                  server.authorization !== "authorized") ||
                (signInNeeded && signIn?.kind !== "authorized");
              const showSignIn =
                signInAvailable &&
                server.transport === "http" &&
                (signInNeeded || usesOAuth || Boolean(signIn));
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
                  {server.error && !(showSignIn && signInNeeded) ? (
                    <p className={styles.error}>{server.error.slice(0, 512)}</p>
                  ) : null}
                  {showSignIn ? (
                    <ConnectorSignIn
                      client={client}
                      profileId={profileId}
                      sessionId={sessionId}
                      capabilities={capabilities}
                      connectorId={server.id}
                      connectorName={name}
                      state={signIn}
                      needsSignIn={signInNeeded}
                      serverError={signInNeeded ? server.error : undefined}
                      usesOAuth={usesOAuth}
                      locked={managementLocked}
                    />
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
                        onClick={() =>
                          openEditor(server.id, name, server.transport)
                        }
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          managementDisabled || Boolean(busy) || refreshing
                        }
                        onClick={() =>
                          void runMutation(
                            `enabled:${server.id}`,
                            (commands) =>
                              commands.setConnectorEnabled(
                                server.id,
                                !server.enabled,
                              ),
                            server.id,
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
                            server.id,
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
                              server.id,
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
            {saved.map((row) => (
              <article
                key={row.id}
                className={styles.row}
                aria-busy={busy?.endsWith(`:${row.id}`) === true}
                data-connector-id={row.id}
                data-connector-saved
              >
                <div className={styles.rowHeading}>
                  <strong>{row.name}</strong>
                  <span data-status={row.enabled ? "waiting" : "disabled"}>
                    {row.enabled ? t("Waiting to take effect") : t("disabled")}
                  </span>
                </div>
                <p className={local.savedState} role="status">
                  {savedConnectorText(row, t)}
                </p>
                <p className={styles.meta}>
                  {row.transport === "http"
                    ? t("HTTP")
                    : (row.transport ?? row.id)}
                  {row.url ? ` · ${row.url}` : ""}
                </p>
                {row.error ? (
                  <p className={styles.error}>{row.error.slice(0, 512)}</p>
                ) : null}
                {signInAvailable &&
                row.transport === "http" &&
                row.url?.startsWith("https://") ? (
                  <ConnectorSignIn
                    client={client}
                    profileId={profileId}
                    sessionId={sessionId}
                    capabilities={capabilities}
                    connectorId={row.id}
                    connectorName={row.name}
                    state={connectorOAuthState(client, profileId, row.id)}
                    needsSignIn={false}
                    usesOAuth={knownToUseOAuth(client, profileId, row.id)}
                    locked={managementLocked}
                  />
                ) : null}
                <p className={styles.meta}>
                  {t(
                    "It isn't running yet. This row is only kept on this page: after a page refresh it won't show until the connector loads, but the saved setup stays.",
                  )}
                </p>
                <div className={local.actions}>
                  <button
                    type="button"
                    disabled={managementLocked}
                    onClick={() => openEditor(row.id, row.name, row.transport)}
                  >
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    disabled={managementLocked}
                    onClick={() =>
                      void runMutation(
                        `enabled:${row.id}`,
                        (commands) =>
                          commands.setConnectorEnabled(row.id, !row.enabled),
                        row.id,
                      )
                    }
                  >
                    {busy === `enabled:${row.id}`
                      ? t("Updating…")
                      : row.enabled
                        ? t("Disable")
                        : t("Enable")}
                  </button>
                  <button
                    type="button"
                    className={local.danger}
                    disabled={managementLocked}
                    onClick={() => {
                      setEditor(null);
                      setConfirmDelete(row.id);
                    }}
                  >
                    {t("Delete")}
                  </button>
                </div>
                {confirmDelete === row.id ? (
                  <div className={local.confirm} role="alert">
                    <p>
                      {t("Delete {name}? Its saved setup will be removed.", {
                        name: row.name,
                      })}
                    </p>
                    <div className={local.actions}>
                      <button
                        type="button"
                        className={local.danger}
                        disabled={managementLocked}
                        onClick={() =>
                          void runMutation(
                            `delete:${row.id}`,
                            (commands) => commands.deleteConnector(row.id),
                            row.id,
                          )
                        }
                      >
                        {busy === `delete:${row.id}`
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
            ))}
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
