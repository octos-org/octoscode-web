import { connectionEndpointError } from "../connection/validation.ts";
import { isRecord } from "../../shared/guards.ts";

export type RemoteHandoff =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; endpoint: string; folders: string[] };

// Navigation hints only, never session authority. The fragment keeps folder
// paths out of HTTP requests and referrers; credentials are never accepted.
const MAX_HANDOFF_LENGTH = 32_768;
function handoffEndpoint(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    connectionEndpointError(value)
  )
    return null;
  return new URL(value).href.replace(/\/$/, "");
}
function validFolders(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every(
      (path) =>
        typeof path === "string" &&
        path.trim().length > 0 &&
        path.length <= 4096,
    )
  );
}

export function readRemoteHandoff(href: string): RemoteHandoff {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.has("handoff")) return { kind: "none" };
  if (
    url.searchParams.get("view") !== "remote" ||
    url.hash.length > MAX_HANDOFF_LENGTH
  )
    return { kind: "invalid" };
  let value: unknown;
  try {
    value = JSON.parse(fragment.get("handoff")!);
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(value)) return { kind: "invalid" };
  const endpoint = handoffEndpoint(value.endpoint);
  if (!endpoint || !validFolders(value.folders)) return { kind: "invalid" };
  return {
    kind: "valid",
    endpoint,
    folders: [...new Set(value.folders.map((path) => path.trim()))],
  };
}

export function createRemoteHandoffUrl(
  href: string,
  endpoint: string,
  folders: readonly string[],
): string {
  const server = handoffEndpoint(endpoint);
  const paths = [
    ...new Set(folders.map((path) => path.trim()).filter(Boolean)),
  ];
  if (!server || !validFolders(paths))
    throw new Error("Invalid phone handoff.");
  const url = new URL(href);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Phone links require a web address.");
  url.username = "";
  url.password = "";
  // Allowlist the fields we export, rather than guessing credential names.
  url.search = "?view=remote";
  url.hash = new URLSearchParams({
    handoff: JSON.stringify({ endpoint: server, folders: paths }),
  }).toString();
  if (url.hash.length > MAX_HANDOFF_LENGTH)
    throw new Error("Too many folders for a phone link.");
  return url.href;
}

export function handoffMatchesEndpoint(
  handoff: RemoteHandoff,
  endpoint: string,
): boolean {
  return (
    handoff.kind === "valid" && handoff.endpoint === handoffEndpoint(endpoint)
  );
}
