import { describe, expect, it, vi } from "vitest";
import {
  claimPairingCode,
  consumePairingLink,
  loopbackOrigin,
  PAIRING_ERROR_COPY,
  pairingErrorCopy,
  probePairingInfo,
  readPairingLink,
  resetConsumedPairingLink,
  strippedPairingUrl,
} from "./pairing.ts";

const ORIGIN = "http://127.0.0.1:50080";
const CODE = "R7K2QPX9";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("reading the link", () => {
  it("needs both parameters", () => {
    expect(readPairingLink(`?octos=${ORIGIN}&pair=${CODE}`)).toEqual({
      origin: ORIGIN,
      code: CODE,
    });
    expect(readPairingLink(`?octos=${ORIGIN}`)).toBeNull();
    expect(readPairingLink(`?pair=${CODE}`)).toBeNull();
    expect(readPairingLink("?s=session-key")).toBeNull();
    expect(readPairingLink("")).toBeNull();
  });

  it("bounds both values so a hostile address cannot be echoed whole", () => {
    const link = readPairingLink(
      `?octos=http://127.0.0.1/${"a".repeat(9_000)}&pair=${"B".repeat(9_000)}`,
    );
    expect(link?.origin.length).toBe(2_048);
    expect(link?.code.length).toBe(65);
  });
});

describe("stripping the link", () => {
  it("removes octos and pair and keeps every other parameter", () => {
    expect(
      strippedPairingUrl(
        `http://127.0.0.1:4173/?octos=${encodeURIComponent(ORIGIN)}&pair=${CODE}&s=coding`,
      ),
    ).toBe("http://127.0.0.1:4173/?s=coding");
    expect(
      strippedPairingUrl(
        `http://127.0.0.1:4173/app?octos=${encodeURIComponent(ORIGIN)}&pair=${CODE}#top`,
      ),
    ).toBe("http://127.0.0.1:4173/app#top");
  });

  it("consumes the link once and replaces the address before any render", () => {
    resetConsumedPairingLink();
    const replaceState = vi.fn();
    const win = {
      location: {
        search: `?octos=${encodeURIComponent(ORIGIN)}&pair=${CODE}`,
        href: `http://127.0.0.1:4173/?octos=${encodeURIComponent(ORIGIN)}&pair=${CODE}`,
      },
      history: { replaceState },
    };
    vi.stubGlobal("window", win);
    try {
      expect(consumePairingLink()).toEqual({ origin: ORIGIN, code: CODE });
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        "http://127.0.0.1:4173/",
      );
      // A StrictMode second read sees the captured value, not the stripped URL.
      win.location.search = "";
      expect(consumePairingLink()).toEqual({ origin: ORIGIN, code: CODE });
      expect(replaceState).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      resetConsumedPairingLink();
    }
  });

  it("still reports the link when history cannot be rewritten", () => {
    resetConsumedPairingLink();
    vi.stubGlobal("window", {
      location: {
        search: `?octos=${ORIGIN}&pair=${CODE}`,
        href: `http://127.0.0.1:4173/?octos=${ORIGIN}&pair=${CODE}`,
      },
      history: {
        replaceState() {
          throw new Error("denied");
        },
      },
    });
    try {
      expect(consumePairingLink()).toEqual({ origin: ORIGIN, code: CODE });
    } finally {
      vi.unstubAllGlobals();
      resetConsumedPairingLink();
    }
  });
});

describe("loopback origins", () => {
  it("accepts only http(s) loopback addresses", () => {
    expect(loopbackOrigin("http://127.0.0.1:50080")).toBe(ORIGIN);
    expect(loopbackOrigin("http://localhost:18032/ignored?x=1")).toBe(
      "http://localhost:18032",
    );
    expect(loopbackOrigin("http://127.9.9.9:80")).toBe("http://127.9.9.9");
    expect(loopbackOrigin("https://[::1]:8443")).toBe("https://[::1]:8443");
    expect(loopbackOrigin("http://dev.localhost:8080")).toBe(
      "http://dev.localhost:8080",
    );
  });

  it("refuses anything that is not this computer", () => {
    for (const value of [
      "http://octos.example.com:8080",
      "http://10.0.0.4:8080",
      "http://127.0.0.1.evil.example",
      "ws://127.0.0.1:50080",
      "file:///etc/passwd",
      "http://user:pass@127.0.0.1:50080",
      "not a url",
      "",
    ]) {
      expect(loopbackOrigin(value), value).toBeNull();
    }
  });
});

