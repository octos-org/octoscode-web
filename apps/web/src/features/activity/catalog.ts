import type {
  TaskListEntry,
  TaskListResult,
} from "@octos-org/octoscode-client/protocol";

export interface ActivityCatalogResult {
  tasksBySession: Record<string, TaskListEntry[]>;
  unavailableSessions: string[];
}

/** Read only already-confirmed Session identities. Never discover by opening. */
export async function readActivityCatalog(
  client: {
    listTasks(params: { session_id: string }): Promise<TaskListResult>;
  },
  sessionIds: readonly string[],
): Promise<ActivityCatalogResult> {
  const unique = [...new Set(sessionIds)];
  const result: ActivityCatalogResult = {
    tasksBySession: {},
    unavailableSessions: [],
  };
  for (let offset = 0; offset < unique.length; offset += 4) {
    await Promise.all(
      unique.slice(offset, offset + 4).map(async (sessionId) => {
        try {
          const response = await client.listTasks({ session_id: sessionId });
          if (response.session_id !== sessionId)
            throw new Error("Wrong-session task catalog");
          result.tasksBySession[sessionId] = response.tasks;
        } catch {
          result.unavailableSessions.push(sessionId);
        }
      }),
    );
  }
  return result;
}
