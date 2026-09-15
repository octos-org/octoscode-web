import { useEffect, useState } from "react";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import type { SessionAutonomyCommands } from "./client-contract.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { AutonomyPanel } from "./AutonomyPanel.tsx";
import { useAutonomy } from "./use-autonomy.ts";
import {
  bindAutonomyNotifications,
  loadAutonomyCommands,
  type AutonomyClient,
} from "./binding.ts";
import styles from "./AutonomyDialog.module.css";
import type { AgentSpawnHost } from "./agent-spawn.ts";
import { useUiText } from "../preferences/ui-text.tsx";

export interface AutonomyDialogProps extends AgentSpawnHost {
  client: AutonomyClient;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  /** Confirmed endpoint/profile/auth/transport generation, never a credential. */
  authorityKey: string;
  /** Root captures the exact selected record, full scope and runtime authority. */
  isCurrent?: () => boolean;
  onClose: () => void;
}

/** Candidate host: root supplies full confirmed authority, not just session ID. */
export function AutonomyDialog(props: AutonomyDialogProps) {
  return (
    <ScopedDialog
      key={JSON.stringify([props.authorityKey, props.sessionId])}
      {...props}
    />
  );
}

function ScopedDialog({
  client,
  sessionId,
  capabilities,
  isCurrent,
  onSpawnAgents,
  spawnAvailable,
  onClose,
}: AutonomyDialogProps) {
  const t = useUiText();
  const [loaded, setLoaded] = useState<{
    client: AutonomyClient;
    capabilities: UiProtocolCapabilities;
    commands: SessionAutonomyCommands;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
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
    return (
      <ReadyDialog
        client={client}
        commands={loaded.commands}
        {...(isCurrent ? { isCurrent } : {})}
        {...(onSpawnAgents ? { onSpawnAgents } : {})}
        {...(spawnAvailable === undefined ? {} : { spawnAvailable })}
        onClose={onClose}
      />
    );
  }
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="autonomy-dialog-title"
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id="autonomy-dialog-title">{t("Session autonomy")}</h2>
        <button type="button" onClick={onClose}>
          {t("Close autonomy")}
        </button>
      </header>
      <p role={failed ? "alert" : "status"}>
        {failed
          ? t("Could not load autonomy controls. Close and try again.")
          : t("Loading autonomy controls…")}
      </p>
    </ModalSurface>
  );
}

function ReadyDialog({
  client,
  commands,
  isCurrent,
  onSpawnAgents,
  spawnAvailable,
  onClose,
}: {
  client: AutonomyClient;
  commands: SessionAutonomyCommands;
  isCurrent?: () => boolean;
  onClose: () => void;
} & AgentSpawnHost) {
  const t = useUiText();
  const controller = useAutonomy({
    commands: () => commands,
    sessionId: () => commands.sessionId,
    ...(isCurrent ? { isCurrent } : {}),
  });
  const observe = controller.observeNotification;
  useEffect(
    () =>
      bindAutonomyNotifications(client, observe, () => controller.refresh()),
    [client, commands, observe],
  );
  const pending = controller.isMutationPending();
  const close = () => {
    if (!controller.isMutationPending()) onClose();
  };
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="autonomy-dialog-title"
      onEscape={close}
    >
      <header className={styles.header}>
        <h2 id="autonomy-dialog-title">{t("Session autonomy")}</h2>
        <button type="button" disabled={pending} onClick={close}>
          {t("Close autonomy")}
        </button>
      </header>
      <p className={styles.scope}>{commands.sessionId}</p>
      {pending ? (
        <p role="status">
          {t(
            "Waiting for the server to confirm this change. Closing does not cancel server work.",
          )}
        </p>
      ) : null}
      <AutonomyPanel
        controller={controller}
        {...(onSpawnAgents ? { onSpawnAgents } : {})}
        {...(spawnAvailable === undefined ? {} : { spawnAvailable })}
      />
    </ModalSurface>
  );
}
