/**
 * §4.2 Sandbox section (judge #6): the effective sandbox fields, read-only,
 * with the fixed-at-open note and the "New session with…" action pre-filled
 * from Settings › Defaults. Feature absent → "Not supported by this server".
 */
export interface SandboxEffectiveFields {
  enabled: boolean;
  /** null when the server did not report the field. */
  networkAccess: boolean | null;
  readAllowPaths: readonly string[] | null;
}

export interface SandboxSectionProps {
  /** Feature `session.sandbox.v1` advertised by this server. */
  supported: boolean;
  /** Effective values from the session's runtime stamp/open result. */
  effective?: SandboxEffectiveFields | undefined;
  /** Pre-fills a new session's sandbox from Defaults (§4.4). */
  onNewSessionWith?: (() => void) | undefined;
  t: (source: string, params?: Record<string, string | number>) => string;
}

export function SandboxSection({
  supported,
  effective,
  onNewSessionWith,
  t,
}: SandboxSectionProps) {
  if (!supported) {
    return (
      <section aria-label={t("Sandbox")}>
        <h3>{t("Sandbox")}</h3>
        <p>{t("Not supported by this server")}</p>
      </section>
    );
  }
  const network =
    effective?.networkAccess === undefined || effective.networkAccess === null
      ? t("not reported")
      : effective.networkAccess
        ? t("allowed")
        : t("blocked");
  const paths =
    effective?.readAllowPaths == null
      ? t("not reported")
      : effective.readAllowPaths.length
        ? effective.readAllowPaths.join(", ")
        : t("(none)");
  return (
    <section aria-label={t("Sandbox")}>
      <h3>{t("Sandbox")}</h3>
      <p>
        {t("Sandbox: {value0}", {
          value0: effective?.enabled ? t("on") : t("off"),
        })}
      </p>
      <p>{t("Network: {value0}", { value0: network })}</p>
      {effective?.readAllowPaths ? (
        <p>
          {t("Read paths:")}
          {effective.readAllowPaths.length
            ? effective.readAllowPaths.map((path) => (
                <code key={path}>{path}</code>
              ))
            : t("(none)")}
        </p>
      ) : (
        <p>{t("Read paths: {value0}", { value0: paths })}</p>
      )}
      <p>
        {t("Set when the session opens — start a new session to change it")}
      </p>
      {onNewSessionWith ? (
        <button type="button" onClick={onNewSessionWith}>
          {t("New session with…")}
        </button>
      ) : null}
    </section>
  );
}
