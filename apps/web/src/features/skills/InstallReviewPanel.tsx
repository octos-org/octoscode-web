import { useEffect, useRef, type ReactNode } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  withoutCredentials,
  type InstallDecision,
  type InstallReview,
  type InstallUnavailable,
  type RegistryStanding,
} from "./install-review.ts";
import styles from "./SkillsDialog.module.css";

type UiText = ReturnType<typeof useUiText>;

function standingNote(standing: RegistryStanding, t: UiText): string | null {
  switch (standing) {
    case "listed":
      return null;
    case "unlisted":
      return t(
        "The server's registry has no single entry for this source, so most of what follows is unknown.",
      );
    case "not-offered":
      return t(
        "This server doesn't offer a skill registry, so most of what follows is unknown.",
      );
    case "server-path":
      return t(
        "This is a path on the server. No registry entry describes it, so most of what follows is unknown.",
      );
  }
}

function unavailableNote(reason: InstallUnavailable, t: UiText): string {
  switch (reason) {
    case "no-capability":
      return t(
        "Installing isn't offered: this server has no review-bound install, so it couldn't promise to install the commit reviewed below.",
      );
    case "not-listed":
      return t(
        "Installing isn't offered: the registry has no single reviewed entry for this source, so there is no immutable object to install.",
      );
    case "no-commit":
      return t(
        "Installing isn't offered: the registry entry does not report the reviewed commit, so the install could not be held to this review.",
      );
    case "no-review-time":
      return t(
        "Installing isn't offered: the registry entry does not report when the commit was reviewed.",
      );
    case "no-platform":
      return t(
        "Installing isn't offered: the server did not report its host platform, so the artifact for it cannot be identified.",
      );
    case "artifact-missing":
      return t(
        "Installing isn't offered: the registry has no binary artifact for this server's platform.",
      );
    case "artifact-incomplete":
      return t(
        "Installing isn't offered: the platform artifact is missing its checksum or signature.",
      );
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The dialog scrolls, and what the page just said may be out of sight. */
function useBroughtIntoView<Element extends HTMLElement>(key: unknown) {
  const target = useRef<Element>(null);
  useEffect(() => {
    target.current?.scrollIntoView({ block: "start" });
    target.current?.focus();
  }, [key]);
  return target;
}

const ISSUE_2321 = "https://github.com/octos-org/octos/issues/2321";

/**
 * Only what the server reports, and "unknown" for the rest. When the server
 * negotiated a review-bound install, the review may offer installing exactly
 * this object; otherwise it stays read-only. Nothing says a source is safe.
 */
export function InstallReviewPanel({
  review,
  decision,
  busy,
  onInstall,
  onClose,
}: {
  review: InstallReview;
  decision: InstallDecision;
  busy: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  const t = useUiText();
  const heading = useBroughtIntoView<HTMLHeadingElement>(review);
  const { source, standing, package: item } = review;
  const note = standingNote(standing, t);
  const unknown = t("Unknown");
  const artifact = decision.ok ? decision.plan.artifact : null;
  return (
    <section
      className={styles.confirmation}
      aria-labelledby="skill-source-review-title"
    >
      <h3 id="skill-source-review-title" ref={heading} tabIndex={-1}>
        {t("Source review")}
      </h3>
      {decision.ok ? (
        <div className={styles.risk}>
          <p>
            {t(
              "This server can install exactly this reviewed commit and its signed artifact, and will refuse if the registry or the download no longer matches.",
            )}
          </p>
          <p>
            {t(
              "The install runs no build or setup steps of its own: the server publishes the reviewed source tree plus the signed artifact, and shared dependencies are not installed.",
            )}
          </p>
        </div>
      ) : (
        <div className={styles.risk}>
          <p>{unavailableNote(decision.reason, t)}</p>
          <p>
            {t(
              "Installing here needs the server to offer a review-bound install pinned to an immutable commit and checksum, refuse anything else, and report what it installed.",
            )}{" "}
            <a href={ISSUE_2321} target="_blank" rel="noreferrer noopener">
              #2321
            </a>
          </p>
        </div>
      )}
      <p>
        {t(
          "Installing can run this source's code directly on the server: npm install, cargo build, downloaded binaries and the setup steps in its manifest. This list is only what the server reports. Nobody has inspected the source for you here.",
        )}
      </p>
      {note ? <p>{note}</p> : null}
      <dl className={styles.facts}>
        <Fact label={t("Source")}>
          <code>{withoutCredentials(source.repo)}</code>
        </Fact>
        {standing === "server-path" ? null : (
          <Fact label={t("Branch")}>
            {source.branch || t("main (server default)")}
          </Fact>
        )}
        <Fact label={t("Package")}>{item?.name ?? unknown}</Fact>
        {item?.description ? (
          <Fact label={t("Description")}>{item.description}</Fact>
        ) : null}
        <Fact label={t("Version")}>{item?.version ?? unknown}</Fact>
        <Fact label={t("Author")}>{item?.author ?? unknown}</Fact>
        <Fact label={t("License")}>{item?.license ?? unknown}</Fact>
        <Fact label={t("Skills included")}>
          {item?.skills.length ? item.skills.join(", ") : unknown}
        </Fact>
        <Fact label={t("Required tools")}>
          {item?.requires.length ? item.requires.join(", ") : unknown}
        </Fact>
        <Fact label={t("Executable tools")}>
          {item?.providesTools
            ? t("The registry says it provides them")
            : t(
                "Unknown. The registry doesn't say it provides them, which doesn't mean it has none",
              )}
        </Fact>
        <Fact label={t("Reviewed commit")}>
          {item?.sourceCommit ? <code>{item.sourceCommit}</code> : unknown}
        </Fact>
        {item?.reviewedAt ? (
          <Fact label={t("Reviewed at")}>{item.reviewedAt}</Fact>
        ) : null}
        <Fact label={t("Signature or checksum")}>
          {artifact ? (
            <code>{artifact.sha256}</code>
          ) : (
            t("Not reported by the server")
          )}
        </Fact>
        {item?.installed ? (
          <Fact label={t("Already installed")}>
            {item.installedSkills.join(", ")}
          </Fact>
        ) : null}
      </dl>
      <div className={styles.actions}>
        {decision.ok ? (
          <button type="button" disabled={busy} onClick={onInstall}>
            {t("Install this reviewed object")}
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          {t("Close review")}
        </button>
      </div>
    </section>
  );
}

/** The registry couldn't be read, so there is nothing to show. */
export function InstallReviewFailure({
  detail,
  busy,
  onRetry,
  onClose,
}: {
  detail: string;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useUiText();
  const heading = useBroughtIntoView<HTMLHeadingElement>(detail);
  return (
    <section
      className={styles.confirmation}
      aria-labelledby="skill-source-review-title"
    >
      <h3 id="skill-source-review-title" ref={heading} tabIndex={-1}>
        {t("Source review")}
      </h3>
      <div className={styles.changed} role="alert">
        <p>{t("Couldn't read the server's skill registry.")}</p>
        <p>{detail}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onRetry}>
          {t("Try again")}
        </button>
        <button type="button" onClick={onClose}>
          {t("Close review")}
        </button>
      </div>
    </section>
  );
}
