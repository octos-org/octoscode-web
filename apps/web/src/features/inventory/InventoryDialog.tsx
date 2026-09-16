import { useEffect, useRef, useState } from "react";
import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  RuntimeTools,
  RuntimeMcp,
} from "@octos-org/octoscode-client/inventory";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./InventoryDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export function InventoryDialog({
  mode,
  client,
  sessionId,
  profileId,
  capabilities,
  onClose,
}: {
  mode: "tools" | "mcp";
  client: OctosUiClient;
  sessionId: string;
  profileId: string;
  capabilities: UiProtocolCapabilities;
  onClose: () => void;
}) {
  const t = useUiText();
  const [tools, setTools] = useState<RuntimeTools | null>(null);
  const [mcp, setMcp] = useState<RuntimeMcp | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  async function refresh() {
    const ticket = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const commands = await client.inventoryCommands(
        sessionId,
        profileId,
        capabilities,
      );
      if (ticket !== generation.current) return;
      if (mode === "tools") {
        const result = await commands.tools();
        if (ticket === generation.current) setTools(result);
      } else {
        const result = await commands.mcp();
        if (ticket === generation.current) setMcp(result);
      }
    } catch (cause) {
      if (ticket === generation.current)
        setError(
          (cause instanceof Error
            ? cause.message
            : "Inventory request failed"
          ).slice(0, 512),
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
    // App keys this surface by confirmed authority and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId, profileId, mode]);
  const search = query.trim().toLocaleLowerCase();
  const toolRows =
    tools?.tools.filter((tool) =>
      [
        tool.name,
        tool.category,
        tool.status,
        tool.policy,
        tool.detail,
        ...tool.aliases,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
    ) ?? [];
  const servers =
    mcp?.servers.filter((server) =>
      [
        server.id,
        server.displayName,
        server.status,
        server.transport,
        ...server.tools,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
    ) ?? [];
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="inventory-title"
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id="inventory-title">
          {mode === "tools" ? t("Runtime tools") : t("MCP server status")}
        </h2>
        <button type="button" disabled={loading} onClick={() => void refresh()}>
          {t("Refresh inventory")}
        </button>
        <button type="button" onClick={onClose}>
          {t("Close inventory")}
        </button>
      </header>
      <p className={styles.scope}>
        {profileId} · {sessionId}
      </p>
      <p>
        {t(
          "Read-only status reported by the server. This runtime does not provide tool or MCP configuration editing.",
        )}
      </p>
      <input
        type="search"
        aria-label={t("Search runtime inventory")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search names, status, or tools…")}
      />
      {loading ? <p role="status">{t("Loading runtime inventory…")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {mode === "tools" && tools ? (
        <>
          <p>
            {tools.tools.length}
            {" " + t("tools reported · Policy") + " "}
            {tools.policyId}
          </p>
          <div className={styles.rows}>
            {toolRows.map((tool) => (
              <article key={tool.name}>
                <h3>{tool.name}</h3>
                <p>
                  {tool.status} · {tool.category} · {tool.policy}
                </p>
                {tool.backendTool && tool.backendTool !== tool.name ? (
                  <p>
                    {t("Backend:") + " "}
                    {tool.backendTool}
                  </p>
                ) : null}
                {tool.aliases.length ? (
                  <p>
                    {t("Aliases:") + " "}
                    {tool.aliases.join(", ")}
                  </p>
                ) : null}
                {tool.detail ? <p>{tool.detail}</p> : null}
              </article>
            ))}
          </div>
          {!toolRows.length ? <p>{t("No matching tools.")}</p> : null}
        </>
      ) : null}
      {mode === "mcp" && mcp ? (
        <>
          <p>
            {mcp.summary.connected}
            {" " + t("connected ·") + " "}
            {mcp.summary.connecting} {t("connecting ·") + " "}
            {mcp.summary.failed}
            {" " + t("failed ·") + " "}
            {mcp.summary.disabled} {t("disabled")}
          </p>
          <div className={styles.rows}>
            {servers.map((server) => (
              <article key={server.id}>
                <h3>{server.displayName || server.id}</h3>
                <p>
                  {server.status}
                  {server.transport ? ` · ${server.transport}` : ""} ·{" "}
                  {server.toolCount}
                  {" " + t("tools")}
                </p>
                {server.tools.length ? <p>{server.tools.join(", ")}</p> : null}
                {server.error ? <p role="alert">{server.error}</p> : null}
              </article>
            ))}
          </div>
          {!servers.length ? (
            <p>
              {mcp.servers.length
                ? t("No matching servers.")
                : t("No MCP servers reported by this runtime.")}
            </p>
          ) : null}
        </>
      ) : null}
    </ModalSurface>
  );
}
