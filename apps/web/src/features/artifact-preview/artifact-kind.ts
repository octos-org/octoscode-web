export type ArtifactKind =
  | "pdf"
  | "csv"
  | "image"
  | "svg"
  | "html"
  | "markdown"
  | "code"
  | "text"
  | "unsupported";

const CODE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "diff",
  "fish",
  "go",
  "h",
  "hpp",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "kts",
  "mjs",
  "patch",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

export function artifactExtension(reference: string): string {
  const name = reference.split(/[\\/]/).at(-1) ?? reference;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function artifactKind(reference: string): ArtifactKind {
  const extension = artifactExtension(reference);
  if (extension === "pdf") return "pdf";
  if (extension === "csv") return "csv";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "svg") return "svg";
  if (extension === "html" || extension === "htm") return "html";
  if (["md", "markdown", "mdx"].includes(extension)) return "markdown";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (["txt", "text", "log"].includes(extension)) return "text";
  return "unsupported";
}

/** Binary and sandboxed documents use the authenticated blob API, not text RPC pages. */
export function artifactReadsBlob(reference: string): boolean {
  return !["markdown", "code", "text"].includes(artifactKind(reference));
}
