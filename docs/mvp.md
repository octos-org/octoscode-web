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

- [ ] Generated TypeScript contract or checked golden protocol fixtures
- [x] `projection.envelope.v2` reducer with cursor, dedupe, and session scope
- [x] `session/hydrate` plus reconnect replay and gap repair
- [x] User, assistant, reasoning, tool, warning, and terminal rows
- [ ] Markdown and code rendering

## Milestone 2 — safe coding loop

- [x] Typed approvals with Octoscode request/session/deny decisions
- [x] Structured single-select, multi-select, and free-text user questions
- [ ] Per-session permission profile
- [ ] Diff preview and review surface
- [ ] Task list, output, cancel, and artifacts
- [ ] Plan/progress and runtime policy visibility

## Milestone 3 — workspace product

- [ ] Session list/create/switch/archive
- [ ] Workspace/repository launcher using server-owned paths
- [ ] File/artifact browser
- [ ] Context/cost/model status
- [ ] Responsive and accessible layouts

## Explicit non-goals for the MVP

- Running an agent or tool in the browser
- DSH/Cordis host runtime
- Voice, camera, smart home, Learn, Studio, slides, sites, or admin UI
- PTY terminal emulation and editor embedding
- Arbitrary third-party JavaScript plugins
