import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalSurface } from "./ModalSurface.tsx";

// Where each surface asked to be mounted. createPortal validates that its
// container is a real DOM element, which this renderer has none of, so the
// portal target is recorded and the surface is rendered in place instead.
const portalContainers = vi.hoisted(() => [] as unknown[]);

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (node: ReactNode, container: unknown) => {
      portalContainers.push(container);
      return node;
    },
  };
});

const base = {
  backdropClassName: "modal-backdrop",
  dialogClassName: "modal-dialog",
  labelledBy: "modal-title",
};

describe("ModalSurface static dialog contract", () => {
  it("exposes a labelled modal dialog surface for assistive tech", () => {
    const html = renderToStaticMarkup(
      <ModalSurface {...base}>
        <h2 id="modal-title">Confirm action</h2>
      </ModalSurface>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="modal-title"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Confirm action");
  });

  it("wires aria-describedby only when a description is supplied", () => {
    const withDescription = renderToStaticMarkup(
      <ModalSurface {...base} describedBy="modal-desc">
        <p id="modal-desc">Details</p>
      </ModalSurface>,
    );
    expect(withDescription).toContain('aria-describedby="modal-desc"');

    const withoutDescription = renderToStaticMarkup(
      <ModalSurface {...base}>
        <p>Details</p>
      </ModalSurface>,
    );
    expect(withoutDescription).not.toContain("aria-describedby");
  });

  it("marks the backdrop as presentation and applies both class names", () => {
    const html = renderToStaticMarkup(
      <ModalSurface {...base}>
        <button type="button">Confirm</button>
      </ModalSurface>,
    );

    expect(html).toContain('role="presentation"');
    expect(html).toContain('class="modal-backdrop"');
    expect(html).toContain('class="modal-dialog"');
  });
});

describe("ModalSurface mount point", () => {
  afterEach(() => {
    portalContainers.length = 0;
    Reflect.deleteProperty(globalThis, "document");
  });

  it("mounts a surface opened from inside another at document.body, not inside its opener", () => {
    const body = { nodeName: "BODY" };
    Object.defineProperty(globalThis, "document", {
      value: { body },
      configurable: true,
    });

    const html = renderToStaticMarkup(
      <ModalSurface
        {...base}
        backdropClassName="pane-backdrop"
        dialogClassName="pane-dialog"
      >
        <h2 id="modal-title">Session settings</h2>
        <ModalSurface
          backdropClassName="risk-backdrop"
          dialogClassName="risk-dialog"
          labelledBy="risk-title"
          onEscape={() => {}}
        >
          <h2 id="risk-title">Give full access?</h2>
        </ModalSurface>
      </ModalSurface>,
    );

    // Both surfaces — the settings pane and the confirmation raised from
    // inside it — target document.body. Neither is handed the other's dialog
    // as its container, so Safari cannot trap the confirmation in the pane's
    // scrolling subtree.
    expect(portalContainers).toEqual([body, body]);
    expect(html).toContain('class="pane-dialog"');
    expect(html).toContain('class="risk-dialog"');
  });
});
