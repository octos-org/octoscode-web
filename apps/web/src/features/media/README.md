# Message attachments

Keep one `AttachmentDraftStore` on each persistent Session record. Construct it
with the confirmed `sessionId`, `profileId`, opaque `authorityKey`, the
negotiated `uploadAvailable` gate, and callbacks resolving that record's typed
media commands and checking its authority. Never supply credentials, a
credential-bearing URL, or a callback bound to whichever Session is currently
selected. The upload gate defaults closed; capture the server's advertised
`turn/start` support.

`selectFiles` stages what can be attached and returns the rest with a reason, so
one bad file in a dropped batch does not cost the others. A draft holds at most
ten files, of which four images (PNG/JPEG/GIF/WebP, at most 20 MiB each). PDF,
CSV, Markdown and plain-text formats may be up to 50 MiB. The type comes from
the extension, because browsers report these formats inconsistently. Office
files are refused by product decision and get their own explanation.

Dropping, pasting or picking a file is the intent to attach it, so the host
calls `uploadSelected` straight after selection. `AttachmentTray` shows the
draft inside the composer: name, size, upload state, retry and remove. Removal
never deletes a server file. Invalidate the store when its authority is retired;
pending callbacks then cannot populate a replacement draft.

At the **accepted local queue-enqueue boundary**, after validating the prompt
and queue admission, synchronously call `takeForTurn(expectedScope)` or
`submitTurn` and attach the returned FileRefs to that immutable queued turn. It
rejects wrong ownership or any not-yet-uploaded selection and otherwise consumes
the draft once. Do not read the current draft later at dispatch.

Core copies an uploaded file into `<workspace>/uploads/` when the turn starts
and tells the model that path. The `user_message` echo and the hydrated user row
both carry it, so the transcript shows what was attached, then and after a
reload. Read those paths through the workspace file route; the blob route
refuses them.

There are no previews, object URLs, local/session storage writes or retained
server-error strings. Files are private to the in-memory store; React sees only
bounded draft metadata and status.
