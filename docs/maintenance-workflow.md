# Maintenance workflow

This is the repository's execution workflow for the 0.20 readiness program. The
maintainer owns implementation, contributor review, issue triage, verification,
merge and deployment follow-through. The product serves individuals and trusted
teams using their own Octos Core. The
[readiness ledger](release-readiness-020.md) records the current evidence and
outstanding release work.

## Choose work from product evidence

At the start of a work cycle, compare local main, remote main, the deployed
artifact, open contributor PRs, and changes to supported Core contracts. Record
commit identities; an old handoff or issue title is a lead to verify, not
current runtime truth. Preserve unrelated local changes and use isolated
worktrees.

Follow a complete user journey on the deployed application before prioritizing
an implementation detail. Separate reproducible bugs from experience problems
and optional feature proposals. Prioritize lost work, wrong identity, credential
exposure, inaccessible primary controls and blocked workflows ahead of cosmetic
work. Unsupported upstream behavior belongs in a capability gate and an explicit
limitation, not an invented browser runtime.

Create an issue for a confirmed defect with its affected revision, short
reproduction, expected/actual behavior and evidence. Link the fix PR. Reuse an
existing issue where it describes the same outcome. Close obsolete or completed
issues with current evidence; do not implement an old proposed technology simply
because the issue is still open. Keep sensitive credentials and exploit details
out of public reports.

## Review and implement

Read the current callers and protocol boundary before changing them. Prefer the
existing cancellation, identity and state-transition mechanisms. Apply
[deslop](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/deslop/SKILL.md)
and
[Karpathy guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md)
as checks against redundant guards, speculative abstractions and unnecessary
rewrites. The project owner's testing constraints take precedence over generic
examples that suggest a new test for every change.

Review contributor work against the exact current head, including dependency
order, preserved main-branch fixes, capabilities, migration and failure
behavior. A green CI result or approval on an earlier revision does not
establish that a new revision is ready. Respond with concrete findings and
ownership of the next step. For large contributions, divide review by behavior
and file ownership; keep one integration owner and one verified merge result.

Independent agents may investigate bounded questions or edit explicitly assigned
files while useful work proceeds in parallel. Give them the same scope and
simplicity rules. Collect their evidence, inspect the resulting diff and verify
integration; delegation does not transfer release accountability.

## Browser and visual acceptance

Use Playwright and CDP with a production build. Compare the deployed service and
an isolated candidate preview; never change shared Core configuration merely to
make a test pass. Real-model checks use clearly identified audit sessions and
bounded prompts. Fixture delays and failures are useful for races, but label
that evidence separately from actual Core behavior.

Capture and inspect screenshots of connection, workspace selection, transcript,
settings, approvals, empty/loading/error states and recovery. Include a narrow
phone viewport, keyboard-only interaction, light/dark themes and reduced motion.
Check actual control visibility, focus return, readable content and reachable
primary actions. An axe result supplements these checks; it is not a claim of
complete screen-reader testing.

Follow the [frontend baseline](frontend-baseline.md): preserve DSH tokens and
component conventions, clear hierarchy and restrained feedback. Use the
contextual audit/preservation guidance from
[Taste Skill](https://www.tasteskill.dev/), not marketing presets for a coding
workspace. Every motion must explain interaction or state, respect reduced
motion and avoid delaying navigation. Inspect changed visual baselines before
accepting them.

For performance, measure an actual user action and identify the blocking work.
Record build, history size, viewport, device throttling, network assumptions and
measurement definition. Separate input feedback from history readiness; a
Playwright click duration is not INP. Cover repeated completed-session
switching, background work and representative long code histories rather than
only an empty conversation. Keep deployment budgets unless a separately
justified decision changes the product constraint.

## Proportionate verification

Protocol inputs, ownership, algorithms and event-order races belong in focused
unit tests. User flows, focus, layout and rendering belong in browser tests.
Prefer existing cases and temporary audit probes when they establish the fix. Do
not add tests that read source strings, assert trivial static wording/styles, or
retest React itself. Remove obsolete behavior and its tests together.

A skipped critical shipping journey is an open release gap. Fix the behavior and
make its existing test assert observable results; replacing a failure with a
`fixme`, tautology or new screenshot baseline is not verification. Check fixture
responses against the supported Core contract before trusting a passing flow.

Run `pnpm check` before committing, plus the browser/Core checks relevant to the
change. After those pass, repeat or broaden testing only for a new change,
failure, unresolved concern or required release gate. Report meaningful coverage
and limits, not a rising test count as a quality metric.

## Finish the delivery

Use focused PRs with the problem, resulting behavior and relevant validation.
Wait for required CI on the exact head, resolve conflicts and review feedback,
then merge. Confirm the automatic deployment's revision and served artifact, and
exercise the changed behavior at the actual service address. A local build or
merged PR alone is not a verified deployment.

Update the readiness ledger with findings, issue/PR links, accepted evidence and
remaining work. Keep temporary traces, sanitized measurements and useful
screenshots in a documented audit location; publish concise durable findings in
`docs/reviews/`. Never retain tokens, credential-bearing WebSocket URLs or raw
authentication traces in artifacts.

Improve this workflow when a real failure exposes a missing step or a repeated
step wastes time. Keep the improvement small and evidence-based. Do not impose a
new mandatory framework, scout, benchmark or unit test on every future change.
The program finishes when its acceptance ledger is satisfied and no known
release blocker remains; optional future enhancements may remain open.
