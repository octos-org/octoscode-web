import { describe, expect, it } from "vitest";
import {
  attachmentName,
  attachmentNameParts,
  formatAttachmentSize,
  isPreviewableImage,
  uniqueWorkspaceAttachmentFile,
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

  it("matches oversized workspace files by full relative path", () => {
    const workspace = {
      filename: "result.pdf",
      path: `pf/${btoa("users/session/workspace/reports/result.pdf")}/result.pdf`,
      size_bytes: 40,
    };
    const unrelated = {
      filename: "result.pdf",
      path: `pf/${btoa("users/session/workspace/other/result.pdf")}/result.pdf`,
      size_bytes: 50,
    };
    expect(
      uniqueWorkspaceAttachmentFile(
        "result.pdf",
        "/data/users/session/workspace",
        "session",
        [unrelated, workspace],
      ),
    ).toBeNull();
    expect(
      uniqueWorkspaceAttachmentFile(
        "reports/result.pdf",
        "/data/users/session/workspace",
        "session",
        [unrelated, workspace],
      ),
    ).toBe(workspace);
    expect(
      uniqueWorkspaceAttachmentFile(
        "result.pdf",
        "/data/users/session/workspace",
        "session",
        [unrelated, workspace, { ...workspace }],
      ),
    ).toBeNull();
    expect(
      uniqueWorkspaceAttachmentFile(
        "reports/result.pdf",
        "/external/project",
        "session",
        [workspace],
      ),
    ).toBeNull();
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
