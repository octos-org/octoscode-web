# Coding Web MVP

## Milestone 0 — transport proof

- [x] Public repository and CI
- [x] React-free UI Protocol WebSocket client
- [x] Browser query-token and feature negotiation
- [x] `session/open`, capability inspection, and `turn/start`
- [x] Raw fail-closed event inspector
- [x] Octoscode-compatible FIFO prompt queue and interrupt aliases
- [x] Fail-closed slash/bang command dispatch before prompts
- [x] Capability-aware slash palette for the implemented command slice

## Milestone 1 — durable chat

- [x] Generated TypeScript contract or checked golden protocol fixtures
- [x] `projection.envelope.v2` reducer with cursor, dedupe, and session scope
- [x] `session/hydrate` plus reconnect replay and gap repair
- [x] User, assistant, reasoning, tool, warning, and terminal rows
- [x] Safe GFM Markdown, tables, task lists, and lazy Shiki code rendering

## Milestone 2 — safe coding loop

- [x] Typed approvals with Octoscode request/session/deny decisions
- [x] Structured single-select, multi-select, and free-text user questions
- [x] Per-session permission profile
- [x] Diff preview and review surface
- [x] Task list, output, cancel, and paged artifacts
- [x] Plan/progress and runtime policy visibility

## Milestone 3 — workspace product

- [x] Session list/create/switch/delete (Core has no archive RPC)
- [x] Workspace/repository launcher using server-owned `launch/resolve`
- [x] Server-owned session file metadata and paged task artifacts
- [x] Context/cost/model status
- [x] Responsive supervision drawer and keyboard dismissal

## Milestone 4 — product readiness

- [x] Chromium E2E for launch, session switching, live turn, and narrow layout
- [x] Automated WCAG 2/2.1 A/AA axe gate on a blocking launch surface
- [x] CI failure traces and screenshots
- [x] Application error boundary and recoverable, redacted crash screen
- [x] Versioned release artifact and deployment contract
- [x] Bounded background-session task status in the workspace navigator
- [x] Searchable, status-filtered `/activity` task navigator
- [x] Generated protocol vocabulary and exact Core blob drift gate
- [ ] Generated request/result/event payload types from Octos Core
- [ ] Background multi-session supervision parity with Octoscode

## Explicit non-goals for the MVP

- Running an agent or tool in the browser
- DSH/Cordis host runtime
- Voice, camera, smart home, Learn, Studio, slides, sites, or admin UI
- PTY terminal emulation and editor embedding
- Arbitrary third-party JavaScript plugins
