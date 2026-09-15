import { Component, Suspense, useId, useRef, type ReactNode } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./SurfaceBoundary.module.css";

interface SurfaceBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  name?: string;
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
}: SurfaceBoundaryProps & { loading?: boolean }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      <h2 id={titleId}>
        {loading ? `Loading ${name.toLowerCase()}…` : `${name} unavailable`}
      </h2>
      {loading ? (
        fallback
      ) : (
        <div role="alert">
          <p>
            This view could not be displayed. Other parts of the app remain
            available.
          </p>
          <p>
            Reload the page to try again. Reloading may stop running work and
            discard drafts and queued messages.
          </p>
        </div>
      )}
      <div className={styles.actions}>
        {onDismiss ? (
          <button ref={closeRef} type="button" onClick={onDismiss}>
            {loading ? "Cancel" : "Close"}
          </button>
        ) : null}
        {!loading ? (
          <>
            {actions}
            <button type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </>
        ) : null}
      </div>
    </>
  );
  return onDismiss ? (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.panel!}
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
