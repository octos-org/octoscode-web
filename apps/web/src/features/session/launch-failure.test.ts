import { OctosUiConnectionClosedError } from "@octos-org/octoscode-client";
import { describe, expect, it } from "vitest";
import {
  PROFILE_ACCESS_DENIED_MESSAGE,
  launchFailureMessage,
} from "./launch-failure.ts";
import zh from "../preferences/zh.ts";

describe("launch failure copy", () => {
  it("explains a 1008 close as a Profile permission", () => {
    expect(
      launchFailureMessage(
        new OctosUiConnectionClosedError({
          code: 1008,
          reason: "auth_expired",
        }),
      ),
    ).toBe(PROFILE_ACCESS_DENIED_MESSAGE);
  });

  it("keeps the existing message for every other close", () => {
    for (const close of [
      { code: 1006, reason: "" },
      { code: 1011, reason: "internal" },
      {},
    ]) {
      expect(
        launchFailureMessage(new OctosUiConnectionClosedError(close)),
      ).toBe("Octos UI Protocol connection closed");
    }
  });

  it("does not mistake an RPC error that happens to carry a code", () => {
    const rpc = Object.assign(new Error("profile_unconfigured"), {
      code: 1008,
    });
    expect(launchFailureMessage(rpc)).toBe("profile_unconfigured");
    expect(launchFailureMessage("plain text")).toBe("plain text");
  });

  it("has a Chinese translation for the dynamic messages", () => {
    expect(zh[PROFILE_ACCESS_DENIED_MESSAGE]).toContain("配置档案");
    expect(zh["Octos UI Protocol connection closed"]).toBeTruthy();
  });
});
