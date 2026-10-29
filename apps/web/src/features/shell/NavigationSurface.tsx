import { lazy, Suspense, type ReactNode } from "react";
import styles from "./NavigationSurface.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

const ModalSurface = lazy(async () => ({
  default: (await import("../../ui/ModalSurface.tsx")).ModalSurface,
}));

export function NavigationSurface({
  compact,
  open,
  onClose,
  children,
}: {
  compact: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!compact) return children;
  const t = useUiText();
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ModalSurface
        backdropClassName={styles.backdrop!}
        dialogClassName={styles.drawer!}
        labelledBy="navigation-drawer-title"
        onEscape={onClose}
        closeOnBackdrop
      >
        <h2 className="sr-only" id="navigation-drawer-title">
          {t("Sessions and workspaces")}
        </h2>
        {children}
      </ModalSurface>
    </Suspense>
  );
}
