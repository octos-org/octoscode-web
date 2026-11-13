import { useEffect, useRef, useState } from "react";
import {
  APPUI_SKILL_METHODS,
  SKILLS_REVIEWED_INSTALL_FEATURE,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  InstalledSkill,
  SkillPackage,
} from "@octos-org/octoscode-client/skills";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./SkillsDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  readInstallReview,
  receiptMatchesPlan,
  reviewInstallDecision,
  reviewedInstallErrorKind,
  skillErrorText,
  type InstallReview,
  type InstallSource,
  type ReviewedInstallPlan,
} from "./install-review.ts";
import {
  InstallReviewFailure,
  InstallReviewPanel,
} from "./InstallReviewPanel.tsx";

type Commands = Awaited<ReturnType<OctosUiClient["skillCommands"]>>;

/**
 * Profile mutations are explicit, scoped and never presented as browser
 * installs. Install is offered only for a review the server can bind to an
 * immutable commit + artifact digest (UPCR-2026-R48CB467B); every other
 * source is reviewed read-only.
 */
export function SkillsDialog({
  client,
  profileId,
  capabilities,
  profileBusy,
  onMutationStart,
  onClose,
}: {
  client: OctosUiClient;
  profileId: string;
  capabilities: UiProtocolCapabilities;
  profileBusy: boolean;
  onMutationStart: () => () => void;
  onClose: () => void;
}) {
  const t = useUiText();
  const [installed, setInstalled] = useState<InstalledSkill[] | null>(null);
  const [packages, setPackages] = useState<SkillPackage[] | null>(null);
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [removal, setRemoval] = useState<string | null>(null);
  const [review, setReview] = useState<InstallReview | null>(null);
  const [installPlan, setInstallPlan] = useState<ReviewedInstallPlan | null>(
    null,
  );
  const [reviewFailure, setReviewFailure] = useState<{
    source: InstallSource;
    detail: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The server's own words behind `error`, shown only on request. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const authority = useRef(0);
  const requestPending = useRef(false);
  const mutationBlocked = useRef(profileBusy);
  mutationBlocked.current = profileBusy;
  const available = (method: string) => supportsMethod(capabilities, method);
  /** The reviewed-install METHOD is strict opt-in behind this feature. */
  const reviewedInstallNegotiated = supportsFeature(
    capabilities,
    SKILLS_REVIEWED_INSTALL_FEATURE,
  );

  /** A typed reviewed-install refusal, naming the package it refused. */
  function installErrorText(kind: string, name: string): string {
    switch (kind) {
      case "reviewed_install_registry_mismatch":
        return t(
          "{name} wasn't installed: the registry changed since this review. Review the source again before installing.",
          { name },
        );
      case "reviewed_install_verification_failed":
        return t(
          "{name} wasn't installed: its artifact failed the signature or checksum check.",
          { name },
        );
      case "reviewed_install_fetch_failed":
        return t(
          "{name} wasn't installed: the reviewed source or artifact couldn't be fetched.",
          { name },
        );
      case "reviewed_install_platform_unavailable":
        return t(
          "{name} wasn't installed: the registry has no artifact for this server's platform.",
          { name },
        );
      case "reviewed_install_already_installed":
        return t("{name} is already installed from this review.", { name });
      case "reviewed_install_unsupported_layout":
        return t(
          "{name} wasn't installed: the review-bound installer doesn't support this package's layout.",
          { name },
        );
      case "reviewed_install_unsafe_tree":
        return t(
          "{name} wasn't installed: the reviewed tree contains links or special files the installer refuses.",
          { name },
        );
      case "reviewed_install_publish_failed":
        return t(
          "{name} wasn't installed: the server couldn't publish it, so the previous state is unchanged.",
          { name },
        );
      case "reviewed_install_rebuild_failed":
        return t(
          "{name} wasn't installed: the server couldn't rebuild the profile runtime, so it rolled the install back.",
          { name },
        );
      default:
        return t("{name} wasn't installed.", { name });
    }
  }

  async function run(
    work: (commands: Commands, current: () => boolean) => Promise<void>,
    mutation = false,
  ) {
    if (requestPending.current || (mutation && mutationBlocked.current)) return;
    // A transient reconnect can render this dialog with no profile yet; a
    // request sent then would fail with a misleading "profile required" text.
    if (!profileId.trim()) return;
    requestPending.current = true;
    const ticket = authority.current;
    const current = () => ticket === authority.current;
    setBusy(true);
    // Each request's outcome replaces the last one's: an earlier install's
    // success must not stand under a later refusal.
    setError(null);
    setErrorDetail(null);
    setNotice(null);
    let release: (() => void) | undefined;
    try {
      const commands = await client.skillCommands(profileId, capabilities);
      if (!current() || (mutation && mutationBlocked.current)) return;
      if (mutation) {
        release = onMutationStart();
        setMutating(true);
      }
      await work(commands, current);
    } catch (cause) {
      if (current())
        setError(
          (mutation
            ? t(
                "Could not confirm the server change. It may have been applied; refresh the Profile before reviewing another attempt.",
              )
            : cause instanceof Error
              ? cause.message
              : "Skill request failed"
          ).slice(0, 512),
        );
    } finally {
      release?.();
      if (current()) {
        requestPending.current = false;
        setBusy(false);
        setMutating(false);
      }
    }
  }
  const refresh = () =>
    run(async (commands, current) => {
      const result = await commands.list();
      if (current()) setInstalled(result);
    });
  useEffect(() => {
    authority.current += 1;
    requestPending.current = false;
    void refresh();
    return () => {
      authority.current += 1;
    };
    // App keys this dialog by the complete authenticated Session authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, profileId]);

  function openReview(source: InstallSource) {
    // An earlier review must not stand in for this source while it loads.
    setReview(null);
    setReviewFailure(null);
    void run(async (commands, current) => {
      try {
        const result = await readInstallReview(
          source,
          available(APPUI_SKILL_METHODS.SEARCH)
            ? () => commands.search("")
            : null,
        );
        if (current()) setReview(result);
      } catch (cause) {
        if (current())
          setReviewFailure({ source, detail: skillErrorText(cause) });
      }
    });
  }

  function confirmRemoval() {
    const name = removal;
    if (!name) return;
    void run(async (commands, current) => {
      setRemoval(null);
      await commands.remove(name);
      if (!current()) return;
      setNotice(
        t("Removed {name} from server Profile {profileId}.", {
          name,
          profileId,
        }),
      );
      setPackages(null);
      const result = await commands.list();
      if (current()) setInstalled(result);
    }, true);
  }

  function confirmInstall() {
    const plan = installPlan;
    if (!plan) return;
    void run(async (commands, current) => {
      setInstallPlan(null);
      try {
        const receipt = await commands.installReviewed({
          package: plan.package,
          repo: plan.repo,
          sourceCommit: plan.sourceCommit,
          reviewedAt: plan.reviewedAt,
          platform: plan.platform,
          ...(plan.artifact ? { artifact: plan.artifact } : {}),
        });
        if (!current()) return;
        if (!receiptMatchesPlan(plan, receipt)) {
          // A confirmed install of a DIFFERENT object is a failure, not a win.
          setError(
            t(
              "The server reported an installed object that does not match this review; the refreshed state is shown and nothing was retried.",
            ),
          );
          closeReview();
        } else {
          setNotice(
            t("Installed {name} at the reviewed commit {commit}.", {
              name: receipt.installed.join(", ") || plan.package,
              commit: receipt.sourceCommit.slice(0, 12),
            }),
          );
          closeReview();
        }
      } catch (cause) {
        if (!current()) return;
        const kind = reviewedInstallErrorKind(cause);
        if (kind) {
          setError(installErrorText(kind, plan.package));
          setErrorDetail(skillErrorText(cause));
        } else {
          // Unknown outcome (timeout, dropped socket): never claim either way.
          setError(
            t(
              "The server did not confirm this install; it may have been applied. The refreshed state is shown and nothing was retried.",
            ),
          );
        }
        closeReview();
      }
      // State comes from the server, not from the button: re-read either way.
      // A dropped socket makes this best-effort; the reconnect refresh covers it.
      setPackages(null);
      try {
        const result = await commands.list();
        if (current()) setInstalled(result);
      } catch {
        // The connection-level refresh will repopulate the list.
      }
    }, true);
  }

  const closeReview = () => {
    setReview(null);
    setReviewFailure(null);
    setInstallPlan(null);
  };

  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="skills-title"
      onEscape={() => {
        if (!mutating) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="skills-title">{t("Profile skills")}</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {t("Refresh skills")}
        </button>
        <button type="button" disabled={mutating} onClick={onClose}>
          {t("Close skills")}
        </button>
      </header>
      <p className={styles.scope}>
        {t("Server Profile:") + " "}
        {profileId}
      </p>
      <p>
        {t(
          "Skills are shared by this Profile, not installed in your browser. An installed skill can run its code on the server, so review and trust the source first.",
        )}
      </p>
      {profileBusy ? (
        <p role="status">
          {t(
            "Skill changes are paused while known work is running in this Profile.",
          )}
        </p>
      ) : null}
      {busy ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          {errorDetail ? (
            <details>
              <summary>{t("The server's message")}</summary>
              <p>{errorDetail}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <section>
        <h3>{t("Installed skills")}</h3>
        {installed?.length === 0 ? (
          <p>{t("No skills installed in this Profile.")}</p>
        ) : null}
        <div className={styles.rows}>
          {installed?.map((skill) => (
            <article key={skill.name}>
              <strong>{skill.name}</strong>
              <p>
                {skill.version ?? t("Version not reported")} · {skill.toolCount}{" "}
                {t("tools")}
              </p>
              {skill.sourceRepo ? <p>{skill.sourceRepo}</p> : null}
              {skill.sourceCommit ? (
                <p>
                  {t("Reviewed commit")} <code>{skill.sourceCommit}</code>
                  {skill.artifactSha256 ? (
                    <>
                      {" · "}
                      <code>{skill.artifactSha256}</code>
                    </>
                  ) : null}
                </p>
              ) : null}
              {available(APPUI_SKILL_METHODS.REMOVE) ? (
                <button
                  type="button"
                  disabled={busy || profileBusy}
                  onClick={() => setRemoval(skill.name)}
                >
                  {t("Remove") + " "}
                  {skill.name}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      {available(APPUI_SKILL_METHODS.SEARCH) ? (
        <section>
          <h3>{t("Skill registry")}</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async (commands, current) => {
                const result = await commands.search(query);
                if (current()) setPackages(result.packages);
              });
            }}
          >
            <label>
              {t("Registry query")}
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t("Search registry")}
            </button>
          </form>
          {packages?.length === 0 ? (
            <p>{t("No matching skill packages.")}</p>
          ) : null}
          <div className={styles.rows}>
            {packages?.map((item) => (
              <article key={item.name}>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
                <p>{item.repo}</p>
                <p>
                  {item.version ?? t("Version not reported")} ·{" "}
                  {item.license ?? t("License not reported")}
                </p>
                {item.providesTools ? (
                  <p>{t("The registry says it provides executable tools")}</p>
                ) : null}
                {item.requires.length ? (
                  <p>
                    {t("Requires:") + " "}
                    {item.requires.join(", ")}
                  </p>
                ) : null}
                {item.installed ? (
                  <p>
                    {t("Installed:") + " "}
                    {item.installedSkills.join(", ")}
                  </p>
                ) : null}
                {available(APPUI_SKILL_METHODS.INSTALL) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRepo(item.repo);
                      setBranch("");
                      openReview({
                        repo: item.repo,
                        branch: "",
                        packageName: item.name,
                      });
                    }}
                  >
                    {t("Review the source of {name}", { name: item.name })}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {available(APPUI_SKILL_METHODS.INSTALL) ? (
        <section>
          <h3>{t("Look up a source")}</h3>
          <label>
            {t("Repository or server-side path")}
            <input
              value={repo}
              onChange={(event) => {
                setRepo(event.target.value);
                closeReview();
              }}
            />
          </label>
          <label>
            {t("Branch (server default: main)")}
            <input
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                closeReview();
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !repo.trim()}
            onClick={() =>
              openReview({ repo: repo.trim(), branch: branch.trim() })
            }
          >
            {t("Review source")}
          </button>
        </section>
      ) : null}
      {review ? (
        <InstallReviewPanel
          review={review}
          decision={reviewInstallDecision(review, {
            methodOffered: available(APPUI_SKILL_METHODS.INSTALL_REVIEWED),
            featureNegotiated: reviewedInstallNegotiated,
          })}
          busy={busy || profileBusy}
          onInstall={() => {
            const decision = reviewInstallDecision(review, {
              methodOffered: available(APPUI_SKILL_METHODS.INSTALL_REVIEWED),
              featureNegotiated: reviewedInstallNegotiated,
            });
            if (decision.ok) setInstallPlan(decision.plan);
          }}
          onClose={closeReview}
        />
      ) : null}
      {reviewFailure ? (
        <InstallReviewFailure
          detail={reviewFailure.detail}
          busy={busy}
          onRetry={() => openReview(reviewFailure.source)}
          onClose={closeReview}
        />
      ) : null}
      {installPlan ? (
        <section
          className={styles.confirmation}
          aria-label={t("Confirm skill change")}
        >
          <h3>{t("Confirm reviewed install")}</h3>
          <p>{installPlan.package}</p>
          <p>
            {t("The server installs exactly commit")}{" "}
            <code>{installPlan.sourceCommit}</code>
            {installPlan.artifact ? (
              <>
                {" "}
                {t("with signed artifact")}{" "}
                <code>{installPlan.artifact.sha256}</code>
              </>
            ) : null}
            {" " +
              t("and refuses if the registry or download no longer matches.")}
          </p>
          <p>
            {t("Applies to Profile") + " "}
            {profileId}
            {" " + t("and rebuilds its server skill runtime.")}
          </p>
          <button
            type="button"
            disabled={busy || profileBusy}
            onClick={confirmInstall}
          >
            {t("Confirm install")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setInstallPlan(null)}
          >
            {t("Cancel skill change")}
          </button>
        </section>
      ) : null}
      {removal ? (
        <section
          className={styles.confirmation}
          aria-label={t("Confirm skill change")}
        >
          <h3>{t("Confirm removal")}</h3>
          <p>{removal}</p>
          <p>
            {t("Applies to Profile") + " "}
            {profileId}
            {" " + t("and rebuilds its server skill runtime.")}{" "}
            {t(
              "Reinstall from the original source to recover the removed skill.",
            )}
          </p>
          <button
            type="button"
            disabled={busy || profileBusy}
            onClick={confirmRemoval}
          >
            {t("Confirm remove")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRemoval(null)}
          >
            {t("Cancel skill change")}
          </button>
        </section>
      ) : null}
    </ModalSurface>
  );
}
