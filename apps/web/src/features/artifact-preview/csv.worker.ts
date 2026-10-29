/// <reference lib="webworker" />
import Papa from "papaparse";

const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;
const MAX_CELLS = 1_000_000;

type Cell = string | number | boolean;
interface Sheet {
  name: string;
  rows: Cell[][];
  rowOffset: number;
  columnOffset: number;
}

let sheets: Sheet[] = [];
let truncated = false;

self.onmessage = async (
  event: MessageEvent<{
    requestId: number;
    type: "open" | "page";
    buffer?: ArrayBuffer;
    sheet?: number;
    start?: number;
    limit?: number;
  }>,
) => {
  const message = event.data;
  try {
    if (message.type === "open") {
      if (!message.buffer) throw new Error("Missing CSV data");
      sheets = await readCsv(message.buffer);
      self.postMessage({
        requestId: message.requestId,
        type: "open",
        sheets: sheets.map((sheet) => ({
          name: sheet.name,
          rows: sheet.rows.length,
          rowOffset: sheet.rowOffset,
          columnOffset: sheet.columnOffset,
        })),
        truncated,
      });
      return;
    }
    const sheet = sheets[message.sheet ?? 0];
    if (!sheet) throw new Error("Unknown worksheet");
    const start = Math.max(0, message.start ?? 0);
    const limit = Math.min(200, Math.max(1, message.limit ?? 100));
    self.postMessage({
      requestId: message.requestId,
      type: "page",
      rows: sheet.rows.slice(start, start + limit),
      start,
      total: sheet.rows.length,
      truncated,
      rowOffset: sheet.rowOffset,
      columnOffset: sheet.columnOffset,
    });
  } catch (reason) {
    self.postMessage({
      requestId: message.requestId,
      type: "error",
      error: reason instanceof Error ? reason.message : "CSV conversion failed",
    });
  }
};

async function readCsv(buffer: ArrayBuffer): Promise<Sheet[]> {
  truncated = false;
  const text = await new Blob([buffer]).text();
  const result = Papa.parse<unknown[]>(text, {
    preview: MAX_ROWS + 1,
    skipEmptyLines: "greedy",
    worker: false,
  });
  const columns = Math.min(
    MAX_COLUMNS,
    result.data.reduce((width, row) => Math.max(width, row.length), 0),
  );
  const rowLimit = Math.min(
    MAX_ROWS,
    columns > 0 ? Math.floor(MAX_CELLS / columns) : MAX_ROWS,
  );
  const rows = result.data
    .slice(0, Math.max(0, rowLimit))
    .map((row) =>
      Array.from({ length: columns }, (_, index) => cell(row[index])),
    );
  truncated =
    result.data.length > rows.length ||
    result.data.some((row) => row.length > columns) ||
    result.errors.some((error) => error.code === "TooManyFields");
  return [{ name: "CSV", rows, rowOffset: 0, columnOffset: 0 }];
}

function cell(value: unknown): Cell {
  if (typeof value === "number" || typeof value === "boolean") return value;
  return value == null ? "" : String(value);
}
