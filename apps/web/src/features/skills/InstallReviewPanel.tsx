import { useEffect, useRef, type ReactNode } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  withoutCredentials,
  type InstallReview,
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
 * Only what the server reports, and "unknown" for the rest. Read-only: the
 * server can't tie an install to what is reviewed here, so nothing here
 * installs. Nothing can say a source is safe either.
 */
export function InstallReviewPanel({
  review,
  onClose,
}: {
  review: InstallReview;
  onClose: () => void;
}) {
  const t = useUiText();
  const heading = useBroughtIntoView<HTMLHeadingElement>(review);
  const { source, standing, package: item } = review;
  const note = standingNote(standing, t);
  const unknown = t("Unknown");
  return (
    <section
      className={styles.confirmation}
      aria-labelledby="skill-source-review-title"
    >
      <h3 id="skill-source-review-title" ref={heading} tabIndex={-1}>
        {t("Source review")}
      </h3>
      <div className={styles.risk}>
        <p>
          {t(
            "Installing isn't offered here. The server can't yet tie an install to the exact version or commit reviewed below: the branch can change between this review and the server's clone, so a confirmation here couldn't promise what would be installed.",
          )}
        </p>
        <p>
          {t(
            "Installing here needs the server to accept an immutable commit or version, refuse anything else, and report what it installed.",
          )}{" "}
          <a href={ISSUE_2321} target="_blank" rel="noreferrer noopener">
            #2321
          </a>
        </p>
      </div>
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
        <Fact label={t("Signature or checksum")}>
          {t("Not reported by the server")}
        </Fact>
        {item?.installed ? (
          <Fact label={t("Already installed")}>
            {item.installedSkills.join(", ")}
          </Fact>
        ) : null}
      </dl>
      <div className={styles.actions}>
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
