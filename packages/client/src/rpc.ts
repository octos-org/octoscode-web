const JSON_RPC_VERSION = "2.0";

export interface RpcRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  method: string;
  params: unknown;
}

export interface RpcSuccess {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  result: unknown;
}

export interface RpcFailure {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface RpcNotification {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params: unknown;
}

export type IncomingFrame =
  | { kind: "success"; value: RpcSuccess }
  | { kind: "failure"; value: RpcFailure }
  | { kind: "notification"; value: RpcNotification }
  | { kind: "invalid"; reason: string };

export function createRequest(
  id: string,
  method: string,
  params: unknown,
): RpcRequest {
  return { jsonrpc: JSON_RPC_VERSION, id, method, params };
}

export function parseIncomingFrame(source: string): IncomingFrame {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return { kind: "invalid", reason: "frame is not valid JSON" };
  }

  if (!isRecord(value) || value.jsonrpc !== JSON_RPC_VERSION) {
    return { kind: "invalid", reason: "frame is not a JSON-RPC 2.0 object" };
  }

  if (typeof value.method === "string" && !("id" in value)) {
    if (!("params" in value)) {
      return { kind: "invalid", reason: "notification is missing params" };
    }
    return {
      kind: "notification",
      value: {
        jsonrpc: JSON_RPC_VERSION,
        method: value.method,
        params: value.params,
      },
    };
  }

  if (typeof value.id === "string" && "result" in value) {
    return {
      kind: "success",
      value: { jsonrpc: JSON_RPC_VERSION, id: value.id, result: value.result },
    };
  }

  if (
    (typeof value.id === "string" || value.id === null) &&
    isRecord(value.error)
  ) {
    if (
      typeof value.error.code !== "number" ||
      typeof value.error.message !== "string"
    ) {
      return {
        kind: "invalid",
        reason: "error response has an invalid error object",
      };
    }
    return {
      kind: "failure",
      value: {
        jsonrpc: JSON_RPC_VERSION,
        id: value.id,
        error: {
          code: value.error.code,
          message: value.error.message,
          ...(value.error.data === undefined ? {} : { data: value.error.data }),
        },
      },
    };
  }

  return { kind: "invalid", reason: "frame shape is not recognized" };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
