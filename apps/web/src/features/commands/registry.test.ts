import { describe, expect, it } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  commandAvailability,
  commandSuggestions,
  findCommand,
  looksLikeSlashCommand,
  parseCommandInvocation,
  WEB_COMMANDS,
} from "./registry.ts";

const capabilities = (
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities => ({
  version: {
    protocol: "octos-ui/v1alpha1",
    schema_version: 1,
    jsonrpc: "2.0",
  },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: features,
});

describe("octoscode command registry slice", () => {
  it("preserves path-leading prompts instead of dropping them as commands", () => {
    expect(looksLikeSlashCommand("/Users/me/file.rs is broken")).toBe(false);
    expect(looksLikeSlashCommand("/src\\main.rs is broken")).toBe(false);
    expect(parseCommandInvocation("/Users/me/file.rs is broken")).toBeNull();
  });

  it("resolves canonical names and aliases", () => {
    expect(findCommand("/tasks")?.name).toBe("ps");
    expect(findCommand("esc")?.name).toBe("stop");
    expect(parseCommandInvocation("  /help theme")).toEqual({
      name: "help",
      args: "theme",
    });
  });

  it("only suggests implemented commands", () => {
    expect(
      commandSuggestions("/", capabilities([])).map(({ name }) => name),
    ).toEqual(["ps", "stop", "help", "copy", "status"]);
    expect(
      commandSuggestions("/", capabilities(["task/list"])).map(
        ({ name }) => name,
      ),
    ).toContain("activity");
    expect(
      commandSuggestions("/st", capabilities([])).map(({ name }) => name),
    ).toEqual(["stop", "status"]);
  });

  it("requires all methods for resume, matching octoscode", () => {
    const resume = WEB_COMMANDS.find(({ name }) => name === "resume");
    expect(resume).toBeDefined();
    const implementedResume = { ...resume!, implemented: true };

    expect(
      commandAvailability(implementedResume, capabilities(["session/list"]))
        .available,
    ).toBe(false);
    expect(
      commandAvailability(
        implementedResume,
        capabilities(["session/list", "session/hydrate"]),
      ).available,
    ).toBe(true);
  });
});
