import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type {
  LlmCatalogResult,
  OctosUiClient,
  ProfileLlmConfigResult,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  useModelFactSources,
  type ModelFactSources,
} from "./use-model-fact-sources.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const capabilities = (...methods: string[]): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
});
const BOTH = capabilities("profile/llm/catalog", "profile/llm/list");
const catalog: LlmCatalogResult = {
  families: [{ id: "f", env: "", models: [{ id: "m", endpoints: [] }] }],
};
const config = (profileId: string): ProfileLlmConfigResult => ({
  profile_id: profileId,
  primary: null,
  fallbacks: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeClient() {
  const catalogRead = deferred<LlmCatalogResult>();
  const configReads = new Map<
    string,
    ReturnType<typeof deferred<ProfileLlmConfigResult>>[]
  >();
  const client = {
    getLlmCatalog: () => catalogRead.promise,
    readProfileLlmConfig: ({ profile_id }: { profile_id: string }) => {
      const read = deferred<ProfileLlmConfigResult>();
      configReads.set(profile_id, [
        ...(configReads.get(profile_id) ?? []),
        read,
      ]);
      return read.promise;
    },
  } as unknown as OctosUiClient;
  return { client, catalogRead, configReads };
}

function mount(initial: Parameters<typeof useModelFactSources>[0]): {
  rerender: (next: Parameters<typeof useModelFactSources>[0]) => void;
  current: () => ModelFactSources | null;
} {
  let latest: ModelFactSources | null = null;
  function Probe(props: { options: typeof initial }) {
    latest = useModelFactSources(props.options);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe options={initial} />);
  });
  return {
    rerender: (next) => {
      act(() => renderer.update(<Probe options={next} />));
    },
    current: () => latest,
  };
}

const settle = (work: () => void) =>
  act(async () => {
    work();
    await Promise.resolve();
  });

describe("useModelFactSources", () => {
  it("has no facts until both answers are in", async () => {
    const { client, catalogRead, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: BOTH,
      profileId: "a",
      models: [],
    });
    expect(view.current()).toBeNull();
    await settle(() => configReads.get("a")![0]!.resolve(config("a")));
    expect(view.current()).toBeNull();
    await settle(() => catalogRead.resolve(catalog));
    expect(view.current()).toEqual({ catalog, config: config("a") });
  });

  it("ignores a slow answer for the profile it just left", async () => {
    const { client, catalogRead, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: BOTH,
      profileId: "a",
      models: [],
    });
    await settle(() => catalogRead.resolve(catalog));
    view.rerender({ client, capabilities: BOTH, profileId: "b", models: [] });
    await settle(() => configReads.get("b")![0]!.resolve(config("b")));
    expect(view.current()?.config.profile_id).toBe("b");
    await settle(() => configReads.get("a")![0]!.resolve(config("a")));
    expect(view.current()?.config.profile_id).toBe("b");
  });

  it("shows nothing for a profile whose own answer has not arrived", async () => {
    const { client, catalogRead, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: BOTH,
      profileId: "a",
      models: [],
    });
    await settle(() => {
      catalogRead.resolve(catalog);
      configReads.get("a")![0]!.resolve(config("a"));
    });
    expect(view.current()?.config.profile_id).toBe("a");
    view.rerender({ client, capabilities: BOTH, profileId: "b", models: [] });
    expect(view.current()).toBeNull();
  });

  it("reads the configuration again when the model list changes", async () => {
    const { client, catalogRead, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: BOTH,
      profileId: "a",
      models: [1],
    });
    await settle(() => catalogRead.resolve(catalog));
    await settle(() => configReads.get("a")![0]!.resolve(config("a")));
    view.rerender({ client, capabilities: BOTH, profileId: "a", models: [2] });
    expect(configReads.get("a")).toHaveLength(2);
    // The list it answered for is still the best evidence until the new read lands.
    expect(view.current()?.config.profile_id).toBe("a");
  });

  it("gives no facts when the configuration can't be read, since it may override the catalog", async () => {
    const { client, catalogRead, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: BOTH,
      profileId: "a",
      models: [],
    });
    await settle(() => catalogRead.resolve(catalog));
    await settle(() => configReads.get("a")![0]!.reject(new Error("nope")));
    expect(view.current()).toBeNull();
  });

  it("works from configuration alone when the catalog is not offered or fails", async () => {
    const alone = fakeClient();
    const view = mount({
      client: alone.client,
      capabilities: capabilities("profile/llm/list"),
      profileId: "a",
      models: [],
    });
    await settle(() => alone.configReads.get("a")![0]!.resolve(config("a")));
    expect(view.current()).toEqual({ catalog: null, config: config("a") });

    const failing = fakeClient();
    const second = mount({
      client: failing.client,
      capabilities: BOTH,
      profileId: "a",
      models: [],
    });
    await settle(() => failing.catalogRead.reject(new Error("nope")));
    await settle(() => failing.configReads.get("a")![0]!.resolve(config("a")));
    expect(second.current()).toEqual({ catalog: null, config: config("a") });
  });

  it("asks nothing of a server that offers neither", () => {
    const { client, configReads } = fakeClient();
    const view = mount({
      client,
      capabilities: capabilities(),
      profileId: "a",
      models: [],
    });
    expect(configReads.size).toBe(0);
    expect(view.current()).toBeNull();
  });
});
