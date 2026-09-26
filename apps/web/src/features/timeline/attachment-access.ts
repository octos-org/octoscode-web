import { createContext } from "react";

/**
 * Reads a delivered file's bytes through the authenticated blob API. Supplied
 * by the app for the open Session; null when no Session is open or the server
 * cannot serve Session files. A leaf module so the app shell can provide it
 * without loading the transcript surface.
 */
export interface AttachmentAccess {
  download(reference: string, signal?: AbortSignal): Promise<Blob>;
}

export const AttachmentAccessContext = createContext<AttachmentAccess | null>(
  null,
);
