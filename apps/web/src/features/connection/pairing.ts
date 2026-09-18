/**
 * WEB-PAIRING-CONTRACT-5100 §Client — open the web client from a pairing link.
 *
 * Pairing is ONE unauthenticated HTTP POST to the server's own origin, made
 * before any socket exists, so it lives here rather than inside the protocol
 * package. The code is a single-use secret: it is read out of the URL, held in
 * memory for exactly one request, and is never written to storage or a log.
 * The URL itself is stripped before the first render that could leak either
 * value into a screenshot or a referrer.
 */

/** Crockford base32 — the printed alphabet, with no I/L/O/U. */
const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_CODE_LENGTH = 64;
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 16_384;

export type PairingErrorKind =
  // The four kinds the server names on the wire.
  | "pair_code_unknown"
  | "pair_code_expired"
  | "pair_code_locked"
  | "pair_code_invalid"
  // Refused by this client before any request is made.
  | "pair_origin_not_loopback"
  // The address answered, but not as a server that knows about pairing.
  | "pair_not_supported"
  | "pair_unreachable";

const WIRE_ERROR_KINDS = new Set<string>([
  "pair_code_unknown",
  "pair_code_expired",
  "pair_code_locked",
  "pair_code_invalid",
]);

/**
 * Bounded copy per kind, each naming a next step. English source text: the
 * panel passes it through the UI catalog, so every entry has a zh.ts key.
 */
export const PAIRING_ERROR_COPY: Readonly<Record<PairingErrorKind, string>> = {
  pair_code_unknown:
    "That link was already used. Start the server again for a fresh link.",
  pair_code_expired:
    "That link expired. Start the server again for a fresh link.",
  pair_code_locked: "Too many attempts. Restart the Octos server.",
  pair_code_invalid: "That link is malformed. Copy it again from the server.",
  pair_origin_not_loopback:
    "That link points to a server that is not on this computer. Pairing links only work for an Octos server on localhost.",
  pair_not_supported:
    "That server does not offer pairing links. Enter its token below.",
  pair_unreachable:
    "Could not reach that Octos server. Check that it is still running.",
};

export function pairingErrorCopy(kind: PairingErrorKind): string {
  return PAIRING_ERROR_COPY[kind];
}

export interface PairingLink {
  /** The raw `octos` value. Validate with `loopbackOrigin` before using it. */
  readonly origin: string;
  /** The raw `pair` value. Never persisted, never logged. */
  readonly code: string;
}

/** Both parameters are required: one alone is not a pairing link. */
export function readPairingLink(search: string): PairingLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const origin = (params.get("octos") ?? "").trim();
  const code = (params.get("pair") ?? "").trim();
  if (!origin || !code) return null;
  return {
    origin: origin.slice(0, MAX_ORIGIN_LENGTH),
    code: code.slice(0, MAX_CODE_LENGTH + 1),
  };
}

/** The same address with `octos` and `pair` gone, every other parameter kept. */
export function strippedPairingUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("octos");
  url.searchParams.delete("pair");
  return url.toString();
}

let linkConsumed = false;
let capturedLink: PairingLink | null = null;

/**
 * Read the link and strip the URL, once per document. Called from main.tsx
 * BEFORE the first render; App reads the same captured value afterwards, so a
 * StrictMode double-render cannot re-read an address that no longer carries
 * the parameters.
 */
export function consumePairingLink(): PairingLink | null {
  if (linkConsumed) return capturedLink;
  linkConsumed = true;
  try {
    if (typeof window === "undefined") return null;
    const link = readPairingLink(window.location.search);
    capturedLink = link;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("octos") && !params.has("pair")) return null;
    try {
      window.history.replaceState(
        null,
        "",
        strippedPairingUrl(window.location.href),
      );
    } catch {
      // An unavailable history API must never block connecting.
    }
  } catch {
    // A denied location is not a pairing link.
  }
  return capturedLink;
}

/** Tests only: forget that this document was already read. */
export function resetConsumedPairingLink(): void {
  linkConsumed = false;
  capturedLink = null;
}

/**
 * Canonicalize an `octos` value, or null when it is not an http(s) origin on
 * loopback. Any path, query, or fragment is discarded — only the origin is
 * ever used, and credentials in the address are refused outright.
 */
