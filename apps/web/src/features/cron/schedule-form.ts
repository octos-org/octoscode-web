import type {
  CronCreateSchedule,
  CronJob,
} from "@octos-org/octoscode-client/cron";
import type { UiText } from "../preferences/ui-text.tsx";

export type RepeatKind = "daily" | "weekly" | "interval" | "once";
export type IntervalUnit = "minutes" | "hours";

export const WEEKDAYS = [
  { value: "MON", label: "Monday" },
  { value: "TUE", label: "Tuesday" },
  { value: "WED", label: "Wednesday" },
  { value: "THU", label: "Thursday" },
  { value: "FRI", label: "Friday" },
  { value: "SAT", label: "Saturday" },
  { value: "SUN", label: "Sunday" },
] as const;
export type Weekday = (typeof WEEKDAYS)[number]["value"];

export interface ScheduleDraft {
  repeat: RepeatKind;
  time: string;
  weekday: Weekday;
  every: string;
  unit: IntervalUnit;
  at: string;
  /** Advanced: when filled, this expression replaces the choices above. */
  cron: string;
  timezone: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_INTERVAL = 10_000;

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

export function initialDraft(timezone = browserTimezone()): ScheduleDraft {
  return {
    repeat: "daily",
    time: "09:00",
    weekday: "MON",
    every: "1",
    unit: "hours",
    at: "",
    cron: "",
    timezone,
  };
}

export interface DraftSchedule {
  schedule: CronCreateSchedule;
  timezone?: string;
}

/** The schedule a draft asks for, or the copy key of what is wrong with it. */
export function draftSchedule(
  draft: ScheduleDraft,
  now = Date.now(),
): DraftSchedule | string {
  const timezone = draft.timezone.trim();
  const cron = (expr: string): DraftSchedule => ({
    schedule: { kind: "Cron", expr },
    ...(timezone ? { timezone } : {}),
  });
  const expression = draft.cron.trim();
  if (expression) {
    return expression.split(/\s+/).length === 6
      ? cron(expression)
      : "Use a cron expression with seconds (six fields).";
  }
  if (draft.repeat === "once") {
    const atMs = new Date(draft.at).getTime();
    if (!draft.at || !Number.isSafeInteger(atMs)) {
      return "Choose a valid date and time.";
    }
    if (atMs <= now) return "Choose a future date and time.";
    return { schedule: { kind: "At", at_ms: atMs } };
  }
  if (draft.repeat === "interval") {
    const every = Number(draft.every);
    if (!Number.isInteger(every) || every < 1 || every > MAX_INTERVAL) {
      return "Enter a whole number from 1 to 10000.";
    }
    return {
      schedule: {
        kind: "Every",
        every_ms: every * (draft.unit === "hours" ? HOUR_MS : MINUTE_MS),
      },
    };
  }
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(draft.time);
  if (!time) return "Choose a time of day.";
  const [, hour, minute] = time;
  return cron(
    `0 ${Number(minute)} ${Number(hour)} * * ${
      draft.repeat === "weekly" ? draft.weekday : "*"
    }`,
  );
}

/** A schedule in the words a person would use; other expressions stay as written. */
export function describeSchedule(
  schedule: unknown,
  t: UiText,
  timezone?: string | null,
): string {
  const zone =
    timezone && timezone !== browserTimezone() ? ` (${timezone})` : "";
  if (!schedule || typeof schedule !== "object") return "";
  const value = schedule as {
    every_ms?: unknown;
    at_ms?: unknown;
    expr?: unknown;
  };
  if (typeof value.every_ms === "number")
    return describeEvery(value.every_ms, t);
  if (typeof value.at_ms === "number") {
    return t("Once, on {time}", { time: formatDateTime(value.at_ms) });
  }
  if (typeof value.expr !== "string") return "";
  const preset = /^0 (\d{1,2}) (\d{1,2}) \* \* (\*|[A-Z]{3})$/.exec(value.expr);
  const weekday = WEEKDAYS.find((day) => day.value === preset?.[3]);
  if (preset && (preset[3] === "*" || weekday)) {
    const time = `${preset[2]!.padStart(2, "0")}:${preset[1]!.padStart(2, "0")}`;
    return `${
      weekday
        ? t("Every {weekday} at {time}", { weekday: t(weekday.label), time })
        : t("Every day at {time}", { time })
    }${zone}`;
  }
  return `${t("Cron: {expression}", { expression: value.expr })}${zone}`;
}

function describeEvery(everyMs: number, t: UiText): string {
  if (everyMs === HOUR_MS) return t("Every hour");
  if (everyMs === MINUTE_MS) return t("Every minute");
  if (everyMs % HOUR_MS === 0) {
    return t("Every {count} hours", { count: everyMs / HOUR_MS });
  }
  if (everyMs % MINUTE_MS === 0) {
    return t("Every {count} minutes", { count: everyMs / MINUTE_MS });
  }
  return t("Every {count} seconds", { count: Math.round(everyMs / 1000) });
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** Core names a job after the first 48 characters of its message. */
export function jobTitle(job: Pick<CronJob, "name" | "message">): string {
  const name = job.name.split("\n", 1)[0]!.trim();
  const cut =
    !job.name.includes("\n") &&
    job.message.startsWith(job.name) &&
    job.message.length > job.name.length &&
    job.message[job.name.length] !== "\n";
  return cut ? `${name}…` : name;
}

/** The part of the message the title does not already say. */
export function jobDetail(job: Pick<CronJob, "name" | "message">): string {
  const lines = job.message.split("\n");
  const title = job.name.split("\n", 1)[0]!.trim();
  if (lines[0]!.trim() !== title) return job.message.trim();
  return lines.slice(1).join(" ").trim();
}

export const TASK_TEMPLATES = [
  {
    id: "weekly-report",
    title: "Write a weekly report",
    prompt:
      "Using this folder's files and the past week's changes, write this week's report and save it as weekly-report.md. Do not change other files. When done, give me the highlights and the file name in two or three sentences.",
  },
  {
    id: "test-report",
    title: "Run tests and report",
    prompt:
      "Run this project's tests. Report how many passed and failed; for each failure, name the test and its most likely cause. Do not change any code.",
  },
] as const;
export type TaskTemplateId = (typeof TASK_TEMPLATES)[number]["id"] | "custom";

/** The first line is what the list shows as the task's name. */
export function templateMessage(id: TaskTemplateId, t: UiText): string {
  const template = TASK_TEMPLATES.find((candidate) => candidate.id === id);
  return template ? `${t(template.title)}\n${t(template.prompt)}` : "";
}
