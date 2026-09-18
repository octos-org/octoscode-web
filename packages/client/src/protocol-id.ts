/**
 * Port of Rust `uuid` 1.20 `Uuid::parse_str` accepted shapes. Hex digits are
 * case-INSENSITIVE; the `urn:uuid:` prefix and the `{}` braces are NOT. Nil
 * is a valid version-agnostic UUID. Non-canonical forms here are accepted by
 * the native decoder, so the shared protocol-id gate must accept them too —
 * otherwise a genuine accepted turn id would be dropped as malformed.
 */
const UUID_SIMPLE = /^[0-9a-fA-F]{32}$/u;
const UUID_HYPHENATED =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

function isUuidInner(value: string): boolean {
  return UUID_HYPHENATED.test(value) || UUID_SIMPLE.test(value);
}

export function isProtocolUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (isUuidInner(value)) return true;
  if (value.length === 38 && value.startsWith("{") && value.endsWith("}")) {
    return isUuidInner(value.slice(1, -1));
  }
  if (value.startsWith("urn:uuid:")) {
    // Rust routes a 45-byte `urn:uuid:` input (9-byte prefix + 36-byte body)
    // ONLY to the hyphenated parser; a URN-wrapped simple (32) id is not an
    // accepted shape.
    return UUID_HYPHENATED.test(value.slice(9));
  }
  return false;
}
