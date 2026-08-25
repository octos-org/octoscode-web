# ADR 0002: Do not fork DeepSeek Harness for the Web client

Status: accepted, 2026-08-26.

## Context

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is an MIT
licensed, developer-preview agent harness. Its Web app is impressively modular,
but the two-line Vite entry boots a dynamic Cordis plugin graph. Its client
runtime directly depends on DSH session, agent, tool, projection, API remote,
module-loader, and host contracts. The repository currently contains hundreds
of workspace packages, not a transport-neutral React starter.

## Decision

Do not fork DSH or adopt its complete plugin/service graph as the base of
octoscode-web. That would introduce a second harness, session model, plugin
loader, and host API that would then need to be adapted to Octos.

Use DSH as the product and visual reference without adopting its runtime graph;
ADR 0004 records the expanded decision. Architectural ideas include:

- reversible UI contributions with explicit disposal;
- declared dependencies between optional contributions;
- keyed renderers for tool and conversation node kinds;
- a small, inspectable client module catalog.

If source code is later copied or modified, preserve the DeepSeek MIT copyright
and permission notice for every substantial portion. No DSH source is included
in the initial repository.

## Rejected alternative

Forking the whole DSH monorepo and replacing its host transport. This maximizes
code reuse by line count but minimizes reuse of the correct domain model. The
result would make Octos integration an adapter around DSH rather than make the
Web app a native Octos client.
