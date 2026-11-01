import { describe, expect, it } from "vitest";
import { installTouchPress, pressableFor } from "./touch-press.ts";

type Listener = (event: { pointerType?: string; target?: unknown }) => void;

function fakeElement(
  tagName: string,
  options: { disabled?: boolean; choice?: boolean } = {},
) {
  const attributes = new Map<string, string>();
  const element = {
    tagName,
    disabled: options.disabled ?? false,
    closest: () => element,
    querySelector: () => (options.choice ? {} : null),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    pressed: () => attributes.has("data-pressed"),
  };
  return element;
}

function fakeDocument() {
  const listeners = new Map<string, Listener>();
  return {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    fire: (type: string, event: { pointerType?: string; target?: unknown }) =>
      listeners.get(type)?.(event),
    listening: () => listeners.size,
  };
}

describe("touch press", () => {
  it("marks the pressed control on touch until the finger lifts", () => {
    const doc = fakeDocument();
    const button = fakeElement("BUTTON");
    const uninstall = installTouchPress(doc as unknown as Document);
    doc.fire("pointerdown", { pointerType: "touch", target: button });
    expect(button.pressed()).toBe(true);
    doc.fire("pointerup", { pointerType: "touch" });
    expect(button.pressed()).toBe(false);
    doc.fire("pointerdown", { pointerType: "pen", target: button });
    doc.fire("pointercancel", { pointerType: "pen" });
    expect(button.pressed()).toBe(false);
    uninstall();
    expect(doc.listening()).toBe(0);
  });

  it("leaves mouse presses to :active", () => {
    const doc = fakeDocument();
    const button = fakeElement("BUTTON");
    installTouchPress(doc as unknown as Document);
    doc.fire("pointerdown", { pointerType: "mouse", target: button });
    expect(button.pressed()).toBe(false);
  });

  it("ignores disabled buttons and plain form labels", () => {
    expect(pressableFor(fakeElement("BUTTON", { disabled: true }))).toBeNull();
    expect(pressableFor(fakeElement("LABEL"))).toBeNull();
    expect(pressableFor(fakeElement("LABEL", { choice: true }))).not.toBeNull();
    expect(pressableFor(null)).toBeNull();
    expect(pressableFor({})).toBeNull();
  });
});
