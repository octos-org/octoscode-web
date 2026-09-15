import { describe, expect, it } from "vitest";
import { connectionEndpointError } from "./validation.ts";

describe("connectionEndpointError", () => {
  it("accepts the supported transport schemes and custom socket paths", () => {
    for (const endpoint of [
      " http://localhost:18032 ",
      "https://octos.example.test",
      "ws://[::1]:18030",
      "wss://octos.example.test/custom/socket",
    ]) {
      expect(connectionEndpointError(endpoint)).toBeNull();
    }
  });

  it("rejects malformed addresses before a connection attempt", () => {
    for (const endpoint of [
      "",
      "  ",
      "localhost:18032",
      "not an address",
      "file:///tmp/octos",
    ]) {
      expect(connectionEndpointError(endpoint)).not.toBeNull();
    }
  });

  it("keeps credentials out of the address that will be remembered", () => {
    for (const endpoint of [
      "https://user:password@example.test",
      "https://example.test?token=private-token",
      "https://example.test#private-token",
    ]) {
      const error = connectionEndpointError(endpoint);
      expect(error).toContain("Put your token in Auth token");
      expect(error).not.toContain("private-token");
    }
  });
});
