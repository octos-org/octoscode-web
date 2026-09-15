import { describe, expect, it } from "vitest";
import {
  REASONING_COPY,
  reasoningCopyFor,
} from "../reasoning/reasoning-copy.ts";
import { createUiText } from "../preferences/ui-text.tsx";

describe("show-thinking preference copy", () => {
  it("exposes English source strings for the pane row", () => {
    expect(REASONING_COPY.en).toMatchObject({
      paneRow: "Show thinking",
      paneHint:
        "Thinking appears in this Session's transcript, collapsed by default.",
    });
  });

  it("exposes zh strings in the new file, not zh.ts", () => {
    expect(REASONING_COPY.zh).toMatchObject({
      paneRow: "显示思考",
      paneHint: "思考会显示在此会话的记录中，默认折叠。",
    });
  });

  it("interpolates placeholders preserved between languages", () => {
    expect(
      reasoningCopyFor("en")("thinkingSummary", { seconds: 12, words: 340 }),
    ).toBe("Thinking · 12 s · 340 words");
    expect(
      reasoningCopyFor("zh")("thinkingSummary", { seconds: 12, words: 340 }),
    ).toBe("思考 · 12 秒 · 340 词");
  });

  it("keeps every placeholder identical across languages", () => {
    for (const key of Object.keys(REASONING_COPY.en)) {
      const en = REASONING_COPY.en[
        key as keyof typeof REASONING_COPY.en
      ] as unknown as string;
      const zh = REASONING_COPY.zh[
        key as keyof typeof REASONING_COPY.zh
      ] as unknown as string;
      expect(zh.match(/\{(\w+)\}/g)?.sort() ?? [], key).toEqual(
        en.match(/\{(\w+)\}/g)?.sort() ?? [],
      );
    }
  });

  it("does not reuse the cold zh catalog keys", () => {
    const t = createUiText("zh", {});
    expect(t("Show thinking")).toBe("Show thinking");
  });
});
