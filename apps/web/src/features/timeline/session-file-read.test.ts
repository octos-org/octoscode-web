import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import {
  deliveredArtifactWorkspacePath,
  readSessionFileBlob,
  readSessionFileSize,
  sessionUploadWorkspacePath,
} from "./session-file-read.ts";

describe("session file blob reader", () => {
  it("maps delivered references to Core's delivery-time copy path", async () => {
    const reference = "/external/reports/photo.png";
    const bucket = createHash("sha256")
      .update(reference)
      .digest("hex")
      .slice(0, 32);
    await expect(deliveredArtifactWorkspacePath(reference)).resolves.toBe(
      `.artifacts/delivered/${bucket}/photo.png`,
    );
    await expect(
      deliveredArtifactWorkspacePath("up/encoded/photo.png"),
    ).resolves.toBeNull();
  });

  it("maps uploaded handles to their materialized workspace path", () => {
    expect(sessionUploadWorkspacePath("up/encoded/photo.png")).toBe(
      "uploads/photo.png",
    );
    expect(sessionUploadWorkspacePath("report.md")).toBeNull();
  });

  it("joins ordered chunks and preserves the server MIME type", async () => {
    let calls = 0;
    const client = {
      async readSessionFile(params: { offset?: number }) {
        calls += 1;
        if (calls === 1) {
          expect(params.offset ?? 0).toBe(0);
          return {
            session_id: "s1",
            path: "report.md",
            size_bytes: 5,
            offset: 0,
            eof: false,
            mime_type: "text/markdown",
            encoding: "base64",
            content_base64: "aGVs",
          };
        }
        expect(params.offset).toBe(3);
        return {
          session_id: "s1",
          path: "report.md",
          size_bytes: 5,
          offset: 3,
          eof: true,
          mime_type: "text/markdown",
          encoding: "base64",
          content_base64: "bG8=",
        };
      },
    } as unknown as OctosUiClient;
    const blob = await readSessionFileBlob(client, "s1", "report.md");
    expect(blob.type).toBe("text/markdown");
    expect(await blob.text()).toBe("hello");
  });

  it("reads authoritative size with a one-byte request", async () => {
    const client = {
      async readSessionFile(params: { length?: number }) {
        expect(params.length).toBe(1);
        return {
          session_id: "s1",
          path: "report.md",
          size_bytes: 476,
          offset: 0,
          eof: false,
          mime_type: "text/markdown",
          encoding: "base64",
          content_base64: "Iw==",
        };
      },
    } as unknown as OctosUiClient;
    await expect(readSessionFileSize(client, "s1", "report.md")).resolves.toBe(
      476,
    );
  });

  it("rejects a different returned scope", async () => {
    const client = {
      async readSessionFile() {
        return {
          session_id: "other",
          path: "report.md",
          size_bytes: 5,
          offset: 0,
          eof: true,
          mime_type: "text/markdown",
          encoding: "base64",
          content_base64: "aGVsbG8=",
        };
      },
    } as unknown as OctosUiClient;
    await expect(
      readSessionFileBlob(client, "s1", "report.md"),
    ).rejects.toThrow("different scope");
  });
});
