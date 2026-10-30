import {
  isRecord,
  type ApprovalRequested,
} from "@octos-org/octoscode-client/protocol";

export interface ApprovalImpactDetails {
  directory?: string | undefined;
  network: "allowed" | "blocked" | "unspecified";
  destructive: boolean;
}

export function approvalImpactDetails(
  approval: ApprovalRequested,
): ApprovalImpactDetails {
  const details = isRecord(approval.typedDetails) ? approval.typedDetails : {};
  const command = isRecord(details.command) ? details.command : {};
  const directory = firstText(
    command.cwd,
    command.workdir,
    command.working_directory,
    details.cwd,
    details.workspace,
  );
  const network = networkValue(command.network ?? details.network);
  const commandText = [
    command.command_line,
    Array.isArray(command.argv) ? command.argv.join(" ") : undefined,
    approval.toolName,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return {
    directory,
    network,
    destructive:
      /\b(rm|del|delete|remove|unlink|rmdir|git reset|git clean)\b/i.test(
        commandText,
      ),
  };
}

function firstText(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function networkValue(value: unknown): ApprovalImpactDetails["network"] {
  if (value === true || value === "allow" || value === "allowed")
    return "allowed";
  if (value === false || value === "deny" || value === "blocked")
    return "blocked";
  return "unspecified";
}

export function permissionDeniedReason(status: string, body: string): boolean {
  return (
    status === "error" &&
    /permission|permitted|read-only|read_only|denied|forbidden|not allowed/i.test(
      body,
    )
  );
}
