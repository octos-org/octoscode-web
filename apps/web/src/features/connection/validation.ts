/** Validate before opening a socket or remembering an address. */
export function connectionEndpointError(endpoint: string): string | null {
  if (!endpoint.trim()) return "Enter the address of your Octos server.";
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return "Enter a complete address, such as http://localhost:18032.";
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return "Use an http, https, ws, or wss address.";
  }
  if (url.username || url.password || url.search || url.hash) {
    return "Use the server address without credentials, query parameters, or a fragment. Put your token in Auth token.";
  }
  return null;
}
