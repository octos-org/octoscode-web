/**
 * §5.1 connect failure copy: unreachable server / rejected token / origin not
 * allowed — each with its own message and destination. Pure classification of
 * the transport error string the client surfaces; anything unrecognized stays
 * null so the panel never substitutes a false diagnosis for the raw reason.
 */

export type ConnectFailureKind =
  "unreachable" | "rejected-token" | "origin-not-allowed";

export interface ConnectFailure {
  readonly kind: ConnectFailureKind;
}

/** Map the raw connect error to one of §5.1's three cases, or null. */
export function classifyConnectFailure(error: string): ConnectFailure | null {
  if (error === "Could not open the Octos UI Protocol connection") {
    return { kind: "unreachable" };
  }
  if (error === "The server refused this token") {
    return { kind: "rejected-token" };
  }
  if (error === "Origin not allowed") {
    return { kind: "origin-not-allowed" };
  }
  return null;
}

/** A failed WebSocket upgrade hides HTTP status; only an actual auth/me 401
 * may reclassify it as bad credentials. Network and CORS failures stay generic. */
export async function probeRejectedToken(
  endpoint: string,
  token: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const url = new URL(endpoint);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    const response = await fetch(`${url.origin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
    return response.status === 401;
  } catch {
    return false;
  }
}

export interface ConnectFailureCopy {
  readonly message: string;
  readonly actions: readonly string[];
  /** True only for a rejected token: focus the field, keep the value. */
  readonly focusTokenField: boolean;
}

/** The exact §5.1 copy for each classified failure. */
export function connectFailureCopy(
  failure: ConnectFailure,
  endpoint: string,
  origin?: string,
): ConnectFailureCopy {
  switch (failure.kind) {
    case "unreachable":
      return {
        message: `Can't reach ${endpoint}`,
        actions: ["check the address", "Retry"],
        focusTokenField: false,
      };
    case "rejected-token":
      return {
        message: "The server refused this token",
        actions: ["Re-enter the token", "Retry"],
        focusTokenField: true,
      };
    case "origin-not-allowed":
      return {
        message: `This site isn't allowed to talk to that server — ask the server owner to allow ${
          origin ?? windowOrigin()
        }`,
        actions: ["Open Settings › Providers"],
        focusTokenField: false,
      };
  }
}

function windowOrigin(): string {
  try {
    return typeof window === "undefined" ? "" : window.location.origin;
  } catch {
    return "";
  }
}
