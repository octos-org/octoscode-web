import { isRecord } from "@octos-org/octoscode-client/protocol";
import type { SkillActionJob } from "@octos-org/octoscode-client/skill-actions";

export interface ActionArgumentField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "json";
  jsonType?: "array" | "object";
}

export function actionArgumentFields(schema: unknown): ActionArgumentField[] {
  if (!isRecord(schema)) return [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return required.map((name) => {
    const definition = properties[name];
    const type = isRecord(definition) ? definition.type : undefined;
    if (type === "array" || type === "object") {
      return { name, type: "json", jsonType: type };
    }
    return {
      name,
      type:
        type === "integer"
          ? "integer"
          : type === "number"
            ? "number"
            : type === "boolean"
              ? "boolean"
              : "string",
    };
  });
}

export function actionArgumentsComplete(
  fields: readonly ActionArgumentField[],
  values: Readonly<Record<string, string | boolean>>,
): boolean {
  return fields.every((field) => {
    const value = values[field.name];
    if (field.type === "boolean") return typeof value === "boolean";
    if (typeof value !== "string" || !value.trim()) return false;
    if (field.type === "integer") return Number.isInteger(Number(value));
    if (field.type === "number") return Number.isFinite(Number(value));
    if (field.type === "json")
      return parseJsonField(field, value) !== undefined;
    return true;
  });
}

export function actionArguments(
  fields: readonly ActionArgumentField[],
  values: Readonly<Record<string, string | boolean>>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = values[field.name];
      if (field.type === "boolean") return [field.name, value === true];
      if (field.type === "number" || field.type === "integer") {
        return [field.name, Number(value)];
      }
      if (field.type === "json") {
        return [field.name, parseJsonField(field, String(value))];
      }
      return [field.name, value ?? ""];
    }),
  );
}

function parseJsonField(field: ActionArgumentField, value: string): unknown {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (field.jsonType === "array") {
      return Array.isArray(parsed) ? parsed : undefined;
    }
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function mergeSkillJobs(
  current: readonly SkillActionJob[],
  incoming: readonly SkillActionJob[],
): SkillActionJob[] {
  const jobs = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) jobs.set(job.id, job);
  return [...jobs.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20);
}

export function skillJobsActive(jobs: readonly SkillActionJob[]): boolean {
  return jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
}
