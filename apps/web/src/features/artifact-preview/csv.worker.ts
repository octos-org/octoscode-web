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
  const rows: Cell[][] = [];
  let cells = 0;
  Papa.parse<unknown[]>(text, {
    skipEmptyLines: "greedy",
    worker: false,
    step(result, parser) {
      if (result.errors.some((error) => error.code === "TooManyFields")) {
        truncated = true;
      }
      const width = Math.min(MAX_COLUMNS, result.data.length);
      if (result.data.length > MAX_COLUMNS) truncated = true;
      if (rows.length >= MAX_ROWS || cells + width > MAX_CELLS) {
        truncated = true;
        parser.abort();
        return;
      }
      rows.push(result.data.slice(0, width).map(cell));
      cells += width;
    },
  });
  return [{ name: "CSV", rows, rowOffset: 0, columnOffset: 0 }];
}

function cell(value: unknown): Cell {
  if (typeof value === "number" || typeof value === "boolean") return value;
  return value == null ? "" : String(value);
}
