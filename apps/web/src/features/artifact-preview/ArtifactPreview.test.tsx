import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./ArtifactPreview.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ArtifactPreview", () => {
  it("renders text with path and download actions", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreview
        name="check.txt"
        path="/work/reports/check.txt"
        text="68 tests passed"
      />,
    );
    expect(html).toContain("68 tests passed");
    expect(html).toContain("Copy path");
    expect(html).toContain("Download");
    expect(html).toContain('data-artifact-kind="text"');
  });

  it("keeps an unsupported file downloadable instead of inventing a preview", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreview name="archive.zip" text="not the archive bytes" />,
    );
    expect(html).toContain(
      "This file type doesn&#x27;t have an inline preview.",
    );
    expect(html).toContain("Download it to open it in another app.");
    expect(html).not.toContain("not the archive bytes");
  });

  it("uses a server-reported text kind when the title has no extension", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreview
        name="Native verification report"
        kind="text"
        text="verification passed"
      />,
    );
    expect(html).toContain("verification passed");
    expect(html).toContain('data-artifact-kind="text"');
  });

  it("does not transfer a delivered blob before its size is verified", async () => {
    const loadBlob = vi.fn(async () => new Blob(["pdf"]));
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(
        <ArtifactPreview
          name="large.pdf"
          sizeRequired
          sizePending
          loadBlob={loadBlob}
        />,
      );
    });
    expect(loadBlob).not.toHaveBeenCalled();
    await act(async () => {
      root.update(
        <ArtifactPreview
          name="large.pdf"
          sizeRequired
          sizeBytes={60 * 1024 * 1024}
          loadBlob={loadBlob}
        />,
      );
    });
    expect(loadBlob).not.toHaveBeenCalled();
    await act(async () => {
      root.update(
        <ArtifactPreview name="large.pdf" sizeRequired loadBlob={loadBlob} />,
      );
    });
    expect(loadBlob).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps supplied paginated text visible above the blob size limit", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreview
        name="large.log"
        text="bounded server page"
        sizeBytes={11 * 1024 * 1024}
        hasMore
        onLoadMore={() => {}}
      />,
    );
    expect(html).toContain("bounded server page");
    expect(html).toContain("Load more artifact");
  });

  it("pages long plain text instead of putting the whole file in the DOM", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreview name="large.log" text={"x".repeat(60_000)} />,
    );
    expect(html).toContain("Show more");
    expect(html).not.toContain("x".repeat(60_000));
  });
});
