import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";

/** Apply and verify the permission promised by a read-only task template. */
export async function applyTemplateReadOnly(
  client: OctosUiClient,
  sessionId: string,
): Promise<void> {
  const result = await client.setPermissionProfile({
    session_id: sessionId,
    update: { mode: "read_only" },
  });
  if (
    !result.applied ||
    result.session_id !== sessionId ||
    result.current.mode !== "read_only"
  ) {
    throw new Error("The server did not confirm read-only permission");
  }
}
