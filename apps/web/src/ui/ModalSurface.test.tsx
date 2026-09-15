import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModalSurface } from "./ModalSurface.tsx";

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
