# Unmounted attachment candidate

This directory is not connected to App, the composer, or turn dispatch.

Keep one `AttachmentDraftStore` on each persistent Session record. Construct it
with the confirmed `sessionId`, `profileId`, opaque `authorityKey`, the
negotiated `uploadAvailable` gate, and callbacks resolving that record's typed
media commands and checking its authority. Never supply credentials, a
credential-bearing URL, or a callback bound to whichever Session is currently
selected. The upload gate defaults closed; capture the server's advertised
`turn/start` support. Providers can still lack image understanding.

`selectFiles` validates and stages browser-selected Files without uploading.
`uploadSelected` is an explicit upload action. A draft has at most four nonempty
PNG/JPEG/GIF/WebP files, each at most 20 MiB, matching the TUI's attachment
limits. Other file types are excluded from this candidate; generic model
consumption is not promised. Bare paths in prompt text are never inspected.

Mount `AttachmentsDialog` keyed by the store's full authority. Ordinary Session
switches retain the owning record's draft. Closing/unmounting the dialog cancels
transfers but preserves its selections and confirmed uploads. Cancellation and
removal do not delete server files. Invalidate the store when its authority is
retired; pending callbacks then cannot populate a replacement draft.

At the **accepted local queue-enqueue boundary**, after validating the prompt
and queue admission, synchronously call `takeForTurn(expectedScope)` and attach
its returned FileRefs to that immutable queued turn. It rejects wrong ownership
or any not-yet-uploaded selection and otherwise consumes the draft once. Do not
call it speculatively before admission, or read the current draft later at
dispatch. Queue integration and authenticated downloads are deliberately left to
the host.

There are no previews, object URLs, local/session storage writes, downloaded
paths, or retained server-error strings. Files are private to the in-memory
store; React sees only bounded draft metadata and status. Tests cover
authority/cancel races, image limits, receipt ownership, queue handoff and
static accessible UI.
