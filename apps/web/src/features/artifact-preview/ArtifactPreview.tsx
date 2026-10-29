import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  artifactExtension,
  artifactKind,
  type ArtifactKind,
} from "./artifact-kind.ts";
import styles from "./ArtifactPreview.module.css";

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody.tsx").then((module) => ({
    default: module.MarkdownBody,
  })),
);
const CodeBlock = lazy(() =>
  import("../markdown/CodeBlock.tsx").then((module) => ({
    default: module.CodeBlock,
  })),
);
const PdfPreview = lazy(() =>
  import("./PdfPreview.tsx").then((module) => ({
    default: module.PdfPreview,
  })),
);
const CsvPreview = lazy(() =>
  import("./CsvPreview.tsx").then((module) => ({
    default: module.CsvPreview,
  })),
);
const SandboxPreview = lazy(() =>
  import("./SandboxPreview.tsx").then((module) => ({
    default: module.SandboxPreview,
  })),
);

const TEXT_PAGE_CHARACTERS = 48_000;
const MAX_AUTOMATIC_PREVIEW_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 10 * 1024 * 1024;

export interface ArtifactPreviewProps {
  /** Display name and download filename. */
  name: string;
  kind?: ArtifactKind | undefined;
  /** Tool-written workspace files use the 32 MiB session reader limit. */
  workspaceFile?: boolean;
  /** Authenticated server path, when the artifact has one. */
  path?: string;
  /** Text supplied by task/artifact/read. Binary documents use loadBlob instead. */
  text?: string | undefined;
  /** Server-listed size, when known; avoids fetching oversized previews. */
  sizeBytes?: number | undefined;
  /** Size lookup is still in flight; defer the byte transfer. */
  sizePending?: boolean;
  /** Delivered REST blobs must have an authoritative size before preview. */
  sizeRequired?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadBlob?: (signal?: AbortSignal) => Promise<Blob>;
  /** Optional unbounded save route, separate from the bounded preview reader. */
  downloadBlob?: (signal?: AbortSignal) => Promise<Blob>;
  /** Optional host integration; hidden until the server offers a real reveal action. */
  onReveal?: (path: string) => void;
}

