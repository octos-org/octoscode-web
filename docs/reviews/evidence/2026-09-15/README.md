# Final audit evidence

See the [final audit](../../2026-09-15-final-audit.md) and
[verification summary](verification.json) for scope and limitations.

- `pnpm-check.log`: full repository checks, 466 unit tests and build gates.
  After the pre-merge lifecycle fix, the full check was rerun; the final initial
  JS size is 360,311 B, as recorded in `verification.json`.
- `e2e-all.log`: 97/97 Chromium tests, including 4 unchanged visual comparisons
  and 121.7ms worst streaming LoAF. Resource-failure tests intentionally produce
  caught React import errors; those are expected injected failures.
- `production-recovery.log`: 5/5 recovery and command cases against production
  modules with the repository CSP applied.
- `contract.log` and `real-core.log`: fixed contract and isolated rc.9
  integration; the integration gate does not execute a model turn.
- `production-smoke.json`: ordinary production paths, response paths/statuses,
  CSP results, and a single CDP cold-gate sample. No credential-bearing
  WebSocket URLs are retained.
- `chunk-failure-before.*`: previous production snapshot, Settings JS 503
  unmounts the App and closes the owner connection.
- `chunk-failure-after.*` and `chunk-failure-restored.png`: same failure with
  local recovery, owner/draft/queue/Stop preserved.
- `connection-short-viewport.png`, `question-retry-short-viewport.png`:
  short-screen input and error recovery.
- `history-320-dark.png`, `history-640-light.png`: expanded received history
  with code/table constraints.
- `task-output-320.png`, `diff-review-320.png`: long titles and usable phone
  output/review controls.

All screenshots use controlled fixture content. Existing production services and
user sessions were not changed. Visual baselines were not updated in this final
pass.

`premerge-lifecycle-browser.log` records the three targeted regressions for the
last lifecycle correction. `premerge-live.json` and `premerge-live-readme.png`
record three successful real-model turns on the final production build with
explicit Read permission; no repository file was changed.
