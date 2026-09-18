export class OctosUiProtocolError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "OctosUiProtocolError";
    this.code = code;
    this.data = data;
  }
}
