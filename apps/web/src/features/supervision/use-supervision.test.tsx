import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  useSupervision,
  type SupervisionController,
} from "./use-supervision.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.TASK_LIST,
    CORE_UI_METHODS.TASK_ARTIFACT_LIST,
    CORE_UI_METHODS.TASK_ARTIFACT_READ,
  ],
  supported_notifications: [],
  supported_features: [CORE_UI_FEATURES.HARNESS_TASK_ARTIFACTS_V1],
};

describe("useSupervision artifact selection", () => {
  it("clears loading for inline content and ignores an older read", async () => {
    const remote = {
      id: "remote",
      title: "Remote report",
      kind: "text",
      status: "ready",
      path: "report.txt",
    };
    const inline = {
      id: "inline",
      title: "Inline report",
      kind: "text",
      status: "ready",
      content: "inline body",
    };
    let resolveRemote!: (value: unknown) => void;
    const remoteResult = new Promise((resolve) => {
      resolveRemote = resolve;
    });
    const client = {
      listTasks: async () => ({ session_id: "session-1", tasks: [] }),
      listTaskArtifacts: async () => ({
        session_id: "session-1",
        task_id: "task-1",
        artifacts: [remote, inline],
      }),
      readTaskArtifact: async () => remoteResult,
    } as unknown as OctosUiClient;
    let controller!: SupervisionController;
    function Harness() {
      controller = useSupervision({
        client: () => client,
        sessionId: () => "session-1",
        capabilities: () => capabilities,
      });
      return null;
    }
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<Harness />);
    });
    await act(async () => controller.configureCapabilities(capabilities));
    await act(async () => controller.openTaskDetail("task-1"));
    let firstSelection!: Promise<void>;
    await act(async () => {
      firstSelection = controller.readTaskArtifact(remote);
      await Promise.resolve();
    });
    expect(controller.state.detail.artifactLoading).toBe(true);
    await act(async () => controller.readTaskArtifact(inline));
    expect(controller.state.detail.artifactLoading).toBe(false);
    expect(controller.state.detail.selectedArtifact?.artifact.id).toBe(
      "inline",
    );
    await act(async () => {
      resolveRemote({
        session_id: "session-1",
        task_id: "task-1",
        artifact: remote,
        content: "late remote body",
        has_more: false,
      });
      await firstSelection;
    });
    expect(controller.state.detail.artifactLoading).toBe(false);
    expect(controller.state.detail.selectedArtifact?.content).toBe(
      "inline body",
    );
    await act(async () => root.unmount());
  });
});
