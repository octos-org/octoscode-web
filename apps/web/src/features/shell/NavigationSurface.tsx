import type { ReactNode } from "react";
import styles from "./NavigationSurface.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import { ModalSurface } from "../../ui/ModalSurface.tsx";

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
  const t = useUiText();
  if (!compact) return children;
  if (!open) return null;
  return (
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
  );
}
