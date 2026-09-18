# Autonomy candidate integration

Root owns App/command mounting. The feature does not implement an agent loop,
persist a goal locally, or issue model turns while loading.

Lazy-load `AutonomyDialog.tsx` and pass:

```tsx
<AutonomyDialog
  client={protocol.client}
  sessionId={protocol.sessionId}
  capabilities={protocol.capabilities}
  authorityKey={protocol.authorityKey}
  isCurrent={protocol.isCurrent}
  onSpawnAgents={protocol.spawnAgents}
  spawnAvailable={spawnAvailable}
  onClose={closeDialog}
/>
```

The authority key must identify the confirmed endpoint/profile/authentication
and transport generation; it must change on reconnect, reauthentication, and
daemon restart, even for the same session ID. It must NOT contain a credential.
Keep the capability snapshot object stable until negotiation changes. Withdraw
the dialog when confirmed protocol authority is unavailable.

`isCurrent()` must synchronously validate the captured selected record, full
endpoint/profile/workspace scope, runtime generation, client/capabilities and
authentication epoch. It is rechecked before dispatch, between goal/get and
goal/set, and before results commit; its callback identity need not be stable.
Unmount retires the store's operation lease even under React StrictMode.

The dialog internally keys its scope by full authority plus session. It resolves
the typed async `client.autonomyCommands(sessionId, capabilities)` factory with
an effect-local cancellation fence, then supplies one immutable command object
to the controller. Notification subscriptions capture their source and store
epoch, subscribe before the initial refresh, and cannot reactivate after
cleanup. Refresh does not run again for ordinary store/UI updates.

Close and Escape remain available during reads/loading, but are locked while any
dispatched mutation remains pending, including superseded same-resource
requests. A forced authority change retires presentation; it does not cancel
already dispatched server work. Late results cannot repaint the new authority.

Controls require their negotiated method AND feature. A blank goal budget is
omitted, not defaulted. Monitor argv is an explicit JSON array, not a shell
string. Runtime execution and durable goal/loop/monitor state remain in Core.

Goal pause/resume/stop follow pinned TUI `start_goal_transition`: read the fresh
goal, then set its current objective to `paused`/`active`/`complete` with
`transition_actor: "user"`, omitting token budget. A newer goal generation or
authority cancels the unsent second step. Resume never increases a spent budget.

The agent panel uses native status/artifact-list/artifact-read/interrupt/close.
The exact Core terminal receipt carries status/ok/interrupted/closed/
already_terminal, not a fabricated nested agent. Artifact text comes only from
the separately redacted top-level read result. The single detail viewer rejects
superseded reads; reads do not hold the close guard, dispatched controls do.

`onSpawnAgents(text)` is optional. It receives the TUI-composed ordinary prompt,
not an `agent/spawn` call. Root must recheck captured authority, actual idle
controller state and ordinary queue admission synchronously, then enqueue once
with a UUID. Do not consume ambient composer media/drafts. Return true only on
local queue admission; false preserves the form. `spawnAvailable` is merely the
display hint. The native agent-list capability is still required.

`LoopCreationControls` is already mounted in `AutonomyPanel`, preserving the
existing loop roster/control buttons. `createLoop` accepts its exact typed
maintenance/self-paced/fixed input; an empty maintenance prompt remains empty
for Core's fallback. The pinned Core interval bounds are 60–86400 seconds and
the prompt bound is 8192 UTF-8 bytes. The legacy string overload remains.

Focused tests cover lazy factory retirement, notification cleanup, source epoch
ordering, same-tick GET/mutation races, nested envelope/resource agreement,
nullable rc11 records, independent busy ownership, and pending-write close
guards. The static dialog test checks loading accessibility only; actual mounted
browser interaction and live Core acceptance remain root-owned checks.
