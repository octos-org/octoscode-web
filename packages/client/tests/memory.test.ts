import { describe, expect, it, vi } from "vitest";
import {
  createMemoryCommands,
  parseMemoryEntity,
  parseMemoryEntries,
} from "../src/memory.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "../src/generated/core-contract.ts";
import {
  APPUI_MEMORY_ENTRY_METHODS,
  APPUI_MEMORY_PROMOTE_METHOD,
  APPUI_MEMORY_REQUEST_METHOD,
} from "../src/memory-methods.ts";

import { makeCaps } from "./fixtures/caps.ts";

const capabilities = makeCaps({
  methods: [
    CORE_UI_METHODS.MEMORY_OVERVIEW,
    CORE_UI_METHODS.MEMORY_ENTITY,
    CORE_UI_METHODS.MEMORY_SEARCH,
    CORE_UI_METHODS.MEMORY_LOAD,
    CORE_UI_METHODS.MEMORY_INGEST,
    APPUI_MEMORY_REQUEST_METHOD,
    APPUI_MEMORY_PROMOTE_METHOD,
    ...Object.values(APPUI_MEMORY_ENTRY_METHODS),
  ],
  features: [CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1],
});
const record = {
  id: "doc:t0008:1",
  kind: "document",
  source: "t0008",
  timestamp: "2026-10-28T00:00:00Z",
  title: "T0008 protocol probe",
  abstract: "protocol inventory fixture",
  body: "probe body",
  visits: 1,
};
const entry = { id: "^maaaaaa", text: "- tea ^maaaaaa", version: "v1" };

describe("memory protocol", () => {
  it("decodes overview, entity, search, and load projections", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        overview: {
          long_term: "# Long term",
          long_term_updated_at: "2026-10-28T00:00:00Z",
          long_term_truncated: false,
          long_term_total_bytes: 11,
          today: "today",
          today_truncated: false,
          today_total_bytes: 5,
          recent: [
            {
              date: "2026-10-28",
              content: "recent",
              content_truncated: false,
              content_total_bytes: 6,
            },
          ],
          entities: [{ name: "t0008", summary: "Protocol entity fixture." }],
          entities_truncated: false,
          staging_notes: 1,
          staging_truncated: false,
          refresh_enabled: true,
        },
      })
      .mockResolvedValueOnce({
        name: "t0008",
        content: "# T0008",
        content_truncated: false,
        content_total_bytes: 7,
      })
      .mockResolvedValueOnce({ hits: [record] })
      .mockResolvedValueOnce({ record, page_truncated: false });
    const commands = createMemoryCommands({ request }, capabilities);
    expect((await commands.overview()).entities[0]?.name).toBe("t0008");
    expect((await commands.entity("t0008")).content).toBe("# T0008");
    expect((await commands.search("protocol"))[0]?.id).toBe(record.id);
    expect((await commands.load(record.id)).record.body).toBe("probe body");
  });

  it("rejects wrong entity ids and missing AUX before calling the server", async () => {
    expect(
      parseMemoryEntity(
        {
          name: "other",
          content: "x",
          content_truncated: false,
          content_total_bytes: 1,
        },
        "t0008",
      ),
    ).toBeNull();
    const request = vi.fn();
    const commands = createMemoryCommands(
      { request },
      { ...capabilities, supported_features: [] },
    );
    await expect(commands.overview()).rejects.toThrow(/not advertised/);
    expect(request).not.toHaveBeenCalled();
    // An entry list that could send an edit to the wrong entry is refused.
    const list = (entries: unknown[], total = entries.length) =>
      parseMemoryEntries({ entries, total, truncated: false });
    expect(list([entry])?.entries[0]?.body).toBe("- tea");
    expect(list([entry, entry])).toBeNull();
    expect(list([entry], 2)).toBeNull();
    expect(list([{ ...entry, text: "- tea ^mbbbbbb" }])).toBeNull();
    // A receipt must name the entry, and a delete the version it was sent.
    const receipts = createMemoryCommands(
      {
        request: vi
          .fn()
          .mockResolvedValue({ entry_id: entry.id, version: "v2" }),
      },
      capabilities,
    );
    const shown = { ...entry, body: "- tea" };
    await expect(receipts.delete(shown)).rejects.toThrow(/mismatched/);
    await expect(
      receipts.edit({ ...shown, id: "^mbbbbbb" }, "x"),
    ).rejects.toThrow(/mismatched/);
  });
});

describe("session memory scope", () => {
  it("sends the selected session on every read and mutation", async () => {
    const request = vi.fn().mockRejectedValue(new Error("server refusal"));
    const commands = createMemoryCommands(
      { request },
      {
        ...capabilities,
        supported_features: [
          ...capabilities.supported_features!,
          "memory.session_scope.v1",
        ],
      },
      "web-coding",
    );
    for (const call of [
      () => commands.overview(),
      () => commands.entity("topic"),
      () => commands.search("topic"),
      () => commands.load(record.id),
      () => commands.ingest([record]),
      () => commands.request("remember", "text"),
      () => commands.promote("t0008"),
      () => commands.entries(),
      () => commands.edit({ ...entry, body: "- tea" }, "- coffee"),
      () => commands.delete({ ...entry, body: "- tea" }),
    ]) {
      await expect(call()).rejects.toThrow("server refusal");
    }
    expect(request).toHaveBeenCalledTimes(10);
    for (const [, params] of request.mock.calls)
      expect(params.session_id).toBe("web-coding");
  });
});