export function loopbackOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return isLoopbackHost(url.hostname) ? url.origin : null;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "::1") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return (
    octets !== null && octets.slice(1).every((part) => Number(part) <= 255)
  );
}

function wellFormedCode(code: string): string | null {
  const canonical = code.trim().toUpperCase();
  if (canonical.length === 0 || canonical.length > MAX_CODE_LENGTH) return null;
  return canonical;
}

export interface PairingClaim {
  readonly token: string;
  readonly serverOrigin: string;
}

export type PairingResult =
  | { readonly ok: true; readonly claim: PairingClaim }
  | { readonly ok: false; readonly kind: PairingErrorKind };

export interface PairingRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** POST the code to `<octos>/pair/claim` and read back the API token. */
export async function claimPairingCode(
  link: PairingLink,
  options: PairingRequestOptions = {},
): Promise<PairingResult> {
  const origin = loopbackOrigin(link.origin);
  if (!origin) return { ok: false, kind: "pair_origin_not_loopback" };
  const code = wellFormedCode(link.code);
  if (!code) return { ok: false, kind: "pair_code_invalid" };
  const response = await request(
    `${origin}/pair/claim`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    },
    options,
  );
  if (!response) return { ok: false, kind: "pair_unreachable" };
  if (response.status === 404) return { ok: false, kind: "pair_not_supported" };
  const body = await readJson(response);
  if (!response.ok) {
    return { ok: false, kind: wireErrorKind(body) ?? "pair_unreachable" };
  }
  const claim = readClaim(body, origin);
  return claim ? { ok: true, claim } : { ok: false, kind: "pair_unreachable" };
}

export interface PairingInfo {
  readonly product: string;
  readonly version: string;
  readonly pairingRequired: boolean;
  readonly serverOrigin: string;
}

export type PairingProbe =
  | { readonly kind: "available"; readonly info: PairingInfo }
  /** 404 — this server simply does not do pairing. Never a complaint. */
  | { readonly kind: "unsupported" }
  /** Unreachable, or an answer this client cannot read. Silent either way. */
  | { readonly kind: "unavailable" };

/** §Discovery: one unauthenticated GET, on one origin, never a port range. */
export async function probePairingInfo(
  origin: string,
  options: PairingRequestOptions = {},
): Promise<PairingProbe> {
  const canonical = loopbackOrigin(origin);
  if (!canonical) return { kind: "unavailable" };
  const response = await request(
    `${canonical}/pair/info`,
    { method: "GET", headers: { accept: "application/json" } },
    options,
  );
  if (!response) return { kind: "unavailable" };
  if (response.status === 404) return { kind: "unsupported" };
  if (!response.ok) return { kind: "unavailable" };
  const info = readInfo(await readJson(response), canonical);
  return info ? { kind: "available", info } : { kind: "unavailable" };
}

async function request(
  url: string,
  init: RequestInit,
  options: PairingRequestOptions,
): Promise<Response | null> {
  const call = options.fetchImpl ?? globalThis.fetch;
  if (typeof call !== "function") return null;
  try {
    return await call(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function wireErrorKind(body: unknown): PairingErrorKind | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const kind = body.error.kind;
  return typeof kind === "string" && WIRE_ERROR_KINDS.has(kind)
    ? (kind as PairingErrorKind)
    : null;
}

function readClaim(body: unknown, origin: string): PairingClaim | null {
  if (!isRecord(body)) return null;
  const token = body.token;
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const echoed =
    typeof body.server_origin === "string"
      ? loopbackOrigin(body.server_origin)
      : null;
  return { token, serverOrigin: echoed ?? origin };
}

function readInfo(body: unknown, origin: string): PairingInfo | null {
  if (!isRecord(body) || body.product !== "octos") return null;
  const echoed =
    typeof body.server_origin === "string"
      ? loopbackOrigin(body.server_origin)
      : null;
  return {
    product: "octos",
    version: typeof body.version === "string" ? body.version : "",
    pairingRequired: body.pairing_required === true,
    serverOrigin: echoed ?? origin,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The printed alphabet, exported so a fixture can mint the same shape. */
export { PAIRING_CODE_ALPHABET };
