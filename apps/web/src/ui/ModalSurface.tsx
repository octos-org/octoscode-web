import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface ModalSurfaceProps {
  backdropClassName: string;
  dialogClassName: string;
  labelledBy: string;
  describedBy?: string;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  /**
   * Whether this surface hides the app behind it from assistive tech.
   *
   * True for a surface that owns the whole window. False for a takeover that
   * belongs to ONE session — an approval or a question — because the operator
   * is expected to keep working in other sessions while it waits. Before
   * surfaces moved to the page root this distinction was accidental: a surface
   * rendered inside the shell skipped the hiding because the shell contained
   * it, and only a surface outside it ever hid anything.
   */
  hidesBackground?: boolean;
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
  hidesBackground = true,
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
    if (!hidesBackground) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const background =
      // The workspace shell is a plain <div> since v0.10.0 (the <main>
      // landmark moved inside it, onto #workspace-main), so match the shell by
      // class alone. A tag-qualified "main.workspace-grid" silently found
      // nothing and left the whole background announced to assistive tech.
      document.querySelector<HTMLElement>(".workspace-grid") ??
      // The backdrop is portalled into <body>, so this fallback now looks for a
      // top-level <main> beside the surface rather than one beside it inside
      // the app container. Both resolve to the same shell in practice.
      backdrop.parentElement?.querySelector<HTMLElement>(":scope > main") ??
      null;
    // Never hide a container that holds this surface. With the body portal a
    // surface is no longer a descendant of the shell, so this guard only fires
    // when a test or embedder renders the shell around <body> itself.
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
  }, [hidesBackground]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modalStack.push(dialog);
    // Surfaces render at the page root, so nesting no longer decides which one
    // is on top: a confirmation opened from inside another dialog is its
    // sibling, and the opener's own z-index could sit above it and swallow the
    // clicks. Layer by open order instead, above whatever the callers' modules
    // declare. Restored on close so a reopened surface starts clean.
    const backdropElement = backdropRef.current;
    const previousZIndex = backdropElement?.style.zIndex ?? "";
    if (backdropElement) {
      backdropElement.style.zIndex = String(1000 + modalStack.length * 10);
    }
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
      if (backdropElement) backdropElement.style.zIndex = previousZIndex;
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

  const surface = (
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

  // Every surface mounts at document.body rather than where it was written.
  // Safari does not reliably anchor a position:fixed element to the viewport
  // once an ancestor scrolls or establishes a containing block, so the
  // full-access confirmation raised from the scrolled session settings pane
  // rendered inside that pane's scrollable subtree: the backdrop appeared with
  // no reachable dialog, and the choice could be neither confirmed nor
  // dismissed. A body-level portal keeps a surface opened from inside another
  // out of its opener's stacking and containing-block context.
  //
  // The static renderer has no document to portal into, and createPortal
  // rejects a non-element container, so server rendering keeps the same markup
  // in place. Only the browser path can hit the Safari defect.
  return typeof document === "undefined"
    ? surface
    : createPortal(surface, document.body);
}
