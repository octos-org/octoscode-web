# ADR 0006: Parse Markdown only after persistence

- Status: Accepted
- Date: 2026-08-26

## Context

Coding replies require lists, tables, links, inline code, and highlighted
fences. Assistant output is untrusted, and repeatedly parsing an ever-growing
Markdown string on every streamed delta creates quadratic work for long turns.

DeepSeek Harness solves this with a product-owned incremental mdast parser and
direct React renderer. That is a strong mature design, but copying its complete
grammar, math, footnote, image, and incremental-cache surface now would add a
large security-sensitive subsystem before octoscode-web needs all of it.

## Decision

Growing `assistant_delta` text stays escaped plain text. The canonical
`assistant_persisted` row swaps once to a settled GFM render powered by
`react-markdown` and `remark-gfm`.

The settled renderer:

- never enables raw HTML parsing;
- accepts only absolute HTTP, HTTPS, and mailto links;
- accepts only absolute HTTP/HTTPS images;
- opens external links with `noopener noreferrer`;
- wraps wide tables in a keyboard-focusable scroll region;
- renders fenced code with a DSH-adapted Shiki JavaScript-regex highlighter;
- loads Markdown, highlighting, and non-boot grammars lazily so the initial app
  remains about 75 kB gzip;
- falls back to plain code for unknown or still-loading grammars.

The code-block chrome, theme-variable highlighter, and Markdown styling are
adapted from DeepSeek Harness revision
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` under MIT.

## Consequences

Streaming remains stable and cheap, but Markdown punctuation is visible until
the persisted row arrives. That is preferable to UI jank or partially trusted
HTML. If richer live Markdown becomes important, adopt DSH's incremental AST
approach as a separately reviewed subsystem with DOM-parity fixtures.