export function ArtifactPreview(props: ArtifactPreviewProps) {
  const t = useUiText();
  const reference = props.path ?? props.name;
  const kind =
    props.kind ??
    (artifactExtension(reference) === "" && props.text !== undefined
      ? "text"
      : artifactKind(reference));
  const textKind = ["markdown", "code", "text"].includes(kind);
  const previewSizeLimit = props.workspaceFile
    ? 32 * 1024 * 1024
    : ["markdown", "code", "text", "html", "svg"].includes(kind)
      ? MAX_TEXT_PREVIEW_BYTES
      : MAX_AUTOMATIC_PREVIEW_BYTES;
  const oversizedByMetadata =
    props.sizeBytes !== undefined && props.sizeBytes > previewSizeLimit;
  const needsBlob =
    kind !== "unsupported" && (!textKind || props.text === undefined);
  const waitingForSize = needsBlob && props.sizePending === true;
  const sizeUnknown =
    needsBlob &&
    props.sizeRequired === true &&
    props.sizeBytes === undefined &&
    !waitingForSize;
  const shouldFetch =
    needsBlob && !oversizedByMetadata && !waitingForSize && !sizeUnknown;
  const [blob, setBlob] = useState<Blob>();
  const [loadedText, setLoadedText] = useState<string>();
  const [loading, setLoading] = useState(shouldFetch || waitingForSize);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  const loadBlobRef = useRef(props.loadBlob);
  loadBlobRef.current = props.loadBlob;
  const hasLoader = Boolean(props.loadBlob);

  useEffect(() => {
    if (waitingForSize) {
      setLoading(true);
      return;
    }
    if (oversizedByMetadata || sizeUnknown || !shouldFetch || !hasLoader) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setBlob(undefined);
    setLoadedText(undefined);
    loadBlobRef.current!(abort.signal).then(
      async (value) => {
        const source =
          textKind && value.size <= MAX_TEXT_PREVIEW_BYTES
            ? await value.text()
            : undefined;
        if (abort.signal.aborted) return;
        setLoadedText(source);
        setBlob(value);
        setLoading(false);
      },
      (reason: unknown) => {
        if (abort.signal.aborted) return;
        setError(errorMessage(reason));
        setLoading(false);
      },
    );
    return () => abort.abort();
  }, [
    shouldFetch,
    hasLoader,
    retry,
    reference,
    textKind,
    oversizedByMetadata,
    waitingForSize,
    sizeUnknown,
  ]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const value = props.downloadBlob
        ? await props.downloadBlob()
        : (blob ??
          (props.text !== undefined && !props.hasMore
            ? new Blob([props.text], { type: "text/plain;charset=utf-8" })
            : await props.loadBlob?.()));
      if (!value) return;
      saveArtifact(value, props.name);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDownloading(false);
    }
  };

  const copyPath = async () => {
    if (!props.path) return;
    try {
      await navigator.clipboard.writeText(props.path);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const oversized = error?.includes("workspace_file_too_large") ?? false;
  const canDownload = props.downloadBlob
    ? true
    : oversized
      ? false
      : props.loadBlob
        ? true
        : textKind && props.text !== undefined && !props.hasMore;
  let content: ReactNode;
  if (loading) {
    content = (
      <div className={styles.message} role="status">
        {t("Loading preview…")}
      </div>
    );
  } else if (oversizedByMetadata || oversized) {
    content = (
      <div className={styles.message}>
        {t(
          "This file is too large for safe inline preview. Download it to open it in another app.",
        )}
      </div>
    );
  } else if (sizeUnknown) {
    content = (
      <div className={styles.message}>
        {t(
          "This file's size couldn't be verified. Download it to open it in another app.",
        )}
      </div>
    );
  } else if (shouldFetch && !props.loadBlob) {
    content = (
      <div className={styles.message} role="status">
        {t("This server can't read the file for preview.")}
      </div>
    );
  } else if (shouldFetch && !blob) {
    content = null;
  } else {
    content = (
      <Suspense
        fallback={
          <div className={styles.message} role="status">
            {t("Loading preview…")}
          </div>
        }
      >
        <ArtifactBody
          kind={kind}
          name={props.name}
          extension={artifactExtension(reference)}
          text={props.text ?? loadedText}
          blob={blob}
          hasMore={props.hasMore}
          onLoadMore={props.onLoadMore}
        />
      </Suspense>
    );
  }

  return (
    <section
      className={styles.preview}
      aria-label={t("Preview {name}", { name: props.name })}
      data-artifact-kind={kind}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <strong title={props.name} translate="no">
            {props.name}
          </strong>
          <span>{artifactExtension(reference).toUpperCase() || t("File")}</span>
        </div>
        <div className={styles.actions}>
          {props.path && props.onReveal ? (
            <button type="button" onClick={() => props.onReveal?.(props.path!)}>
              {t("Show in folder")}
            </button>
          ) : null}
          {props.path ? (
            <button type="button" onClick={() => void copyPath()}>
              {copyState === "copied" ? t("Path copied") : t("Copy path")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canDownload || downloading}
            onClick={() => void download()}
          >
            {downloading ? t("Downloading…") : t("Download")}
          </button>
        </div>
      </header>
      {copyState ? (
        <span className={styles.srOnly} role="status" aria-live="polite">
          {copyState === "copied"
            ? t("File path copied to clipboard.")
            : t("Could not copy the path. Select it and copy it manually.")}
        </span>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert" title={error}>
          <span>
            {t(
              "This preview could not be loaded. Try again or download the file.",
            )}
          </span>
          {props.loadBlob && shouldFetch ? (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.body}>{content}</div>
    </section>
  );
}

function ArtifactBody({
  kind,
  name,
  extension,
  text,
  blob,
  hasMore = false,
  onLoadMore,
}: {
  kind: ArtifactKind;
  name: string;
  extension: string;
  text?: string | undefined;
  blob?: Blob | undefined;
  hasMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
}) {
  const t = useUiText();
  const textDocument = ["markdown", "code", "text", "html", "svg"].includes(
    kind,
  );
  const sizeLimit = textDocument
    ? MAX_TEXT_PREVIEW_BYTES
    : MAX_AUTOMATIC_PREVIEW_BYTES;
  if (blob && blob.size > sizeLimit) {
    return (
      <div className={styles.message}>
        {t(
          "This file is too large for safe inline preview. Download it to open it in another app.",
        )}
      </div>
    );
  }
  if (kind === "unsupported") {
    return (
      <div className={styles.message}>
        <p>{t("This file type doesn't have an inline preview.")}</p>
        <p>{t("Download it to open it in another app.")}</p>
      </div>
    );
  }
  if (kind === "pdf" && blob) return <PdfPreview blob={blob} name={name} />;
  if (kind === "csv" && blob) return <CsvPreview blob={blob} />;
  if (kind === "image" && blob) return <ImagePreview blob={blob} name={name} />;
  if ((kind === "html" || kind === "svg") && blob) {
    return <SandboxPreview blob={blob} name={name} svg={kind === "svg"} />;
  }
  return (
    <PaginatedText
      kind={kind}
      extension={extension}
      text={text ?? ""}
      hasMore={hasMore}
      {...(onLoadMore ? { onLoadMore } : {})}
      emptyLabel={t("No text content.")}
    />
  );
}

function PaginatedText({
  kind,
  extension,
  text,
  hasMore,
  onLoadMore,
  emptyLabel,
}: {
  kind: ArtifactKind;
  extension: string;
  text: string;
  hasMore: boolean;
  onLoadMore?: () => void;
  emptyLabel: string;
}) {
  const t = useUiText();
  const [limit, setLimit] = useState(TEXT_PAGE_CHARACTERS);
  const visible = text.slice(0, limit);
  const localMore = text.length > visible.length;
  if (!text && !hasMore) {
    return <div className={styles.message}>{emptyLabel}</div>;
  }
  return (
    <div className={styles.textPage}>
      {kind === "markdown" ? (
        <MarkdownBody text={visible} />
      ) : kind === "code" ? (
        <CodeBlock
          code={visible}
          {...(extension ? { language: extension } : {})}
        />
      ) : (
        <pre className={styles.plainText} tabIndex={0}>
          {visible}
        </pre>
      )}
      {localMore || (hasMore && onLoadMore) ? (
        <button
          className={styles.loadMore}
          type="button"
          onClick={() => {
            if (localMore) setLimit((value) => value + TEXT_PAGE_CHARACTERS);
            else onLoadMore?.();
          }}
        >
          {localMore ? t("Show more") : t("Load more artifact")}
        </button>
      ) : null}
    </div>
  );
}

function ImagePreview({ blob, name }: { blob: Blob; name: string }) {
  const t = useUiText();
  const [url, setUrl] = useState<string>();
  const [size, setSize] = useState({ width: 1200, height: 900 });
  useEffect(() => {
    const next = URL.createObjectURL(blob.slice(0, blob.size, imageMime(name)));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob, name]);
  if (!url) {
    return (
      <div className={styles.message} role="status">
        {t("Loading preview…")}
      </div>
    );
  }
  return (
    <div className={styles.imagePage}>
      <img
        src={url}
        alt={name}
        width={size.width}
        height={size.height}
        onLoad={(event) => {
          const image = event.currentTarget;
          setSize({ width: image.naturalWidth, height: image.naturalHeight });
        }}
      />
    </div>
  );
}

function saveArtifact(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.split(/[\\/]/).at(-1) || "file";
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function imageMime(name: string): string {
  const extension = artifactExtension(name);
  if (extension === "jpg") return "image/jpeg";
  if (extension === "ico") return "image/x-icon";
  return `image/${extension}`;
}
