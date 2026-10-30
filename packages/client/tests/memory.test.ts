import { describe, expect, it, vi } from "vitest";
import { createMemoryCommands, parseMemoryEntity } from "../src/memory.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "../src/generated/core-contract.ts";
import {
  APPUI_MEMORY_PROMOTE_METHOD,
  APPUI_MEMORY_REQUEST_METHOD,
} from "../src/memory-methods.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.MEMORY_OVERVIEW,
    CORE_UI_METHODS.MEMORY_ENTITY,
    CORE_UI_METHODS.MEMORY_SEARCH,
    CORE_UI_METHODS.MEMORY_LOAD,
    CORE_UI_METHODS.MEMORY_INGEST,
    APPUI_MEMORY_REQUEST_METHOD,
    APPUI_MEMORY_PROMOTE_METHOD,
  ],
  supported_features: [CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1],
  supported_notifications: [],
};
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

  it("decodes ingest, request, and promote outcomes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        inserted: 1,
        updated: 0,
        unchanged: 0,
        vectors_stored: 0,
        embedded: 0,
      })
      .mockResolvedValueOnce({ status: "accepted", refresh_enabled: true })
      .mockResolvedValueOnce({
        record_ids: [record.id],
        count: 1,
        refresh_enabled: true,
      });
    const commands = createMemoryCommands({ request }, capabilities);
    expect((await commands.ingest([record])).inserted).toBe(1);
    expect((await commands.request("req-1", "remember this")).status).toBe(
      "accepted",
    );
    expect((await commands.promote("t0008")).recordIds).toEqual([record.id]);
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
  });
});

describe("session memory scope", () => {
  it("rejects unsupported scope before sending a request", () => {
    const request = vi.fn();
    expect(() =>
      createMemoryCommands({ request }, capabilities, "web-coding"),
    ).toThrow(/memory.session_scope/);
    expect(request).not.toHaveBeenCalled();
  });

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
    ]) {
      await expect(call()).rejects.toThrow("server refusal");
    }
    expect(request).toHaveBeenCalledTimes(7);
    for (const [, params] of request.mock.calls)
      expect(params.session_id).toBe("web-coding");
  });
});
