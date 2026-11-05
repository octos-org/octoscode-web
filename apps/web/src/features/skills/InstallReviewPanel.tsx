import { useEffect, useRef, type ReactNode } from "react";
import type {
  InstalledSkill,
  SkillInstallResult,
} from "@octos-org/octoscode-client/skills";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  installedVersionsDiffer,
  withoutCredentials,
  type InstallReview,
  type RegistryStanding,
  type ReviewChange,
  type ReviewField,
} from "./install-review.ts";
import styles from "./SkillsDialog.module.css";

type UiText = ReturnType<typeof useUiText>;

export type InstallOutcome =
  | {
      kind: "done";
      result: SkillInstallResult;
      reviewedVersion: string | null;
      /** Null when the list could not be read back. */
      skills: readonly InstalledSkill[] | null;
    }
  | { kind: "failed"; detail: string };

function standingNote(standing: RegistryStanding, t: UiText): string | null {
  switch (standing) {
    case "listed":
      return null;
    case "unlisted":
      return t(
        "The server's registry has no single entry for this source, so most of what follows is unknown. Check it yourself before installing.",
      );
    case "not-offered":
      return t(
        "This server doesn't offer a skill registry, so most of what follows is unknown. Check it yourself before installing.",
      );
    case "server-path":
      return t(
        "This is a path on the server. No registry entry describes it, so most of what follows is unknown. Check it yourself before installing.",
      );
  }
}

function fieldLabel(field: ReviewField, t: UiText): string {
  switch (field) {
    case "standing":
      return t("Registry entry");
    case "name":
      return t("Package");
    case "description":
      return t("Description");
    case "version":
      return t("Version");
    case "author":
      return t("Author");
    case "license":
      return t("License");
    case "skills":
      return t("Skills included");
    case "requires":
      return t("Required tools");
    case "providesTools":
      return t("Executable tools");
    case "tags":
      return t("Tags");
  }
}

function changeValue(change: ReviewChange, value: string, t: UiText): string {
  if (change.field === "standing")
    return value === "listed" ? t("Listed") : t("Not listed");
  return value || t("Unknown");
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

/**
 * Only what the server reports, and "unknown" for the rest. Nothing here can
 * say a source is safe: the server doesn't report anything that could show it.
 */
export function InstallReviewPanel({
  review,
  changes,
  profileId,
  busy,
  blocked,
  onConfirm,
  onCancel,
}: {
  review: InstallReview;
  changes: readonly ReviewChange[];
  profileId: string;
  busy: boolean;
  blocked: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useUiText();
  const heading = useBroughtIntoView<HTMLHeadingElement>(review);
  const { source, standing, package: item } = review;
  const note = standingNote(standing, t);
  const unknown = t("Unknown");
  return (
    <section
      className={styles.confirmation}
      aria-labelledby="skill-install-review-title"
    >
      <h3 id="skill-install-review-title" ref={heading} tabIndex={-1}>
        {t("Review before installing")}
      </h3>
      {changes.length ? (
        <div className={styles.changed} role="alert">
          <p>
            {t(
              "What the server reports changed after your review, so nothing was installed. See what changed, then decide again.",
            )}
          </p>
          <ul>
            {changes.map((change) => (
              <li key={change.field}>
                {fieldLabel(change.field, t)}:{" "}
                {changeValue(change, change.before, t)} →{" "}
                {changeValue(change, change.after, t)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className={styles.risk}>
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
      {standing === "server-path" ? null : (
        <p>
          {t(
            "The server installs whatever this branch holds at that moment. It can't pin the version above, so what you get may differ.",
          )}
        </p>
      )}
      <p>
        {t("Applies to Profile") + " "}
        {profileId}
        {" " + t("and rebuilds its server skill runtime.")}{" "}
        {t("Existing skills are not forcibly overwritten.")}
      </p>
      <div className={styles.actions}>
        <button type="button" disabled={busy || blocked} onClick={onConfirm}>
          {t("Confirm install")}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t("Cancel skill change")}
        </button>
      </div>
    </section>
  );
}

/** The registry couldn't be read, so there is nothing to confirm. */
export function InstallReviewFailure({
  detail,
  busy,
  onRetry,
  onCancel,
}: {
  detail: string;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const t = useUiText();
  const heading = useBroughtIntoView<HTMLHeadingElement>(detail);
  return (
    <section
      className={styles.confirmation}
      aria-labelledby="skill-install-review-title"
    >
      <h3 id="skill-install-review-title" ref={heading} tabIndex={-1}>
        {t("Review before installing")}
      </h3>
      <div className={styles.changed} role="alert">
        <p>
          {t(
            "Couldn't read the server's skill registry, so nothing was installed.",
          )}
        </p>
        <p>{detail}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onRetry}>
          {t("Try again")}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t("Cancel skill change")}
        </button>
      </div>
    </section>
  );
}

export function InstallOutcomeNotice({ outcome }: { outcome: InstallOutcome }) {
  const t = useUiText();
  const notice = useBroughtIntoView<HTMLDivElement>(outcome);
  if (outcome.kind === "failed") {
    return (
      <div ref={notice} tabIndex={-1} className={styles.changed} role="alert">
        <p>{t("The installation didn't finish: {detail}", outcome)}</p>
        <p>
          {t(
            "Part of it may still be on the server. Check the installed skills below.",
          )}
        </p>
      </div>
    );
  }
  const { result, reviewedVersion, skills } = outcome;
  const installed = result.installed.map((name) => {
    const version = skills?.find((skill) => skill.name === name)?.version;
    return version ? `${name} ${version}` : name;
  });
  return (
    <div ref={notice} tabIndex={-1} className={styles.outcome} role="status">
      {installed.length ? (
        <p>
          {t("Installed on the server: {skills}", {
            skills: installed.join(", "),
          })}
        </p>
      ) : null}
      {result.skipped.length ? (
        <p>
          {t("Already there, not overwritten: {skills}", {
            skills: result.skipped.join(", "),
          })}
        </p>
      ) : null}
      {result.dependenciesInstalled.length ? (
        <p>
          {t("Dependencies also installed: {skills}", {
            skills: result.dependenciesInstalled.join(", "),
          })}
        </p>
      ) : null}
      {!installed.length &&
      !result.skipped.length &&
      !result.dependenciesInstalled.length ? (
        <p>{t("The server installed nothing.")}</p>
      ) : null}
      {installedVersionsDiffer(reviewedVersion, result, skills) ? (
        <p className={styles.changedText}>
          {t(
            "The registry stated version {version} when you reviewed it, and the server reports something else now. If you don't want this, remove it.",
            { version: reviewedVersion ?? "" },
          )}
        </p>
      ) : null}
      {!skills ? (
        <p>{t("Installed, but the list of skills couldn't be refreshed.")}</p>
      ) : null}
    </div>
  );
}
