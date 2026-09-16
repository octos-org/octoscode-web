import { describe, expect, it } from "vitest";
import { parseInspectionIntent } from "./intent.ts";
const id = "00000000-0000-4000-8000-000000000011";
describe("native inspection slash grammar", () => {
  it.each(["thread", "threads"] as const)(
    "accepts exact native %s graph aliases",
    (command) => {
      for (const args of ["", "graph", "graph-get", " graph \n"])
        expect(parseInspectionIntent(command, args)).toEqual({
          ok: true,
          request: { kind: "threads" },
        });
      for (const args of ["graph extra", "list", "delete", "graph-get extra"])
        expect(parseInspectionIntent(command, args).ok).toBe(false);
    },
  );
  it("requires the captured active UUID when the native turn argument is omitted", () => {
    for (const args of ["", "state", "state-get"]) {
      expect(parseInspectionIntent("turn", args).ok).toBe(false);
      expect(parseInspectionIntent("turn", args, id)).toEqual({
        ok: true,
        request: { kind: "turn", turnId: id },
      });
    }
  });
  it("rejects direct UUID, unknown verbs, extra tokens and malformed identifiers", () => {
    for (const args of [
      id,
      "start",
      "state invalid",
      `state ${id} extra`,
      'state-get "quoted"',
    ])
      expect(parseInspectionIntent("turn", args, id).ok).toBe(false);
  });
  it("uses explicit UUID over the active turn and canonicalizes Rust UUID forms", () => {
    const other = "00000000-0000-4000-8000-000000000022";
    for (const raw of [id, id.replaceAll("-", ""), `{${id}}`, `urn:uuid:${id}`])
      expect(parseInspectionIntent("turn", `state ${raw}`, other)).toEqual({
        ok: true,
        request: { kind: "turn", turnId: id },
      });
  });
});
