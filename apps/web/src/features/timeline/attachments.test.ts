import { describe, expect, it } from "vitest";
import { attachmentName, isPreviewableImage } from "./attachments.ts";

describe("attachment naming", () => {
  it("names a server path by its file", () => {
    expect(attachmentName("/work/new-octos/_build/p20-art.png")).toBe(
      "p20-art.png",
    );
    expect(attachmentName("C:\\work\\deck.pptx")).toBe("deck.pptx");
  });

  it("names an upload handle by its display segment", () => {
    expect(attachmentName("up/ZGV2L3VwLnR4dA/notes.txt")).toBe("notes.txt");
  });

  it("falls back to the raw reference when there is no file name", () => {
    expect(attachmentName("/")).toBe("/");
    expect(attachmentName("")).toBe("file");
  });
});

describe("image preview", () => {
  it("previews common raster images only", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp"])
      expect(isPreviewableImage(name), name).toBe(true);
    for (const name of ["deck.pptx", "logo.svg", "notes.txt", "png"])
      expect(isPreviewableImage(name), name).toBe(false);
  });
});
