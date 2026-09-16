import { supportsMethod } from "./interaction.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import type { UiProtocolCapabilities } from "./types.ts";

/** Exact Core FileRef shape; a local path in prompt text is not an upload. */
export interface TurnMedia {
  path: string;
  mime: string;
  size_bytes: number;
}
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Blob REST is retained by the AppUI contract; never send auth in a blob URL. */
export function blobApiUrl(endpoint: string, route: "upload" | "files"): URL {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Blob endpoints require HTTP or HTTPS");
  if (url.username || url.password)
    throw new Error(
      "Use the authentication field, not credentials in the server URL",
    );
  if (url.pathname === "/" || !url.pathname) url.pathname = "/api/" + route;
  else if (url.pathname.endsWith("/api/ui-protocol/ws"))
    url.pathname =
      url.pathname.slice(0, -"/api/ui-protocol/ws".length) + "/api/" + route;
  else
    throw new Error(
      "Cannot resolve blob routes from this custom WebSocket path",
    );
  url.search = "";
  url.hash = "";
  return url;
}

/** rc11 returns one up/base64url/profile-owned-path/display-name handle per uploaded file. */
export function uploadedHandleForProfile(
  value: unknown,
  profileId: string,
): value is string {
  if (typeof value !== "string" || value.length > 16384) return false;
  const parts = value.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== "up" ||
    !parts[2] ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]!)
  )
    return false;
  try {
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0)),
    );
    const path = decoded.replace(/\\/g, "/").split("/");
    return (
      path.length >= 2 &&
      path[0] === profileId &&
      path.every(
        (component) =>
          component !== "" &&
          component !== "." &&
          component !== ".." &&
          !/\p{Cc}/u.test(component),
      )
    );
  } catch {
    return false;
  }
}

export function createMediaCommands(options: {
  endpoint: string;
  token?: string;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  fetch?: typeof fetch;
}) {
  const send = options.fetch ?? globalThis.fetch;
  function headers(): Headers {
    if (!options.profileId || !options.sessionId)
      throw new Error(
        "A confirmed Profile and Session are required for attachments",
      );
    const result = new Headers({ "X-Profile-Id": options.profileId });
    if (options.token?.trim())
      result.set("Authorization", "Bearer " + options.token.trim());
    return result;
  }
  async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
      const response = await send(url, {
        ...init,
        headers: headers(),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Blob request failed with HTTP " + response.status);
      return response;
    } catch (cause) {
      // Do not project response bodies (which may echo credentials or private paths).
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      throw new Error(
        "Authenticated file transfer failed; check the connection and server file permissions",
      );
    }
  }
  return {
    async upload(file: File, signal?: AbortSignal): Promise<TurnMedia> {
      if (!supportsMethod(options.capabilities, CORE_UI_METHODS.TURN_START))
        throw new Error("Turn media is unavailable on this server");
      if (!file.name || file.size > MAX_UPLOAD_BYTES)
        throw new Error("Each file must have a name and be at most 50 MiB");
      const form = new FormData();
      // One file per request preserves the handle/file mapping even for duplicate names.
      form.append("file", file, file.name);
      const response = await request(blobApiUrl(options.endpoint, "upload"), {
        method: "POST",
        body: form,
        ...(signal ? { signal } : {}),
      });
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new Error("Upload returned invalid JSON");
      }
      if (
        !Array.isArray(value) ||
        value.length !== 1 ||
        !uploadedHandleForProfile(value[0], options.profileId)
      )
        throw new Error(
          "Upload returned an invalid or wrong-Profile file handle",
        );
      return {
        path: value[0],
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
      };
    },
    async download(path: string, signal?: AbortSignal): Promise<Blob> {
      if (
        !supportsMethod(
          options.capabilities,
          CORE_UI_METHODS.SESSION_FILES_LIST,
        )
      )
        throw new Error("Session files are unavailable on this server");
      if (!path || path.length > 16384 || /\p{Cc}/u.test(path))
        throw new Error("Invalid file reference");
      const url = blobApiUrl(options.endpoint, "files");
      url.searchParams.set("path", path);
      url.searchParams.set("session", options.sessionId);
      const response = await request(url, {
        method: "GET",
        ...(signal ? { signal } : {}),
      });
      return response.blob();
    },
  };
}
