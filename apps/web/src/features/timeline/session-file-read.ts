import {
  OctosUiProtocolError,
  type OctosUiClient,
} from "@octos-org/octoscode-client/protocol";

const CHUNK_SIZE = 512 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export function isWorkspaceRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:\//.test(value) &&
    !value.startsWith("up/") &&
    !value.startsWith("pf/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

/** Core's delivery-time copy path from octos-bus session_artifacts. */
export async function deliveredArtifactWorkspacePath(
  reference: string,
): Promise<string | null> {
  if (
    !reference ||
    reference.startsWith("up/") ||
    reference.startsWith("pf/")
  ) {
    return null;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(reference),
  );
  const bucket = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const name = (reference.split(/[\\/]/).at(-1) || "artifact").replace(
    /[\\/\\\0]/g,
    "_",
  );
  return `.artifacts/delivered/${bucket}/${name}`;
}

export function isWorkspaceReadLimitError(reason: unknown): boolean {
  if (
    reason instanceof OctosUiProtocolError &&
    (reason.data as { kind?: unknown } | undefined)?.kind ===
      "workspace_file_too_large"
  ) {
    return true;
  }
  return (
    reason instanceof Error &&
    (reason.message === "Session file read returned an invalid offset" ||
      reason.message === "Session file read returned an oversized chunk")
  );
}

export function workspaceRelativeArtifactPath(
  reference: string,
  workspaceRoot: string,
): string | null {
  const normalizedReference = reference.replace(/\\/g, "/");
  if (isWorkspaceRelativePath(normalizedReference)) return normalizedReference;
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsRoot = /^[A-Za-z]:\//.test(root);
  const candidate = windowsRoot
    ? normalizedReference.toLowerCase()
    : normalizedReference;
  const expectedRoot = windowsRoot ? root.toLowerCase() : root;
  if (!root || !candidate.startsWith(`${expectedRoot}/`)) return null;
  const relative = normalizedReference.slice(root.length + 1);
  return isWorkspaceRelativePath(relative) ? relative : null;
}

/** Read one byte to obtain authoritative size without downloading the file. */
export async function readSessionFileSize(
  client: OctosUiClient,
  sessionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const chunk = await client.readSessionFile({
    session_id: sessionId,
    path,
    offset: 0,
    length: 1,
  });
  if (chunk.session_id !== sessionId || chunk.path !== path) {
    throw new Error("Session file read returned a different scope");
  }
  if (chunk.offset !== 0 || chunk.size_bytes > MAX_FILE_BYTES) {
    throw new Error("Session file read returned an invalid offset");
  }
  return chunk.size_bytes;
}

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
    if (chunk.content_base64.length > Math.ceil(CHUNK_SIZE / 3) * 4) {
      throw new Error("Session file read returned an oversized response");
    }
    mimeType = chunk.mime_type;
    const bytes = decodeBase64(chunk.content_base64);
    if (
      bytes.length > CHUNK_SIZE ||
      totalBytes + bytes.length > chunk.size_bytes ||
      totalBytes + bytes.length > MAX_FILE_BYTES
    ) {
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
