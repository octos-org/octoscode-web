import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoopCreationControls } from "./LoopCreationControls.tsx";

describe("LoopCreationControls", () => {
  it("hides creation entirely without the advertised capability", () => {
    const createLoop = vi.fn(async () => true);
    expect(
      renderToStaticMarkup(
        <LoopCreationControls
          enabled={false}
          busy={false}
          createLoop={createLoop}
        />,
      ),
    ).toBe("");
    expect(createLoop).not.toHaveBeenCalled();
  });
  it("offers all native cadences and defaults to optional-prompt maintenance without auto-starting", () => {
    const createLoop = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      <LoopCreationControls enabled busy={false} createLoop={createLoop} />,
    );
    expect(html).toContain('value="maintenance" selected=""');
    for (const text of [
      "Self-paced",
      "Fixed interval",
      "Native /loop default",
      "Prompt (optional)",
      "Create loop",
      "server-owned work",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("required=");
    expect(html).not.toContain("disabled=");
    expect(createLoop).not.toHaveBeenCalled();
  });
  it("locks cadence, prompt and creation while the existing loop mutation gate is busy", () => {
    const html = renderToStaticMarkup(
      <LoopCreationControls
        enabled
        busy
        createLoop={vi.fn(async () => true)}
      />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain("closing this panel does not stop it");
  });
});
