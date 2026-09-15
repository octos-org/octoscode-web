/**
 * §5.1 connect failure copy: unreachable server / rejected token / origin not
 * allowed — each with its own message and destination. Pure classification of
 * the transport error string the client surfaces; anything unrecognized stays
 * null so the panel never substitutes a false diagnosis for the raw reason.
 */

export type ConnectFailureKind =
  | "unreachable"
  | "rejected-token"
  | "origin-not-allowed";

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
