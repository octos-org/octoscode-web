import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "./uuid.ts";

const originalCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("crypto", originalCrypto);
});

describe("randomUUID", () => {
  it("uses the native implementation when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "native-id",
      getRandomValues: () => {
        throw new Error("fallback should not be used");
      },
    });
    expect(randomUUID()).toBe("native-id");
  });

  it("falls back to getRandomValues in an insecure context", () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
    vi.stubGlobal("crypto", {
      getRandomValues: (target: Uint8Array) => {
        target.set(bytes);
        return target;
      },
    });
    expect(randomUUID()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
