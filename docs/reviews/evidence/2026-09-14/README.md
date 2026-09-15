# Browser evidence, 2026-09-14

- [Mobile, light](mobile-light.png) and [mobile, dark](mobile-dark.png):
  Chromium at 390 × 844 against the deterministic AppUI fixture. They document
  the bounded conversation area, visible composer, and compact navigation.
  Automated checks also cover 320 × 480, drawer focus, and axe in both themes.
- [Real Core, completed README turn](live-readme.png): Chromium connected to the
  pinned rc.9 Core through a temporary local proxy, using `glm-5.3-flash`. The
  model read the first 12 README lines and completed successfully. The
  [timeline report](../../2026-09-14-timeline-audit.md) records all three real
  turns and their timing. No workspace files were changed by those turns.
- [Production smoke results](production-smoke.json): the final production
  build's connection, workspace, rendered code, permission changes, task output,
  and Models UI against the fixture. All 38 static resource requests succeeded;
  the captured report contains paths and status codes without credentials.

Second-pass evidence:

- [Mobile production-build result](mobile-production.png) and
  [recording metadata](mobile-demo.json): 390×844 Chromium against the local
  deterministic fixture. The video delivered with this audit walks through the
  drawer, Settings scrolling, composer, and one fixture reply; it records UI
  motion rather than a real provider request. No page or console error occurred.

- [Settings at 320px](settings-mobile-320.png): the bottom connection actions
  remain inside the scrolled Settings panel and the close control stays visible.
- [Long Chinese queue at 320px](queue-mobile-320.png) and
  [after removing the eighth prompt](queue-mobile-after-remove-320.png): the
  input and removal controls fit the viewport without sideways displacement.
- [Nested diff review](approval-review-mobile-320.png): review above a pending
  approval. The browser regression checks focus traversal and counts the actual
  interrupt requests when each layer receives Escape.
- [Saved conversation preview](saved-conversation-preview.png): an exact link
  opened in an authenticated browser with an empty navigation registry.
- [Real Core reconnect](session-discovery.json) and
  [Core restart](session-discovery-cold.json): temporary isolated sessions,
  exact-reference reopen, persisted message identity, and catalog limitations.
- [Second-pass production smoke](followup-production-smoke.json): 101 document
  and asset responses across the first visit and saved-link revisit: 60 HTTP 200
  and 41 HTTP 304 cache revalidations, with no page errors or failed requests.
  Eleven named lazy chunks were verified, including workspace/session/hydrate
  decoders, the sidebar, modal surface, and saved conversation panel.

Fixture screenshots illustrate presentation; the real Core screenshot records
one successful runtime path. Neither establishes coverage of every server,
provider, network failure, or device. Credentials and WebSocket URLs are
omitted.
