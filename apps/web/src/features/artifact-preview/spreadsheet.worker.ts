/// <reference lib="webworker" />
import * as XLSX from "xlsx";
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
    csv?: boolean;
    sheet?: number;
    start?: number;
    limit?: number;
  }>,
) => {
  const message = event.data;
  try {
    if (message.type === "open") {
      if (!message.buffer) throw new Error("Missing workbook data");
      sheets = message.csv
        ? await readCsv(message.buffer)
        : readWorkbook(message.buffer);
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
      error:
        reason instanceof Error
          ? reason.message
          : "Spreadsheet conversion failed",
    });
  }
};

function readWorkbook(buffer: ArrayBuffer): Sheet[] {
  truncated = false;
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    dense: true,
    sheetRows: MAX_ROWS + 1,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
  });
  let remainingCells = MAX_CELLS;
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]!;
    const actualRange = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
    const width = Math.max(1, actualRange.e.c - actualRange.s.c + 1);
    const rowBudget = Math.min(
      MAX_ROWS,
      Math.max(1, Math.floor(MAX_CELLS / width)),
    );
    const cappedRange = {
      s: actualRange.s,
      e: {
        r: Math.min(actualRange.e.r, actualRange.s.r + rowBudget - 1),
        c: Math.min(actualRange.e.c, actualRange.s.c + MAX_COLUMNS - 1),
      },
    };
    const clipped =
      actualRange.e.r > cappedRange.e.r || actualRange.e.c > cappedRange.e.c;
    const source = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
      range: cappedRange,
    });
    const columns = Math.min(
      MAX_COLUMNS,
      source.reduce((width, row) => Math.max(width, row.length), 0),
    );
    const rowLimit = Math.min(
      MAX_ROWS,
      columns > 0 ? Math.floor(remainingCells / columns) : MAX_ROWS,
    );
    const rows = source.slice(0, Math.max(0, rowLimit)).map((row) => {
      const boundedRow = row.slice(0, MAX_COLUMNS);
      return Array.from({ length: columns }, (_, index) =>
        cell(boundedRow[index]),
      );
    });
    if (
      clipped ||
      source.length > rows.length ||
      source.some((row) => row.length > columns)
    ) {
      truncated = true;
    }
    remainingCells = Math.max(0, remainingCells - rows.length * columns);
    return {
      name,
      rows,
      rowOffset: cappedRange.s.r,
      columnOffset: cappedRange.s.c,
    };
  });
}

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
