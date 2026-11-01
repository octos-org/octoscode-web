import type {
  OctosUiClient,
  PermissionProfileSelection,
} from "@octos-org/octoscode-client/protocol";

/** Apply and verify one complete template permission selection. */
export async function applyTemplatePermission(
  client: OctosUiClient,
  sessionId: string,
  selection: PermissionProfileSelection,
): Promise<void> {
  const result = await client.setPermissionProfile({
    session_id: sessionId,
    update: selection,
  });
  if (
    !result.applied ||
    result.session_id !== sessionId ||
    result.current.mode !== selection.mode ||
    result.current.network !== selection.network
  ) {
    throw new Error("The server did not confirm the template permission");
  }
}

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
