export const UI_PROTOCOL_PATH = "/api/ui-protocol/ws";

export interface UiProtocolUrlOptions {
  endpoint: string;
  token?: string;
  features?: readonly string[];
}

export function buildUiProtocolUrl(options: UiProtocolUrlOptions): string {
  const url = new URL(options.endpoint);

  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Octos endpoint must use http, https, ws, or wss");
  }

  if (url.pathname === "" || url.pathname === "/")
    url.pathname = UI_PROTOCOL_PATH;

  const token = options.token?.trim();
  if (token) url.searchParams.set("token", token);

  url.searchParams.delete("ui_feature");
  for (const feature of options.features ?? []) {
    const normalized = feature.trim();
    if (normalized) url.searchParams.append("ui_feature", normalized);
  }

  return url.toString();
}
