import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  PreviewWorkerClient,
  type PreviewWorkerMessage,
} from "./worker-client.ts";
import styles from "./CsvPreview.module.css";

const SHEET_PAGE_ROWS = 100;

interface SheetInfo {
  name: string;
  rows: number;
  rowOffset?: number;
  columnOffset?: number;
}
interface SheetPageMessage extends PreviewWorkerMessage {
  rows: (string | number | boolean)[][];
  start: number;
  total: number;
  truncated: boolean;
  rowOffset?: number;
  columnOffset?: number;
}
interface WorkbookMessage extends PreviewWorkerMessage {
  sheets: SheetInfo[];
  truncated: boolean;
}

export function CsvPreview({ blob }: { blob: Blob }) {
  const t = useUiText();
  const clientRef = useRef<PreviewWorkerClient | undefined>(undefined);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheet, setSheet] = useState(0);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SheetPageMessage["rows"]>([]);
  const [start, setStart] = useState(0);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [rowOffset, setRowOffset] = useState(0);
  const [columnOffset, setColumnOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const receivePage = (message: SheetPageMessage) => {
    setRows(message.rows);
    setStart(message.start);
    setTotal(message.total);
    setTruncated(message.truncated);
    setRowOffset(message.rowOffset ?? 0);
    setColumnOffset(message.columnOffset ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    let current = true;
    const client = new PreviewWorkerClient(
      new Worker(new URL("./csv.worker.ts", import.meta.url), {
        type: "module",
      }),
    );
    clientRef.current = client;
    void blob
      .arrayBuffer()
      .then((buffer) =>
        client.request<WorkbookMessage>({ type: "open", buffer }, [buffer]),
      )
      .then(
        (message) => {
          if (!current) return;
          setSheets(message.sheets);
          setTruncated(message.truncated);
          return client.request<SheetPageMessage>({
            type: "page",
            sheet: 0,
            start: 0,
            limit: SHEET_PAGE_ROWS,
          });
        },
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
          }
        },
      )
      .then(
        (message) => {
          if (current && message) receivePage(message);
        },
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
          }
        },
      );
    return () => {
      current = false;
      client.destroy();
      clientRef.current = undefined;
    };
  }, [blob]);

  const loadPage = (nextSheet: number, nextPage: number) => {
    setLoading(true);
    setError(null);
    setSheet(nextSheet);
    setPage(nextPage);
    void clientRef.current
      ?.request<SheetPageMessage>({
        type: "page",
        sheet: nextSheet,
        start: nextPage * SHEET_PAGE_ROWS,
        limit: SHEET_PAGE_ROWS,
      })
      .then(receivePage, (reason: unknown) => {
        setError(errorMessage(reason));
        setLoading(false);
      });
  };

  if (error) return <PreviewError error={error} />;
  if (loading && !sheets.length) return <LoadingPreview />;
  const pageCount = Math.max(1, Math.ceil(total / SHEET_PAGE_ROWS));
  const columns = rows.reduce((width, row) => Math.max(width, row.length), 0);
  return (
    <div className={styles.workbook} aria-busy={loading}>
      <div className={styles.sheetToolbar}>
        {sheets.length > 1 ? (
          <label>
            {t("Worksheet")}
            <select
              value={sheet}
              disabled={loading}
              onChange={(event) => loadPage(Number(event.target.value), 0)}
            >
              {sheets.map((entry, index) => (
                <option key={`${index}:${entry.name}`} value={index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span aria-live="polite">
          {total
            ? t("Rows {first}–{last} of {total}", {
                first: start + 1,
                last: Math.min(total, start + rows.length),
                total,
              })
            : t("0 rows")}
        </span>
      </div>
      {truncated ? (
        <p className={styles.notice} role="status">
          {t(
            "This preview is limited to 1,000,000 cells and 200 columns. Download the file for the complete workbook.",
          )}
        </p>
      ) : null}
      {rows.length ? (
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label={t("Spreadsheet rows")}
        >
          <table>
            <thead>
              <tr>
                <th aria-label={t("Row number")} />
                {Array.from({ length: columns }, (_, index) => (
                  <th key={index} scope="col">
                    {columnName(index + columnOffset)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={start + rowIndex}>
                  <th scope="row">{start + rowIndex + 1 + rowOffset}</th>
                  {Array.from({ length: columns }, (_, column) => (
                    <td key={column} title={String(row[column] ?? "")}>
                      {row[column] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPreview />
      )}
      {total > SHEET_PAGE_ROWS ? (
        <div className={styles.rowPages}>
          <button
            type="button"
            disabled={loading || page === 0}
            onClick={() => loadPage(sheet, page - 1)}
          >
            {t("Previous rows")}
          </button>
          <span>
            {t("Page {page} of {count}", { page: page + 1, count: pageCount })}
          </span>
          <button
            type="button"
            disabled={loading || page >= pageCount - 1}
            onClick={() => loadPage(sheet, page + 1)}
          >
            {t("Next rows")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function LoadingPreview() {
  const t = useUiText();
  return (
    <div className={styles.message} role="status">
      {t("Loading preview…")}
    </div>
  );
}

function EmptyPreview() {
  const t = useUiText();
  return <div className={styles.message}>{t("No previewable content.")}</div>;
}

function PreviewError({ error }: { error: string }) {
  const t = useUiText();
  return (
    <div className={styles.message} role="alert" title={error}>
      {t(
        "This document couldn't be previewed. Download it to open it in another app.",
      )}
    </div>
  );
}