describe("claiming the code", () => {
  it("posts the uppercased code and returns the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { token: "paired-token", server_origin: ORIGIN }),
    );
    const result = await claimPairingCode(
      { origin: ORIGIN, code: "r7k2qpx9" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({
      ok: true,
      claim: { token: "paired-token", serverOrigin: ORIGIN },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${ORIGIN}/pair/claim`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ code: CODE }));
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("refuses a non-loopback origin without making the request", async () => {
    const fetchImpl = vi.fn();
    const result = await claimPairingCode(
      { origin: "http://octos.example.com", code: CODE },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: false, kind: "pair_origin_not_loopback" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps every wire error kind", async () => {
    for (const kind of [
      "pair_code_unknown",
      "pair_code_expired",
      "pair_code_locked",
      "pair_code_invalid",
    ] as const) {
      const result = await claimPairingCode(
        { origin: ORIGIN, code: CODE },
        {
          fetchImpl: (async () =>
            jsonResponse(400, { error: { kind } })) as unknown as typeof fetch,
        },
      );
      expect(result, kind).toEqual({ ok: false, kind });
    }
  });

  it("treats an unreadable answer, a 404, and a dead socket distinctly", async () => {
    const cases: ReadonlyArray<readonly [() => Promise<Response>, string]> = [
      [async () => jsonResponse(404, {}), "pair_not_supported"],
      [
        async () => jsonResponse(400, { error: { kind: "nonsense" } }),
        "pair_unreachable",
      ],
      [async () => jsonResponse(200, { token: "" }), "pair_unreachable"],
      [
        async () => {
          throw new TypeError("Failed to fetch");
        },
        "pair_unreachable",
      ],
    ];
    for (const [fetchImpl, kind] of cases) {
      expect(
        await claimPairingCode(
          { origin: ORIGIN, code: CODE },
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
        kind,
      ).toEqual({ ok: false, kind });
    }
  });

  it("refuses an empty code locally", async () => {
    const fetchImpl = vi.fn();
    expect(
      await claimPairingCode(
        { origin: ORIGIN, code: "   " },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).toEqual({ ok: false, kind: "pair_code_invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names a next step in every kind's bounded copy", () => {
    for (const [kind, copy] of Object.entries(PAIRING_ERROR_COPY)) {
      expect(copy.length, kind).toBeLessThanOrEqual(160);
      expect(copy.trim().endsWith("."), kind).toBe(true);
      expect(pairingErrorCopy(kind as keyof typeof PAIRING_ERROR_COPY)).toBe(
        copy,
      );
    }
    expect(PAIRING_ERROR_COPY.pair_code_unknown).toBe(
      "That link was already used. Start the server again for a fresh link.",
    );
    expect(PAIRING_ERROR_COPY.pair_code_expired).toBe(
      "That link expired. Start the server again for a fresh link.",
    );
    expect(PAIRING_ERROR_COPY.pair_code_locked).toBe(
      "Too many attempts. Restart the Octos server.",
    );
    expect(PAIRING_ERROR_COPY.pair_code_invalid).toBe(
      "That link is malformed. Copy it again from the server.",
    );
  });
});

describe("probing /pair/info", () => {
  it("reads a pairing-capable server", async () => {
    expect(
      await probePairingInfo(ORIGIN, {
        fetchImpl: (async () =>
          jsonResponse(200, {
            product: "octos",
            version: "2.0.3",
            pairing_required: true,
            server_origin: ORIGIN,
          })) as unknown as typeof fetch,
      }),
    ).toEqual({
      kind: "available",
      info: {
        product: "octos",
        version: "2.0.3",
        pairingRequired: true,
        serverOrigin: ORIGIN,
      },
    });
  });

  it("calls a 404 pairing-not-supported and every other failure silent", async () => {
    expect(
      await probePairingInfo(ORIGIN, {
        fetchImpl: (async () =>
          jsonResponse(404, {})) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: "unsupported" });
    expect(
      await probePairingInfo(ORIGIN, {
        fetchImpl: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      await probePairingInfo(ORIGIN, {
        fetchImpl: (async () =>
          jsonResponse(200, {
            product: "something-else",
          })) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(await probePairingInfo("http://example.com")).toEqual({
      kind: "unavailable",
    });
  });
});
