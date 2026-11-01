/**
 * Touch press feedback. A mouse gets `:active` the moment the button goes
 * down; a finger does not: Chromium waits for its show-press delay (100–150ms)
 * and iOS only applies `:active` when something listens for touchstart. So on
 * touch and pen we mark the pressed control ourselves, and styles.css treats
 * `[data-pressed]` exactly like `:active`. The mark clears when the pointer
 * lifts or the browser takes the gesture over for scrolling (pointercancel).
 */
const PRESSABLE = 'button, summary, [role="treeitem"], label';
const CHOICE =
  'input[type="radio"]:not(:disabled), input[type="checkbox"]:not(:disabled)';

const RELEASE_EVENTS = ["pointerup", "pointercancel", "dragstart"] as const;

type PressTarget = Pick<
  Element,
  "closest" | "tagName" | "querySelector" | "setAttribute" | "removeAttribute"
>;

/** The control a press on `origin` belongs to, or null when it is inert. */
export function pressableFor(origin: unknown): PressTarget | null {
  if (!isElement(origin)) return null;
  const control: PressTarget | null = origin.closest(PRESSABLE);
  if (!control) return null;
  if (control.tagName === "BUTTON" && (control as HTMLButtonElement).disabled)
    return null;
  // A plain form label is not a control; only choice cards press.
  if (control.tagName === "LABEL" && !control.querySelector(CHOICE))
    return null;
  return control;
}

function isElement(value: unknown): value is PressTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<PressTarget>).closest === "function"
  );
}

export function installTouchPress(
  target: Pick<Document, "addEventListener" | "removeEventListener"> = document,
): () => void {
  let pressed: PressTarget | null = null;
  const release = () => {
    pressed?.removeAttribute("data-pressed");
    pressed = null;
  };
  const press = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    release();
    const control = pressableFor(event.target);
    if (!control) return;
    pressed = control;
    control.setAttribute("data-pressed", "");
  };
  const options = { capture: true, passive: true } as const;
  target.addEventListener("pointerdown", press, options);
  for (const type of RELEASE_EVENTS)
    target.addEventListener(type, release, options);
  return () => {
    release();
    target.removeEventListener("pointerdown", press, options);
    for (const type of RELEASE_EVENTS)
      target.removeEventListener(type, release, options);
  };
}
