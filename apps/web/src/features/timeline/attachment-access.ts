import { createContext } from "react";

/**
 * Reads a delivered file's bytes through the authenticated blob API. Supplied
 * by the app for the open Session; null when no Session is open or the server
 * cannot serve Session files. A leaf module so the app shell can provide it
 * without loading the transcript surface.
 */
export interface AttachmentAccess {
  download(reference: string, signal?: AbortSignal): Promise<Blob>;
  /** Unbounded save route for files larger than the preview RPC limit. */
  downloadForSave?: (reference: string, signal?: AbortSignal) => Promise<Blob>;
  /** Workspace-only reader for tool-written files, never delivered media. */
  downloadWorkspaceFile?: (
    reference: string,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  /** False when workspace reads are not advertised. */
  previewAvailable?: boolean;
  /** False when the legacy delivered-file blob method is not advertised. */
  deliveredPreviewAvailable?: boolean;
  /** Optional server-listed metadata; duplicate or unlisted names return null. */
  describe?: (reference: string) => Promise<{ sizeBytes: number } | null>;
}

export const AttachmentAccessContext = createContext<AttachmentAccess | null>(
  null,
);
