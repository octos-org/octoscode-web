import { describe, expect, it, vi } from "vitest";
import type { TurnMedia } from "@octos-org/octoscode-client/media";
import {
  AttachmentDraftStore,
  MAX_IMAGE_BYTES,
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
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
  it("selection never uploads, stores no File in presentation, and publishes immutable snapshots", async () => {
    const { store, upload, commands } = fixture();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.selectFiles([file()]);
    expect(commands).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = store.getSnapshot();
    expect(snapshot.entries[0]).toMatchObject({
      name: "image.png",
      status: "selected",
      mime: "image/png",
    });
    expect(Object.keys(snapshot.entries[0]!)).toEqual([
      "id",
      "name",
      "bytes",
      "mime",
      "status",
      "error",
    ]);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    unsubscribe();
    await store.uploadSelected();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(snapshot.entries[0]!.status).toBe("selected");
    expect(store.getSnapshot().entries[0]!.status).toBe("ready");
  });

  it("validates each batch atomically, rejects nonimages, empty images and MIME disguises", () => {
    const { store } = fixture();
    store.selectFiles([file()]);
    for (const invalid of [
      file("notes.txt", "text/plain"),
      file("photo.png", "image/svg+xml"),
      new File([], "empty.png", { type: "image/png" }),
    ]) {
      expect(() =>
        store.selectFiles([file("valid.webp", "image/webp"), invalid]),
      ).toThrow();
      expect(store.getSnapshot().entries).toHaveLength(1);
    }
    expect(() =>
      store.selectFiles(Array.from({ length: 4 }, () => file())),
    ).toThrow("four");
    expect(store.getSnapshot().entries).toHaveLength(1);
  });

  it("enforces the 20 MiB per-image boundary and accepts all four TUI image formats", () => {
    const { store } = fixture();
    const boundary = file("large.png");
    Object.defineProperty(boundary, "size", { value: MAX_IMAGE_BYTES });
    store.selectFiles([
      boundary,
      file("photo.JPEG", "image/jpeg"),
      file("anim.gif", "image/gif"),
      file("web.webp", "image/webp"),
    ]);
    expect(store.getSnapshot().entries).toHaveLength(4);
    const tooLarge = file();
    Object.defineProperty(tooLarge, "size", { value: MAX_IMAGE_BYTES + 1 });
    expect(() => fixture().store.selectFiles([tooLarge])).toThrow("20 MiB");
  });

  it("normalizes an absent browser MIME before the explicitly requested upload", async () => {
    const { store, upload } = fixture();
    store.selectFiles([file("photo.jpg", "")]);
    await store.uploadSelected();
    expect(upload.mock.calls[0]![0].type).toBe("image/jpeg");
    expect(store.takeForTurn(scope)[0]!.mime).toBe("image/jpeg");
  });

  it("deduplicates same-tick uploads and waits for all selected image receipts", async () => {
    const first = deferred<TurnMedia>();
    const second = deferred<TurnMedia>();
    const a = file("a.png"),
      b = file("b.png");
    const { store, upload } = fixture({
      upload: (image) =>
        image.name === "a.png" ? first.promise : second.promise,
    });
    store.selectFiles([a, b]);
    const running = store.uploadSelected();
    const repeated = store.uploadSelected();
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    first.resolve(receipt(a));
    await flush();
    expect(store.getSnapshot().uploading).toBe(true);
    expect(() => store.takeForTurn(scope)).toThrow("every selected");
    second.resolve(receipt(b));
    await Promise.all([running, repeated]);
    expect(store.getSnapshot().uploading).toBe(false);
    expect(store.takeForTurn(scope)).toHaveLength(2);
  });

  it("canceling a deferred factory prevents any network dispatch", async () => {
    const factory = deferred<AttachmentUploadCommands>();
    const upload = vi.fn(async (image: File) => receipt(image));
    const store = new AttachmentDraftStore({
      scope,
      uploadAvailable: true,
      commands: () => factory.promise,
      isCurrent: () => true,
    });
    store.selectFiles([file()]);
    const running = store.uploadSelected();
    store.cancelUploads();
    factory.resolve({ upload });
    await running;
    expect(upload).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      uploading: false,
      entries: [{ status: "selected" }],
    });
  });

  it("a canceled request cannot overwrite or unlock its explicit retry", async () => {
    const old = deferred<TurnMedia>(),
      fresh = deferred<TurnMedia>();
    const image = file();
    let attempt = 0;
    const { store, upload } = fixture({
      upload: () => (++attempt === 1 ? old.promise : fresh.promise),
    });
    store.selectFiles([image]);
    const pendingOld = store.uploadSelected();
    await flush();
    const oldSignal = upload.mock.calls[0]![1]!;
    store.cancelUploads();
    expect(oldSignal.aborted).toBe(true);
    const pendingFresh = store.uploadSelected();
    await flush();
    old.resolve(receipt(image, "p1", "old"));
    await pendingOld;
    expect(store.getSnapshot()).toMatchObject({
      uploading: true,
      entries: [{ status: "uploading" }],
    });
    fresh.resolve(receipt(image, "p1", "fresh"));
    await pendingFresh;
    expect(store.takeForTurn(scope)).toEqual([receipt(image, "p1", "fresh")]);
  });

  it("removing an in-flight entry aborts it and ignores a late receipt", async () => {
    const response = deferred<TurnMedia>();
    const image = file();
    const { store, upload } = fixture({ upload: () => response.promise });
    store.selectFiles([image]);
    const running = store.uploadSelected();
    await flush();
    store.remove(store.getSnapshot().entries[0]!.id);
    expect(upload.mock.calls[0]![1]!.aborted).toBe(true);
    response.resolve(receipt(image));
    await running;
    expect(store.getSnapshot().entries).toEqual([]);
  });

  it("retired same-ID authority cannot populate a replacement Session draft", async () => {
    const response = deferred<TurnMedia>();
    const image = file();
    const old = fixture({ upload: () => response.promise });
    const replacement = fixture({
      scope: { ...scope, authorityKey: "auth-2/runtime-1" },
    });
    old.store.selectFiles([image]);
    const running = old.store.uploadSelected();
    await flush();
    old.retire();
    replacement.store.selectFiles([file("new.png")]);
    response.resolve(receipt(image));
    await running;
    expect(old.store.getSnapshot()).toMatchObject({
      disposed: true,
      entries: [],
      uploading: false,
    });
    expect(replacement.store.getSnapshot().entries).toMatchObject([
      { name: "new.png", status: "selected" },
    ]);
    expect(() => old.store.takeForTurn(scope)).toThrow("no longer");
  });

  it("keeps parallel Session uploads independent of selection and scope", async () => {
    const gate = deferred<TurnMedia>();
    const a = fixture({ upload: () => gate.promise });
    const bScope = { ...scope, sessionId: "B" };
    const b = fixture({ scope: bScope });
    const image = file("a.png");
    a.store.selectFiles([image]);
    const running = a.store.uploadSelected();
    b.store.selectFiles([file("b.png")]);
    await b.store.uploadSelected();
    gate.resolve(receipt(image));
    await running;
    expect(() => a.store.takeForTurn(bScope)).toThrow("another Session");
    expect(a.store.getSnapshot().entries).toHaveLength(1);
    expect(b.store.takeForTurn(bScope)[0]!.path).toContain("b.png");
    const queuedA = a.store.takeForTurn(scope);
    a.store.selectFiles([file("later.png")]);
    expect(queuedA).toEqual([receipt(image)]);
    expect(a.store.getSnapshot().entries[0]!.name).toBe("later.png");
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

  it("disposal aborts all work and releases the local draft before late completion", async () => {
    const response = deferred<TurnMedia>();
    const image = file();
    const { store, upload } = fixture({ upload: () => response.promise });
    store.selectFiles([image]);
    const running = store.uploadSelected();
    await flush();
    store.invalidate();
    expect(upload.mock.calls[0]![1]!.aborted).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      disposed: true,
      uploading: false,
      entries: [],
    });
    response.resolve(receipt(image));
    await running;
    expect(() => store.selectFiles([image])).toThrow("no longer");
  });

  it("treats an identical re-add as an idempotent no-op", () => {
    const { store } = fixture();
    const image = file("image.png");
    store.selectFiles([image]);
    store.selectFiles([image]);
    store.selectFiles([file("image.png")]);
    expect(store.getSnapshot().entries).toHaveLength(1);
    const distinct = file("image.png");
    Object.defineProperty(distinct, "size", { value: image.size + 1 });
    store.selectFiles([distinct]);
    expect(store.getSnapshot().entries).toHaveLength(2);
  });
});
