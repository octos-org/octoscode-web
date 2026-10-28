import { isRecord } from "@octos-org/octoscode-client/protocol";
import type { SkillActionJob } from "@octos-org/octoscode-client/skill-actions";

export interface ActionArgumentField {
  name: string;
  type: "string" | "number" | "boolean";
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
    return {
      name,
      type:
        type === "number" || type === "integer"
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
    return field.type !== "number" || Number.isFinite(Number(value));
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
      if (field.type === "number") return [field.name, Number(value)];
      return [field.name, value ?? ""];
    }),
  );
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
