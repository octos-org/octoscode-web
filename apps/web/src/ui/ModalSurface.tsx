import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

interface ModalSurfaceProps {
  backdropClassName: string;
  dialogClassName: string;
  labelledBy: string;
  describedBy?: string;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  onEscape?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Only the most recently opened surface owns keyboard and focus. A review may
// sit above an approval whose Escape handler interrupts the active turn.
const modalStack: HTMLDivElement[] = [];

/** Shared keyboard and focus boundary for blocking product surfaces. */
export function ModalSurface({
  backdropClassName,
  dialogClassName,
  labelledBy,
  describedBy,
  busy,
  initialFocusRef,
  closeOnBackdrop = false,
  onEscape,
  onKeyDown,
  children,
}: ModalSurfaceProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  // While open, hide the app background from assistive tech so this surface is
  // the only announced content. The exact prior state is restored on close or
  // unmount, including an unmount while the surface is still open.
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const background =
      document.querySelector<HTMLElement>("main.workspace-grid") ??
      backdrop.parentElement?.querySelector<HTMLElement>(":scope > main") ??
      null;
    // Never hide a container that holds this surface.
    if (!background || background.contains(backdrop)) return;
    const previousAriaHidden = background.getAttribute("aria-hidden");
    background.setAttribute("aria-hidden", "true");
    return () => {
      if (background.getAttribute("aria-hidden") !== "true") return;
      if (previousAriaHidden === null) {
        background.removeAttribute("aria-hidden");
      } else {
        background.setAttribute("aria-hidden", previousAriaHidden);
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modalStack.push(dialog);
    const frame = requestAnimationFrame(() => {
      if (modalStack.at(-1) === dialog) {
        (initialFocusRef?.current ?? dialog).focus();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== dialog) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Tab") return;
      const candidates = [
        ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0 &&
          window.getComputedStyle(element).visibility === "visible" &&
          !element.closest("[inert]"),
      );
      // A radio group contributes one Tab stop, even when its checked input
      // is not the first DOM child. Otherwise backward Tab can leave the modal.
      const focusable = candidates.filter((element) => {
        if (
          !(element instanceof HTMLInputElement) ||
          element.type !== "radio" ||
          !element.name
        )
          return true;
        const group = candidates.filter(
          (candidate): candidate is HTMLInputElement =>
            candidate instanceof HTMLInputElement &&
            candidate.type === "radio" &&
            candidate.name === element.name &&
            candidate.form === element.form,
        );
        return element === (group.find((radio) => radio.checked) ?? group[0]);
      });
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === dialog || active === first || !dialog.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Inner menus and search fields consume Escape before their owning modal.
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        modalStack.at(-1) !== dialog ||
        !onEscapeRef.current
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleEscape);
      const wasTop = modalStack.at(-1) === dialog;
      const index = modalStack.indexOf(dialog);
      if (index !== -1) modalStack.splice(index, 1);
      if (!wasTop) return;
      const parent = modalStack.at(-1);
      if (previous?.isConnected && (!parent || parent.contains(previous))) {
        previous.focus();
      } else {
        parent?.focus();
      }
    };
  }, [initialFocusRef]);

  return (
    <div
      className={backdropClassName}
      ref={backdropRef}
      role="presentation"
      onMouseDown={(event) => {
        if (
          closeOnBackdrop &&
          onEscape &&
          event.target === event.currentTarget
        ) {
          onEscape();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={dialogClassName}
        role="dialog"
        aria-modal="true"
        {...(busy === undefined ? {} : { "aria-busy": busy })}
        aria-labelledby={labelledBy}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (modalStack.at(-1) === dialogRef.current) onKeyDown?.(event);
        }}
      >
        {children}
      </div>
    </div>
  );
}
