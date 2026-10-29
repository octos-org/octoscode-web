import { Component, Suspense, useId, useRef, type ReactNode } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./SurfaceBoundary.module.css";
import settingsShell from "../../ui/SettingsSurface.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

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
            {t(
              "This view could not be displayed. Other parts of the app remain available.",
            )}
          </p>
          <p>
            {t(
              "Reload the page to try again. Reloading may stop running work and discard drafts and queued messages.",
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
