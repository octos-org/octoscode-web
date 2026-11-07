import { describe, expect, it, vi } from "vitest";
import { claimPairingCode, readPairingLink } from "./pairing.ts";
const CODE = "R7K2QPX9";

describe("reading the link", () => {
  it("bounds both values so a hostile address cannot be echoed whole", () => {
    const link = readPairingLink(
      `?octos=http://127.0.0.1/${"a".repeat(9_000)}&pair=${"B".repeat(9_000)}`,
    );
    expect(link?.origin.length).toBe(2_048);
    expect(link?.code.length).toBe(65);
  });
});

describe("claiming the code", () => {
  it("refuses a non-loopback origin without making the request", async () => {
    const fetchImpl = vi.fn();
    const result = await claimPairingCode(
      { origin: "http://octos.example.com", code: CODE },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: false, kind: "pair_origin_not_loopback" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
