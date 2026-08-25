import { describe, expect, it } from "vitest";
import fixture from "./fixtures/ui-protocol-v1.json";
import {
  approvalDiffPreviewId,
  coreProtocolCompatibilityError,
  CORE_UI_PROTOCOL,
  isPreviewId,
  notificationDiffPreviewId,
  parseDiffPreviewGetResult,
  parsePermissionProfileListResult,
  parsePermissionProfileSetResult,
  SUPPORTED_OCTOS_CONTRACT,
  type ApprovalRequested,
} from "../src/index.ts";

describe("authoritative coding contract fixtures", () => {
  it("pins each fixture to an exact octos core contract blob", () => {
    const { protocol: _protocol, ...contractSource } = SUPPORTED_OCTOS_CONTRACT;
    expect(fixture.source).toEqual(contractSource);
    expect(
      fixture.config_capabilities_list.result.capabilities.version,
    ).toEqual({
      protocol: CORE_UI_PROTOCOL.protocol,
      schema_version: CORE_UI_PROTOCOL.schema_version,
      jsonrpc: CORE_UI_PROTOCOL.jsonrpc,
    });
    expect(
      fixture.config_capabilities_list.result.capabilities
        .capabilities_schema_version,
    ).toBe(CORE_UI_PROTOCOL.capabilities_schema_version);
    expect(
      coreProtocolCompatibilityError(
        fixture.config_capabilities_list.result.capabilities,
      ),
    ).toBeNull();
    expect(
      coreProtocolCompatibilityError({
        ...fixture.config_capabilities_list.result.capabilities,
        version: {
          ...fixture.config_capabilities_list.result.capabilities.version,
          protocol: "future-ui/v9",
        },
      }),
    ).toContain("future-ui/v9");
    expect(
      coreProtocolCompatibilityError({
        ...fixture.config_capabilities_list.result.capabilities,
        capabilities_schema_version: 3,
      }),
    ).toContain("outside 1..2");

    const hostile = coreProtocolCompatibilityError({
      ...fixture.config_capabilities_list.result.capabilities,
      version: {
        ...fixture.config_capabilities_list.result.capabilities.version,
        protocol: `future\n${"x".repeat(500)}do-not-render-this-tail`,
      },
    });
    expect(hostile).toContain("future\\n");
    expect(hostile).not.toContain("do-not-render-this-tail");
    expect(hostile?.length).toBeLessThan(180);
  });

  it("decodes permission list and mutation results", () => {
    expect(
      parsePermissionProfileListResult(fixture.permission_profile_list.result),
    ).toEqual(fixture.permission_profile_list.result);
    expect(
      parsePermissionProfileSetResult(fixture.permission_profile_set.result),
    ).toEqual(fixture.permission_profile_set.result);
  });

  it("decodes diff previews without narrowing forward-compatible labels", () => {
    expect(parseDiffPreviewGetResult(fixture.diff_preview_get.result)).toEqual(
      fixture.diff_preview_get.result,
    );
    expect(
      parseDiffPreviewGetResult({
        ...fixture.diff_preview_get.result,
        status: "requires_refresh",
        source: "future_cache",
        preview: {
          ...fixture.diff_preview_get.result.preview,
          files: [
            {
              path: "future.ts",
              status: "copied",
              hunks: [
                {
                  header: "@@ metadata @@",
                  lines: [{ kind: "metadata", content: "mode change" }],
                },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      status: "requires_refresh",
      source: "future_cache",
      preview: { files: [{ status: "copied" }] },
    });
  });

  it("fails closed on unknown permissions and malformed preview ids", () => {
    expect(isPreviewId("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(
      parsePermissionProfileListResult({
        ...fixture.permission_profile_list.result,
        current: { mode: "god_mode", network: "allow" },
      }),
    ).toBeNull();
    expect(
      parseDiffPreviewGetResult({
        ...fixture.diff_preview_get.result,
        preview: {
          ...fixture.diff_preview_get.result.preview,
          preview_id: "not-a-preview-id",
        },
      }),
    ).toBeNull();
  });
});

describe("diff preview discovery", () => {
  const previewId = fixture.diff_preview_get.request.preview_id;

  it("reads typed approval details only from the contract-defined field", () => {
    const approval = {
      typedDetails: { kind: "diff", diff: { preview_id: previewId } },
    } as Pick<ApprovalRequested, "typedDetails">;
    expect(approvalDiffPreviewId(approval)).toBe(previewId);
    expect(
      approvalDiffPreviewId({
        typedDetails: { body: `preview_id ${previewId}` },
      }),
    ).toBeNull();
  });

  it("reads progress mutation ids without scraping arbitrary text", () => {
    expect(
      notificationDiffPreviewId({
        jsonrpc: "2.0",
        method: "progress/updated",
        params: {
          metadata: {
            kind: "file_mutation",
            file_mutation: { path: "src/lib.rs", preview_id: previewId },
          },
        },
      }),
    ).toBe(previewId);
    expect(
      notificationDiffPreviewId({
        jsonrpc: "2.0",
        method: "warning",
        params: { message: `preview_id ${previewId}` },
      }),
    ).toBeNull();
  });
});
