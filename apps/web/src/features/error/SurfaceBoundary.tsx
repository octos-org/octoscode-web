import {
  Component,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./SurfaceBoundary.module.css";
import settingsShell from "../../ui/SettingsSurface.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import { servedBuildChanged } from "./served-build.ts";

interface SurfaceBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  name?: string;
  loadingSize?: "settings";
  onDismiss?: (() => void) | undefined;
  actions?: ReactNode;
}

/** A failed view must not unmount the session owner above this boundary. */
export class SurfaceBoundary extends Component<
  SurfaceBoundaryProps,
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) return <UnavailableSurface {...this.props} />;
    return (
      <Suspense
        fallback={
          this.props.onDismiss ? (
            <UnavailableSurface {...this.props} loading />
          ) : (
            this.props.fallback
          )
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}

function UnavailableSurface({
  name = "View",
  onDismiss,
  actions,
  fallback,
  loading = false,
  loadingSize,
}: SurfaceBoundaryProps & { loading?: boolean }) {
  const t = useUiText();
  const settingsLoading = loading && loadingSize === "settings";
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  // After a deployment this window's chunks are gone; say so, not "failed".
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (loading) return;
    let current = true;
    void servedBuildChanged().then(
      (changed) => current && setUpdated(changed),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [loading]);
  const content = (
    <>
      <h2 id={titleId}>
        {loading
          ? t("Loading {name}…", { name: t(name).toLowerCase() })
          : t("{name} unavailable", { name: t(name) })}
      </h2>
      {loading ? (
        fallback
      ) : (
        <div role="alert">
          <p>
            {updated
              ? t(
                  "Octoscode was updated on the server, so this window can no longer load this view. Reload to use the new version.",
                )
              : t(
                  "This view could not be displayed. Other parts of the app remain available. Reload the page to try again.",
                )}
          </p>
          <p>
            {t(
              "Reloading keeps the drafts this browser saved; messages waiting to send are lost.",
            )}
          </p>
        </div>
      )}
      <div className={styles.actions}>
        {onDismiss ? (
          <button ref={closeRef} type="button" onClick={onDismiss}>
            {loading ? t("Cancel") : t("Close")}
          </button>
        ) : null}
        {!loading ? (
          <>
            {actions}
            <button type="button" onClick={() => window.location.reload()}>
              {t("Reload app")}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
  return onDismiss ? (
    <ModalSurface
      backdropClassName={
        settingsLoading ? settingsShell.overlay! : styles.backdrop!
      }
      dialogClassName={
        settingsLoading
          ? `${settingsShell.frame} ${styles.settingsPanel}`
          : styles.panel!
      }
      labelledBy={titleId}
      initialFocusRef={closeRef}
      onEscape={onDismiss}
      closeOnBackdrop
    >
      {content}
    </ModalSurface>
  ) : (
    <section className={styles.panel} aria-labelledby={titleId}>
      {content}
    </section>
  );
}
