import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectionContent } from "./InspectionDialog.tsx";

describe("native inspection content", () => {
  it("renders remembered decisions as inert rows, with no permission mutation or clearing control", () => {
    const html = renderToStaticMarkup(
      <InspectionContent
        result={{
          kind: "approval-scopes",
          value: {
            scopes: [
              {
                session_id: "coding:local:A",
                scope: "tool",
                scope_match: "<script>shell</script>",
                decision: "deny",
                turn_id: "00000000-0000-4000-8000-000000000011",
              },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("Decision: deny");
    expect(html).toContain("&lt;script&gt;shell&lt;/script&gt;");
    expect(html).toContain("does not clear or change permissions");
    expect(html).not.toContain("<button");
    expect(
      renderToStaticMarkup(
        <InspectionContent
          result={{ kind: "approval-scopes", value: { scopes: [] } }}
        />,
      ),
    ).toContain("No remembered approval scopes");
  });
  it("renders thread roots, status, membership and orphan sequences without inventing a turn", () => {
    const html = renderToStaticMarkup(
      <InspectionContent
        result={{
          kind: "threads",
          value: {
            session_id: "coding:local:A",
            cursor: { stream: "cursor-A", seq: 7 },
            threads: [
              {
                thread_id: "<script>thread</script>",
                root_seq: 0,
                root_client_message_id: "client-message",
                message_seqs: [0, 2],
                status: "unknown",
              },
            ],
            orphans: [1],
          },
        }}
      />,
    );
    for (const text of [
      "Root sequence:",
      "Message sequences:",
      "0, 2",
      "Orphan message sequences:",
      "client-message",
      "unknown",
    ])
      expect(html).toContain(text);
    expect(html).toContain("&lt;script&gt;thread&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Turn:");
  });
  it("shows an honest empty graph and unknown turn rather than fabricated completion", () => {
    expect(
      renderToStaticMarkup(
        <InspectionContent
          result={{
            kind: "threads",
            value: {
              session_id: "s1",
              cursor: { stream: "s1", seq: 0 },
              threads: [],
              orphans: [],
            },
          }}
        />,
      ),
    ).toContain("No threads returned");
    const html = renderToStaticMarkup(
      <InspectionContent
        result={{
          kind: "turn",
          value: {
            session_id: "s1",
            turn_id: "00000000-0000-4000-8000-000000000011",
            state: "unknown",
            committed_seqs: [],
          },
        }}
      />,
    );
    expect(html).toContain("no lifecycle record");
    expect(html).toContain("None");
    expect(html).not.toContain("Completed");
  });
  it("shows native turn metadata and zero-valued context diagnostics", () => {
    const html = renderToStaticMarkup(
      <InspectionContent
        result={{
          kind: "turn",
          value: {
            session_id: "s1",
            turn_id: "00000000-0000-4000-8000-000000000011",
            state: "completed",
            thread_id: "thread-A",
            started_at: "2026-09-06T00:00:00Z",
            completed_at: "2026-09-06T00:01:00Z",
            committed_seqs: [0, 1],
            context_state: {
              session_id: "s1",
              generation: 0,
              item_count: 0,
              token_estimate: 0,
              recovery_state: "ready",
            },
          },
        }}
      />,
    );
    for (const text of [
      "thread-A",
      "2026-09-06T00:01:00Z",
      "0, 1",
      "generation 0",
      "0 items",
      "0 estimated tokens",
    ])
      expect(html).toContain(text);
  });
});
