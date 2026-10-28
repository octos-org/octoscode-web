/// <reference lib="webworker" />
import mammoth from "mammoth";

self.onmessage = async (
  event: MessageEvent<{ requestId: number; buffer: ArrayBuffer }>,
) => {
  const { requestId, buffer } = event.data;
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        includeDefaultStyleMap: true,
      },
    );
    self.postMessage({ requestId, type: "docx", html: result.value });
  } catch (reason) {
    self.postMessage({
      requestId,
      type: "error",
      error:
        reason instanceof Error ? reason.message : "DOCX conversion failed",
    });
  }
};
