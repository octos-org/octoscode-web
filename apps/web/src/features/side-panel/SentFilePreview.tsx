import { useEffect, useState } from "react";
import { ArtifactPreview } from "../artifact-preview/ArtifactPreview.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import type { AttachmentAccess } from "../timeline/attachment-access.ts";
import {
  attachmentName,
  isPreviewableImage,
  isWorkspaceUpload,
} from "../timeline/attachments.ts";
import styles from "./SessionPanelTabs.module.css";

interface Description {
  state: "pending" | "ready" | "unavailable";
  sizeBytes?: number;
  largerThanBytes?: number;
  saveAvailable: boolean;
}

/**
 * A file Octos sent or wrote, previewed the way the transcript previews it:
 * the same size checks before any bytes move, the same readers and the same
 * save route.
 */
export function SentFilePreview({
  reference,
  access,
  workspaceFile = isWorkspaceUpload(reference),
}: {
  reference: string;
  access: AttachmentAccess;
  /** A workspace file read through the session file reader. */
  workspaceFile?: boolean;
}) {
  const t = useUiText();
  const name = attachmentName(reference);
  const [description, setDescription] = useState<Description>({
    state: access.describe ? "pending" : "unavailable",
    saveAvailable: true,
  });

  useEffect(() => {
    if (!access.describe) {
      setDescription({ state: "unavailable", saveAvailable: true });
      return;
    }
    let current = true;
    setDescription({ state: "pending", saveAvailable: true });
    access.describe(reference, workspaceFile).then(
      (info) => {
        if (!current) return;
        setDescription({
          state: "ready",
          saveAvailable: info?.saveAvailable !== false,
          ...(info?.sizeBytes === undefined
            ? {}
            : { sizeBytes: info.sizeBytes }),
          ...(info?.largerThanBytes === undefined
            ? {}
            : { largerThanBytes: info.largerThanBytes }),
        });
      },
      () => {
        if (current)
          setDescription({ state: "unavailable", saveAvailable: true });
      },
    );
    return () => {
      current = false;
    };
  }, [access, reference, workspaceFile]);

  const routeAvailable = workspaceFile
    ? access.previewAvailable !== false
    : access.deliveredPreviewAvailable !== false;
  if (!description.saveAvailable || !routeAvailable) {
    return (
      <p className={styles.empty} role="status">
        {t("No preview or download route is available for this file.")}
      </p>
    );
  }
  const read = workspaceFile
    ? (access.downloadWorkspaceFile ?? access.download)
    : access.download;
  const save = workspaceFile
    ? (signal: AbortSignal | undefined) =>
        access.saveWorkspaceFile
          ? access.saveWorkspaceFile(reference, description.sizeBytes, signal)
          : read(reference, signal)
    : access.downloadForSave
      ? (signal: AbortSignal | undefined) =>
          access.downloadForSave!(reference, signal)
      : undefined;
  return (
    <ArtifactPreview
      name={name}
      path={reference}
      workspaceFile={workspaceFile}
      sizeRequired={!workspaceFile && !isPreviewableImage(name)}
      sizePending={description.state === "pending"}
      sizeBytes={description.sizeBytes}
      largerThanBytes={description.largerThanBytes}
      loadBlob={(signal) => read(reference, signal)}
      {...(save ? { downloadBlob: save } : {})}
    />
  );
}
