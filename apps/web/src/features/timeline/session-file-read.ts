import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";

const CHUNK_SIZE = 512 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Read one session-scoped workspace file using UPCR-2026-057 chunks. */
export async function readSessionFileBlob(
  client: OctosUiClient,
  sessionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let mimeType = "application/octet-stream";
  let totalBytes = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const chunk = await client.readSessionFile({
      session_id: sessionId,
      path,
      offset,
      length: CHUNK_SIZE,
    });
    if (chunk.path !== path || chunk.session_id !== sessionId) {
      throw new Error("Session file read returned a different scope");
    }
    if (chunk.offset !== offset || chunk.size_bytes > MAX_FILE_BYTES) {
      throw new Error("Session file read returned an invalid offset");
    }
    mimeType = chunk.mime_type;
    const bytes = decodeBase64(chunk.content_base64);
    if (bytes.length > CHUNK_SIZE) {
      throw new Error("Session file read returned an oversized chunk");
    }
    parts.push(bytes);
    totalBytes += bytes.length;
    if (chunk.eof) {
      if (totalBytes !== chunk.size_bytes) {
        throw new Error("Session file read ended before the advertised size");
      }
      return new Blob(parts as BlobPart[], { type: mimeType });
    }
    if (!bytes.length) throw new Error("Session file read made no progress");
    offset += bytes.length;
  }
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
