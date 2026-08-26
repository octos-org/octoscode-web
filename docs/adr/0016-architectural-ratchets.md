# ADR 0016: Replace recurring issue chains with architectural ratchets

- Status: Accepted
- Date: 2026-08-26

## Context

An audit can produce a long list of local defects: stale requests, timer leaks,
unbounded maps, modal focus bugs, literal colors, protocol strings, release
overwrites, and deployment checks that accept comments as configuration. Fixing
each occurrence independently leaves the same failure mode available at the next
call site.

## Decision

Recurring failure classes are removed or bounded at the narrowest shared
boundary:

- session connection/recovery and foreground turns use React-free lifecycle
  controllers with direct state-machine tests;
- every structured RPC result crosses a fail-closed decoder, generated Core
  vocabulary is the only source for exported Core method names, and shared wire
  primitives cannot diverge between feature parsers;
- blocking surfaces use one modal focus/keyboard primitive;
- ephemeral caches and rendered histories have explicit bounds, eviction
  semantics, and visible truncation rather than silent loss;
- color, typography, and motion values come from the theme; new feature styles
  use CSS Modules while a checked ratchet prevents growth of the legacy global
  sheet;
- repository policy is executable: inline styles, raw feature colors, tiny text,
  inconsistent ADR metadata, and global-CSS growth fail `pnpm check`;
- release verification runs without publish authority, publication is a separate
  provenance-attested job, and an existing release can never be clobbered.

The legacy global stylesheet is a bounded migration surface, not the extension
point. Its line budget may only decrease as feature styles move to modules.

## Consequences

Reviewers can ask whether a change satisfies a boundary rather than remembering
every historical bug. New variants fail at compile time, policy verification,
unit tests, browser tests, or the release gate. Some abstractions are stricter
than a one-off implementation, but they make the product's safety and recovery
claims mechanically repeatable.

## Rejected alternatives

- Add another conditional, ref, timeout cleanup, or CSS literal at each failing
  component. This fixes the observed path but preserves the defect class.
- Introduce a global store or event bridge to centralize everything. That
  replaces scattered bugs with shared mutable state and recreates the old
  `octos-web` architecture.
- Depend on review checklists alone. Checklists are useful context, but they are
  not enforcement.
