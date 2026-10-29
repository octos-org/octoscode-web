import { describe, expect, it } from "vitest";
import {
  attachmentName,
  attachmentNameParts,
  formatAttachmentSize,
  isPreviewableImage,
  uniqueAttachmentFile,
} from "./attachments.ts";

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

  it("formats server-reported byte sizes without guessing", () => {
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(999)).toBe("999 B");
    expect(formatAttachmentSize(1536)).toBe("1.5 KiB");
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe("2 MiB");
  });

  it("resolves a server file handle only when the match is unique", () => {
    const files = [
      { filename: "report.md", path: "pf/coding/report.md", size_bytes: 10 },
      { filename: "report.md", path: "/other/report.md", size_bytes: 20 },
    ];
    expect(uniqueAttachmentFile("pf/coding/report.md", files)).toBe(files[0]);
    expect(uniqueAttachmentFile("report.md", files)).toBeNull();
    expect(uniqueAttachmentFile("missing.md", files)).toBeNull();
    expect(
      uniqueAttachmentFile("/workspace/report.md", [
        {
          filename: "report.md",
          path: "pf/dXNlcnMvd2ViL3dvcmtzcGFjZS9yZXBvcnQubWQ/report.md",
          size_bytes: 20,
        },
      ]),
    ).toMatchObject({ size_bytes: 20 });
  });

  it("keeps the extension separate so truncation cannot hide the file type", () => {
    expect(
      attachmentNameParts("/work/quarterly-report-final-reviewed.xlsx"),
    ).toEqual({ stem: "quarterly-report-final-reviewed", extension: ".xlsx" });
    expect(attachmentNameParts("/work/.env")).toEqual({
      stem: ".env",
      extension: "",
    });
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
