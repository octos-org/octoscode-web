import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttachmentsDialog } from "./AttachmentsDialog.tsx";
import { AttachmentDraftStore } from "./attachment-drafts.ts";

describe("unmounted images dialog candidate", () => {
  it("fails closed before any selection or upload when the method is unadvertised", async () => {
    const commands = vi.fn();
    const store = new AttachmentDraftStore({
      scope: { authorityKey: "opaque-1", sessionId: "A", profileId: "p1" },
      commands,
      isCurrent: () => true,
    });
    const html = renderToStaticMarkup(
      <AttachmentsDialog store={store} onClose={() => {}} />,
    );
    expect(html).toContain("Image uploads are not advertised");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Upload selected images");
    expect(() =>
      store.selectFiles([new File(["test"], "a.png", { type: "image/png" })]),
    ).toThrow("unavailable");
    await expect(store.uploadSelected()).rejects.toThrow("unavailable");
    expect(commands).not.toHaveBeenCalled();
  });
  it("requires explicit file selection and upload, communicates scope and limits", () => {
    const commands = vi.fn();
    const store = new AttachmentDraftStore({
      scope: { authorityKey: "opaque-1", sessionId: "A", profileId: "p1" },
      uploadAvailable: true,
      commands,
      isCurrent: () => true,
    });
    const html = renderToStaticMarkup(
      <AttachmentsDialog store={store} onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".png,.jpg,.jpeg,.gif,.webp"');
    expect(html).toContain("Selecting a file does not upload it");
    expect(html).toContain("20 MiB each");
    expect(html).toContain("Profile: p1");
    expect(html).toContain("Session: A");
    expect(html).toContain('disabled="">Upload selected images');
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain('type="password"');
    expect(commands).not.toHaveBeenCalled();
  });

  it("shows escaped filenames and selected status without reading or uploading", () => {
    const commands = vi.fn();
    const store = new AttachmentDraftStore({
      scope: { authorityKey: "opaque-1", sessionId: "A", profileId: "p1" },
      uploadAvailable: true,
      commands,
      isCurrent: () => true,
    });
    store.selectFiles([
      new File(["synthetic"], "<private>.png", { type: "image/png" }),
    ]);
    const html = renderToStaticMarkup(
      <AttachmentsDialog store={store} onClose={() => {}} />,
    );
    expect(html).toContain("&lt;private&gt;.png");
    expect(html).not.toContain("<private>");
    expect(html).toContain("Selected; not uploaded");
    expect(html).not.toContain('disabled="">Upload selected images');
    expect(html).not.toContain("blob:");
    expect(commands).not.toHaveBeenCalled();
  });
});
