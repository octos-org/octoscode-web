# Targeted turn recovery audit

The earlier timeout recovery assumption was incorrect: a later `session/hydrate`
that omits a turn cannot prove that Core never accepted it. Registry or ledger
loss can produce the same observation. The browser now keeps the turn and its
pending FIFO until explicit lifecycle evidence is available.

## Verified Core contract

Source was read from the fixed rc.9 object
`5ea987813de4fd2afdd1d78f2106ad2868f0d923`, rather than a moving checkout:

- `crates/octos-core/src/ui_protocol.rs:3015`: lifecycle enum and request/result
  types. `turn/state/get` accepts `session_id` and `turn_id`.
- `crates/octos-cli/src/api/ui_protocol_transport.rs:22872`: the live registry
  takes precedence over ledger projection; a missing turn returns `unknown`. An
  unknown session produces an RPC error.
- `api/OCTOS_UI_PROTOCOL_V1_SPEC_2026-04-24.md:742`: negotiated feature is
  `state.turn_state_get.v1`.

The client negotiates that feature and checks both the feature and advertised
method before lookup. Its narrow decoder accepts exactly `active`,
`interrupting`, `completed`, `errored`, `interrupted`, and `unknown`. It
validates the result's exact session and turn against the request, as well as
consumed optional metadata. Unconsumed context extensions do not become client
state.

## Browser behavior

| Evidence                                                                              | Behavior                                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hydrate omits the current turn, reports unknown, or has a future state                | Query that exact turn once when capability is available                     |
| Lookup active or interrupting                                                         | Continue observing; keep interruption deduplicated                          |
| Lookup completed, errored, or interrupted                                             | Settle transcript stream tails and interactions, then advance existing FIFO |
| Lookup unknown                                                                        | Keep the unresolved turn and FIFO; allow a read-only status retry           |
| Missing capability                                                                    | Keep unresolved state and explain status cannot be checked                  |
| Lookup error or invalid response                                                      | Keep unresolved state, show the error, allow retry                          |
| Status reply from a replaced client/session/turn or after newer notification evidence | Ignore the obsolete result                                                  |

New prompt admission and interruption are paused while status is unresolved;
draft editing and pending-prompt removal remain available. A different
foreground turn reported by hydrate remains ahead of the local FIFO even if the
old turn is later confirmed terminal. An observed turn does not acquire socket
ownership; a same-transport local owner remains retained through terminal tails.

Missing start ACKs and transport failures likewise remain uncertain. Only an
explicit RPC rejection settles a start as rejected. Neither `unknown` nor a
missing hydrate entry causes resubmission or claims that the turn did not run.

## Validation

- 104 targeted tests pass across client RPCs, lifecycle decoding/capabilities,
  controller recovery, and transcript folding. The controller suite covers 41
  scenarios, including exact FIFO order, late replies, replacement transport,
  unsupported capability, unknown state, retries, and retained owner semantics.
- Client and Web TypeScript checks and targeted lint pass.
- A temporary extension of the existing isolated Core integration harness
  negotiated the feature against the pinned rc.9 binary, opened an exact
  temporary workspace/session, queried a random missing turn, and passed the
  real response through the new strict decoder. The result was explicitly
  `unknown`; the existing integration smoke also passed. This check did not
  start an agent turn or alter the deployed server.
- The targeted Chromium product regression passes (33.4 seconds for the
  scenario, including the real 30-second ACK timeout). It verifies an unknown
  lookup preserves the turn and draft, Enter does not resend, and an explicit
  interrupted result from the status retry permits exactly one pending prompt to
  start with a different turn ID. The interrupted lookup is controlled test
  evidence; the real isolated Core lookup above verifies the unknown branch.

This repair provides state introspection after reconnect. It does not detach a
turn from Core's owner socket or promise execution across a page refresh.
