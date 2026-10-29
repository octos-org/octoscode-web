import { describe, expect, it } from "vitest";
import { shouldPublishCopyConfirmation } from "./CopySessionLinkButton.tsx";

describe("copy-link confirmation ownership", () => {
  it("drops a completion from the previous Session", () => {
    expect(shouldPublishCopyConfirmation(1, 2)).toBe(false);
    expect(shouldPublishCopyConfirmation(2, 2)).toBe(true);
  });
});
