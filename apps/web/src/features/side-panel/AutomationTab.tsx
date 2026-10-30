import { useEffect, useState } from "react";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import { AutonomyPanel } from "../autonomy/AutonomyPanel.tsx";
import { useAutonomy } from "../autonomy/use-autonomy.ts";
import type { SessionAutonomyCommands } from "../autonomy/client-contract.ts";
import {
  bindAutonomyNotifications,
  loadAutonomyCommands,
  type AutonomyClient,
} from "../autonomy/binding.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./SessionPanelTabs.module.css";

export interface AutomationTabProps {
  client: AutonomyClient;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  authorityKey: string;
}

/** Right-panel host for the existing capability-gated autonomy controller. */
export function AutomationTab(props: AutomationTabProps) {
  return (
    <ScopedAutomationTab
      key={JSON.stringify([props.authorityKey, props.sessionId])}
      {...props}
    />
  );
}

function ScopedAutomationTab({
  client,
  sessionId,
  capabilities,
}: AutomationTabProps) {
  const t = useUiText();
  const [loaded, setLoaded] = useState<{
    client: AutonomyClient;
    capabilities: UiProtocolCapabilities;
    commands: SessionAutonomyCommands;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(null);
    setFailed(false);
    return loadAutonomyCommands(
      client,
      sessionId,
      capabilities,
      (commands) => setLoaded({ client, capabilities, commands }),
      () => setFailed(true),
    );
  }, [client, sessionId, capabilities]);

  if (loaded?.client === client && loaded.capabilities === capabilities) {
    return <ReadyAutomationTab client={client} commands={loaded.commands} />;
  }
  return (
    <p className={styles.empty} role={failed ? "alert" : "status"}>
      {failed
        ? t("Could not load autonomy controls. Close and try again.")
        : t("Loading autonomy controls…")}
    </p>
  );
}

function ReadyAutomationTab({
  client,
  commands,
}: {
  client: AutonomyClient;
  commands: SessionAutonomyCommands;
}) {
  const t = useUiText();
  const controller = useAutonomy({
    commands: () => commands,
    sessionId: () => commands.sessionId,
  });
  const observe = controller.observeNotification;
  useEffect(
    () =>
      bindAutonomyNotifications(client, observe, () => controller.refresh()),
    [client, commands, observe],
  );

  return (
    <div className={styles.stack}>
      <section
        className={styles.section}
        aria-label={t("Autonomy limitations")}
      >
        <p className={styles.note}>
          {t("Goal history and budget accounting are still being reconciled.")}
        </p>
        <p className={styles.note}>
          {t("Monitor probes are not fully sandboxed yet.")}
        </p>
      </section>
      <AutonomyPanel controller={controller} />
    </div>
  );
}
