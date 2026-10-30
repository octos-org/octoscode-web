import { isRecord } from "./rpc.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import {
  APPUI_MEMORY_PROMOTE_METHOD,
  APPUI_MEMORY_SESSION_SCOPE_FEATURE,
  APPUI_MEMORY_REQUEST_METHOD,
} from "./memory-methods.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export interface MemoryEntitySummary {
  name: string;
  summary: string;
}
export interface MemoryDailyNote {
  date: string;
  content: string;
  contentTruncated: boolean;
  contentTotalBytes: number;
}
export interface MemoryOverview {
  longTerm: string;
  longTermUpdatedAt?: string | undefined;
  longTermTruncated: boolean;
  longTermTotalBytes: number;
  today: string;
  todayTruncated: boolean;
  todayTotalBytes: number;
  recent: MemoryDailyNote[];
  entities: MemoryEntitySummary[];
  entitiesTruncated: boolean;
  stagingNotes: number;
  stagingTruncated: boolean;
  refreshEnabled: boolean;
}
export interface MemoryEntityDetail {
  name: string;
  content: string;
  contentTruncated: boolean;
  contentTotalBytes: number;
}
export interface MemoryRecord {
  id: string;
  kind: string;
  source: string;
  title: string;
  abstract: string;
  body?: string | undefined;
  timestamp?: string | undefined;
  trust?: string | undefined;
  score?: number | undefined;
  visits?: number | undefined;
}
export interface MemoryLoadResult {
  record: MemoryRecord;
  page?: string | undefined;
  pageTruncated: boolean;
}
export interface MemoryIngestResult {
  inserted: number;
  updated: number;
  unchanged: number;
  vectorsStored: number;
  embedded: number;
}
export interface MemoryRequestResult {
  status: string;
  refreshEnabled: boolean;
}
export interface MemoryPromoteResult {
  recordIds: string[];
  count: number;
  refreshEnabled: boolean;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 1_048_576;
const nonEmpty = (value: unknown): value is string =>
  text(value) && value.trim().length > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optionalText = (value: unknown) =>
  value === undefined || value === null || text(value);
const optionalCount = (value: unknown) =>
  value === undefined || value === null || count(value);

export function parseMemoryOverview(value: unknown): MemoryOverview | null {
  if (!isRecord(value) || !isRecord(value.overview)) return null;
  const overview = value.overview;
  if (
    !text(overview.long_term) ||
    !optionalText(overview.long_term_updated_at) ||
    typeof overview.long_term_truncated !== "boolean" ||
    !count(overview.long_term_total_bytes) ||
    !text(overview.today) ||
    typeof overview.today_truncated !== "boolean" ||
    !count(overview.today_total_bytes) ||
    !Array.isArray(overview.recent) ||
    !Array.isArray(overview.entities) ||
    typeof overview.entities_truncated !== "boolean" ||
    !count(overview.staging_notes) ||
    typeof overview.staging_truncated !== "boolean" ||
    typeof overview.refresh_enabled !== "boolean"
  ) {
    return null;
  }
  const recent: MemoryDailyNote[] = [];
  for (const row of overview.recent) {
    if (
      !isRecord(row) ||
      !text(row.date) ||
      !text(row.content) ||
      typeof row.content_truncated !== "boolean" ||
      !count(row.content_total_bytes)
    ) {
      return null;
    }
    recent.push({
      date: row.date,
      content: row.content,
      contentTruncated: row.content_truncated,
      contentTotalBytes: row.content_total_bytes,
    });
  }
  const entities: MemoryEntitySummary[] = [];
  const names = new Set<string>();
  for (const row of overview.entities) {
    if (
      !isRecord(row) ||
      !nonEmpty(row.name) ||
      names.has(row.name) ||
      !text(row.summary)
    ) {
      return null;
    }
    names.add(row.name);
    entities.push({ name: row.name, summary: row.summary });
  }
  return {
    longTerm: overview.long_term,
    longTermUpdatedAt: overview.long_term_updated_at as string | undefined,
    longTermTruncated: overview.long_term_truncated,
    longTermTotalBytes: overview.long_term_total_bytes,
    today: overview.today,
    todayTruncated: overview.today_truncated,
    todayTotalBytes: overview.today_total_bytes,
    recent,
    entities,
    entitiesTruncated: overview.entities_truncated,
    stagingNotes: overview.staging_notes,
    stagingTruncated: overview.staging_truncated,
    refreshEnabled: overview.refresh_enabled,
  };
}

export function parseMemoryEntity(
  value: unknown,
  expectedName: string,
): MemoryEntityDetail | null {
  if (
    !isRecord(value) ||
    value.name !== expectedName ||
    !text(value.content) ||
    typeof value.content_truncated !== "boolean" ||
    !count(value.content_total_bytes)
  ) {
    return null;
  }
  return {
    name: value.name,
    content: value.content,
    contentTruncated: value.content_truncated,
    contentTotalBytes: value.content_total_bytes,
  };
}

function parseMemoryRecord(value: unknown): MemoryRecord | null {
  if (
    !isRecord(value) ||
    !nonEmpty(value.id) ||
    !nonEmpty(value.kind) ||
    !nonEmpty(value.source) ||
    !text(value.title) ||
    !text(value.abstract) ||
    !optionalText(value.body) ||
    !optionalText(value.timestamp) ||
    !optionalText(value.trust) ||
    !optionalCount(value.visits) ||
    (value.score !== undefined &&
      (typeof value.score !== "number" || !Number.isFinite(value.score)))
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    source: value.source,
    title: value.title,
    abstract: value.abstract,
    body: value.body as string | undefined,
    timestamp: value.timestamp as string | undefined,
    trust: value.trust as string | undefined,
    score: value.score as number | undefined,
    visits: value.visits as number | undefined,
  };
}

export function parseMemorySearch(value: unknown): MemoryRecord[] | null {
  if (!isRecord(value) || !Array.isArray(value.hits)) return null;
  const records = value.hits.map(parseMemoryRecord);
  return records.some((record) => record === null)
    ? null
    : (records as MemoryRecord[]);
}

export function parseMemoryLoad(
  value: unknown,
  expectedId: string,
): MemoryLoadResult | null {
  if (
    !isRecord(value) ||
    (value.page !== undefined && value.page !== null && !text(value.page)) ||
    typeof value.page_truncated !== "boolean"
  ) {
    return null;
  }
  const record = parseMemoryRecord(value.record);
  if (!record || record.id !== expectedId) return null;
  return {
    record,
    page: value.page as string | undefined,
    pageTruncated: value.page_truncated,
  };
}

export function parseMemoryIngest(value: unknown): MemoryIngestResult | null {
  if (
    !isRecord(value) ||
    !count(value.inserted) ||
    !count(value.updated) ||
    !count(value.unchanged) ||
    !count(value.vectors_stored) ||
    !count(value.embedded)
  ) {
    return null;
  }
  return {
    inserted: value.inserted,
    updated: value.updated,
    unchanged: value.unchanged,
    vectorsStored: value.vectors_stored,
    embedded: value.embedded,
  };
}

export function parseMemoryRequest(value: unknown): MemoryRequestResult | null {
  return isRecord(value) &&
    text(value.status) &&
    typeof value.refresh_enabled === "boolean"
    ? { status: value.status, refreshEnabled: value.refresh_enabled }
    : null;
}

export function parseMemoryPromote(value: unknown): MemoryPromoteResult | null {
  return isRecord(value) &&
    Array.isArray(value.record_ids) &&
    value.record_ids.every(nonEmpty) &&
    count(value.count) &&
    value.count === value.record_ids.length &&
    typeof value.refresh_enabled === "boolean"
    ? {
        recordIds: value.record_ids,
        count: value.count,
        refreshEnabled: value.refresh_enabled,
      }
    : null;
}

export function createMemoryCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  capabilities: UiProtocolCapabilities,
  sessionId?: string,
) {
  if (
    sessionId !== undefined &&
    (!nonEmpty(sessionId) ||
      !supportsFeature(capabilities, APPUI_MEMORY_SESSION_SCOPE_FEATURE))
  ) {
    throw new Error("Session memory requires memory.session_scope.v1");
  }
  const scope = sessionId === undefined ? {} : { session_id: sessionId };
  function available(method: string) {
    if (
      !supportsFeature(
        capabilities,
        CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1,
      ) ||
      !supportsMethod(capabilities, method)
    ) {
      throw new Error(`${method} is not advertised by this server`);
    }
  }
  return {
    async overview(): Promise<MemoryOverview> {
      available(CORE_UI_METHODS.MEMORY_OVERVIEW);
      const value = await client.request(
        CORE_UI_METHODS.MEMORY_OVERVIEW,
        scope,
      );
      const parsed = parseMemoryOverview(value);
      if (!parsed) throw new Error("Invalid memory overview");
      return parsed;
    },
    async entity(name: string): Promise<MemoryEntityDetail> {
      available(CORE_UI_METHODS.MEMORY_ENTITY);
      if (!nonEmpty(name)) throw new Error("An entity name is required");
      const value = await client.request(CORE_UI_METHODS.MEMORY_ENTITY, {
        ...scope,
        name,
      });
      const parsed = parseMemoryEntity(value, name);
      if (!parsed) throw new Error("Invalid or mismatched memory entity");
      return parsed;
    },
    async search(query: string, limit = 10): Promise<MemoryRecord[]> {
      available(CORE_UI_METHODS.MEMORY_SEARCH);
      if (
        !text(query) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50
      ) {
        throw new Error("Invalid memory search");
      }
      const value = await client.request(CORE_UI_METHODS.MEMORY_SEARCH, {
        ...scope,
        query,
        limit,
      });
      const parsed = parseMemorySearch(value);
      if (!parsed) throw new Error("Invalid memory search results");
      return parsed;
    },
    async load(id: string): Promise<MemoryLoadResult> {
      available(CORE_UI_METHODS.MEMORY_LOAD);
      if (!nonEmpty(id)) throw new Error("A memory record id is required");
      const value = await client.request(CORE_UI_METHODS.MEMORY_LOAD, {
        ...scope,
        id,
      });
      const parsed = parseMemoryLoad(value, id);
      if (!parsed) throw new Error("Invalid or mismatched memory record");
      return parsed;
    },
    async ingest(
      records: Record<string, unknown>[],
    ): Promise<MemoryIngestResult> {
      available(CORE_UI_METHODS.MEMORY_INGEST);
      if (!records.length || records.length > 500 || !records.every(isRecord)) {
        throw new Error("Invalid memory records");
      }
      const value = await client.request(CORE_UI_METHODS.MEMORY_INGEST, {
        ...scope,
        records,
        embed: false,
      });
      const parsed = parseMemoryIngest(value);
      if (!parsed) throw new Error("Invalid memory ingest result");
      return parsed;
    },
    async request(
      requestId: string,
      content: string,
    ): Promise<MemoryRequestResult> {
      available(APPUI_MEMORY_REQUEST_METHOD);
      if (!nonEmpty(requestId) || !text(content)) {
        throw new Error("Invalid memory request");
      }
      const value = await client.request(APPUI_MEMORY_REQUEST_METHOD, {
        ...scope,
        request_id: requestId,
        operation: "remember",
        content,
      });
      const parsed = parseMemoryRequest(value);
      if (!parsed) throw new Error("Invalid memory request result");
      return parsed;
    },
    async promote(source: string): Promise<MemoryPromoteResult> {
      available(APPUI_MEMORY_PROMOTE_METHOD);
      if (!nonEmpty(source)) throw new Error("A memory source is required");
      const value = await client.request(APPUI_MEMORY_PROMOTE_METHOD, {
        ...scope,
        sources: [source],
        min_visits: 0,
        limit: 1,
      });
      const parsed = parseMemoryPromote(value);
      if (!parsed) throw new Error("Invalid memory promotion result");
      return parsed;
    },
  };
}
