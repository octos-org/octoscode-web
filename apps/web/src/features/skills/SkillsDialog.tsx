import { useEffect, useRef, useState } from "react";
import {
  APPUI_SKILL_METHODS,
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

type Mutation =
  | { kind: "install"; repo: string; branch: string }
  | { kind: "remove"; name: string };

/** Profile mutations are explicit, scoped and never presented as browser installs. */
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
  const [confirmation, setConfirmation] = useState<Mutation | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const authority = useRef(0);
  const requestPending = useRef(false);
  const mutationBlocked = useRef(profileBusy);
  mutationBlocked.current = profileBusy;
  const available = (method: string) => supportsMethod(capabilities, method);

  async function run(
    work: (
      commands: Awaited<ReturnType<OctosUiClient["skillCommands"]>>,
      current: () => boolean,
    ) => Promise<void>,
    mutation = false,
  ) {
    if (requestPending.current || (mutation && mutationBlocked.current)) return;
    requestPending.current = true;
    const ticket = authority.current;
    const current = () => ticket === authority.current;
    setBusy(true);
    setError(null);
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
            ? "Could not confirm the server change. It may have been applied; refresh the Profile before reviewing another attempt."
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

  function confirmMutation() {
    const choice = confirmation;
    if (!choice) return;
    void run(async (commands, current) => {
      setConfirmation(null);
      if (choice.kind === "install") {
        const result = await commands.install(
          choice.repo,
          choice.branch || undefined,
        );
        if (!current()) return;
        setNotice(
          `Server installed: ${result.installed.join(", ") || "none"}. Skipped: ${result.skipped.join(", ") || "none"}. Dependencies: ${result.dependenciesInstalled.join(", ") || "none"}.`,
        );
      } else {
        await commands.remove(choice.name);
        if (!current()) return;
        setNotice(`Removed ${choice.name} from server Profile ${profileId}.`);
      }
      setConfirmation(null);
      setPackages(null);
      const result = await commands.list();
      if (current()) setInstalled(result);
    }, true);
  }

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
          "Skills are shared by this Profile, not installed in your browser. Installation may download executable tools and dependencies. Review and trust the source first.",
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
      {error ? <p role="alert">{error}</p> : null}
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
              {available(APPUI_SKILL_METHODS.REMOVE) ? (
                <button
                  type="button"
                  disabled={busy || profileBusy}
                  onClick={() =>
                    setConfirmation({ kind: "remove", name: skill.name })
                  }
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
                if (current()) setPackages(result);
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
                  {item.providesTools
                    ? t("Provides executable tools")
                    : t("Instruction skills")}{" "}
                  · {item.license ?? t("License not reported")}
                </p>
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
                    disabled={busy || profileBusy}
                    onClick={() => {
                      setRepo(item.repo);
                      setBranch("");
                      setConfirmation({
                        kind: "install",
                        repo: item.repo,
                        branch: "",
                      });
                    }}
                  >
                    {t("Review installation of") + " "}
                    {item.name}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {available(APPUI_SKILL_METHODS.INSTALL) ? (
        <section>
          <h3>{t("Install from source")}</h3>
          <label>
            {t("Repository or server-side path")}
            <input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
            />
          </label>
          <label>
            {t("Branch (server default: main)")}
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || profileBusy || !repo.trim()}
            onClick={() =>
              setConfirmation({
                kind: "install",
                repo: repo.trim(),
                branch: branch.trim(),
              })
            }
          >
            {t("Review installation")}
          </button>
        </section>
      ) : null}
      {confirmation ? (
        <section
          className={styles.confirmation}
          aria-label={t("Confirm skill change")}
        >
          <h3>
            {confirmation.kind === "install"
              ? t("Confirm server installation")
              : t("Confirm removal")}
          </h3>
          <p>
            {confirmation.kind === "install"
              ? t("{value0} · branch {value1}", {
                  value0: String(confirmation.repo),
                  value1: String(confirmation.branch || "main"),
                })
              : confirmation.name}
          </p>
          <p>
            {t("Applies to Profile") + " "}
            {profileId}
            {" " + t("and rebuilds its server skill runtime.")}
            {confirmation.kind === "install"
              ? " " + t("Existing skills are not forcibly overwritten.")
              : " " +
                t(
                  "Reinstall from the original source to recover the removed skill.",
                )}
          </p>
          <button
            type="button"
            disabled={busy || profileBusy}
            onClick={confirmMutation}
          >
            {t("Confirm") + " "}
            {confirmation.kind}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            {t("Cancel skill change")}
          </button>
        </section>
      ) : null}
    </ModalSurface>
  );
}
