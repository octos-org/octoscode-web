import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OctopusLogo } from "./OctopusLogo.tsx";

describe("OctopusLogo", () => {
  it("renders the shared decorative product mark at the requested size", () => {
    const html = renderToStaticMarkup(
      <OctopusLogo className="surface-mark" size={32} />,
    );

    expect(html).toContain("<svg");
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-octopus-logo=""');
    expect(html).toContain("surface-mark");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("style=");
  });
});
