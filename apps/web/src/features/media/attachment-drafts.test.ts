import { describe, expect, it, vi } from "vitest";
import { type TurnMedia } from "@octos-org/octoscode-client/media";
import {
  AttachmentDraftStore,
  type AttachmentScope,
  type AttachmentUploadCommands,
} from "./attachment-drafts.ts";

const scope: AttachmentScope = {
  authorityKey: "auth-1/runtime-1",
  sessionId: "A",
  profileId: "p1",
};
const file = (name = "image.png", type = "image/png") =>
  new File(["synthetic image bytes"], name, { type });
function receipt(image: File, profile = "p1", marker = "uploaded"): TurnMedia {
  return {
    path: `up/${btoa(`${profile}/${marker}`).replace(/=/g, "")}/${image.name}`,
    mime: image.type,
    size_bytes: image.size,
  };
}
function fixture(
  options: {
    scope?: AttachmentScope;
    upload?: AttachmentUploadCommands["upload"];
  } = {},
) {
  let current = true;
  const owner = options.scope ?? scope;
  const upload = vi.fn(
    options.upload ?? (async (image: File) => receipt(image, owner.profileId)),
  );
  const commands = vi.fn(async () => ({ upload }));
  const store = new AttachmentDraftStore({
    scope: owner,
    uploadAvailable: true,
    commands,
    isCurrent: () => current,
  });
  return {
    store,
    upload,
    commands,
    retire: () => {
      current = false;
    },
  };
}

describe("per-Session attachment drafts", () => {
  it("consumes attachments only after successful local queue admission", async () => {
    const { store, upload, retire } = fixture();
    store.selectFiles([file()]);
    await store.uploadSelected();
    expect(store.submitTurn(scope, () => false)).toBe(false);
    expect(store.getSnapshot().entries).toHaveLength(1);
    let attached: TurnMedia[] = [];
    expect(
      store.submitTurn(scope, (media) => {
        attached = media;
        return true;
      }),
    ).toBe(true);
    expect(attached).toHaveLength(1);
    expect(store.getSnapshot().entries).toHaveLength(0);
    expect(attached[0]!.mime).toBe("image/png");
    store.selectFiles([file("new-draft.png")]);
    expect(store.restoreUploaded(attached)).toBe(false);
    expect(store.getSnapshot().entries[0]?.name).toBe("new-draft.png");
    store.remove(store.getSnapshot().entries[0]!.id);
    expect(store.restoreUploaded(attached)).toBe(true);
    expect(store.getSnapshot().entries[0]).toMatchObject({
      name: "image.png",
      status: "ready",
    });
    expect(store.takeForTurn(scope)).toEqual(attached);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(() =>
      store.restoreUploaded([receipt(file(), "other-profile")]),
    ).toThrow("Profile");
    retire();
    expect(() => store.restoreUploaded(attached)).toThrow("authority");
  });

  it("rejects wrong-profile, arbitrary-path and mismatched-size receipts without exposing errors", async () => {
    const image = file();
    for (const result of [
      receipt(image, "p2"),
      { ...receipt(image), path: "/private/arbitrary.png" },
      { ...receipt(image), size_bytes: 999 },
    ]) {
      const { store } = fixture({ upload: async () => result });
      store.selectFiles([image]);
      await store.uploadSelected();
      expect(store.getSnapshot().entries[0]!.status).toBe("error");
      expect(() => store.takeForTurn(scope)).toThrow("every selected");
    }
    const { store } = fixture({
      upload: async () => {
        throw new Error("private-path synthetic-secret");
      },
    });
    store.selectFiles([image]);
    await store.uploadSelected();
    expect(JSON.stringify(store.getSnapshot())).not.toContain(
      "synthetic-secret",
    );
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private-path");
  });
});
