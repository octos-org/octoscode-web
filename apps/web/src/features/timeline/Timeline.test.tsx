import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";

describe("Timeline", () => {
  it("uses the shared Octos mark in the connected conversation empty state", () => {
    const html = renderToStaticMarkup(<Timeline entries={[]} connected />);

    expect(html).toContain("Ask Octos to work on this repository");
    expect(html).toContain('data-octopus-logo=""');
    expect(html).not.toContain("⌁");
  });
});
