import { describe, expect, it, vi } from "vitest";
import {
  describeSchedule,
  draftSchedule,
  formatDateTime,
  initialDraft,
  jobDetail,
  jobTitle,
  type ScheduleDraft,
} from "./schedule-form.ts";

const t = (key: string, values?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ""));
const draft = (patch: Partial<ScheduleDraft>): ScheduleDraft => ({
  ...initialDraft("Asia/Shanghai"),
  ...patch,
});

describe("draftSchedule", () => {
  it("turns each preset into the schedule Core runs, in the chosen timezone", () => {
    expect(draftSchedule(draft({ repeat: "daily" }))).toEqual({
      schedule: { kind: "Cron", expr: "0 0 9 * * *" },
      timezone: "Asia/Shanghai",
    });
    expect(
      draftSchedule(draft({ repeat: "weekly", weekday: "MON", time: "07:05" })),
    ).toEqual({
      schedule: { kind: "Cron", expr: "0 5 7 * * MON" },
      timezone: "Asia/Shanghai",
    });
    expect(
      draftSchedule(draft({ repeat: "interval", every: "1", unit: "minutes" })),
    ).toEqual({ schedule: { kind: "Every", every_ms: 60_000 } });
    expect(
      draftSchedule(draft({ repeat: "interval", every: "3", unit: "hours" })),
    ).toEqual({ schedule: { kind: "Every", every_ms: 10_800_000 } });
  });

  it("refuses intervals no preset should produce", () => {
    for (const every of ["0", "-1", "1.5", "abc", "", "10001", "1e400"]) {
      expect(typeof draftSchedule(draft({ repeat: "interval", every }))).toBe(
        "string",
      );
    }
  });

  it("refuses a time that is missing or already past", () => {
    const now = Date.parse("2027-01-02T03:04:00Z");
    expect(typeof draftSchedule(draft({ repeat: "once", at: "" }), now)).toBe(
      "string",
    );
    expect(
      typeof draftSchedule(
        draft({ repeat: "once", at: "2020-01-01T00:00" }),
        now,
      ),
    ).toBe("string");
    expect(typeof draftSchedule(draft({ time: "" }))).toBe("string");
  });

  it("lets a six-field expression replace the preset", () => {
    expect(
      draftSchedule(
        draft({ repeat: "interval", cron: " 0 30 8 * * MON-FRI " }),
      ),
    ).toEqual({
      schedule: { kind: "Cron", expr: "0 30 8 * * MON-FRI" },
      timezone: "Asia/Shanghai",
    });
    expect(typeof draftSchedule(draft({ cron: "0 9 * * *" }))).toBe("string");
  });
});

describe("describeSchedule", () => {
  it("reads presets back in words and leaves other expressions as written", () => {
    expect(describeSchedule({ kind: "Every", every_ms: 60_000 }, t)).toBe(
      "Every minute",
    );
    expect(describeSchedule({ kind: "Every", every_ms: 7_200_000 }, t)).toBe(
      "Every 2 hours",
    );
    expect(describeSchedule({ kind: "Cron", expr: "0 0 9 * * *" }, t)).toBe(
      "Every day at 09:00",
    );
    expect(describeSchedule({ kind: "Cron", expr: "0 5 18 * * MON" }, t)).toBe(
      "Every Monday at 18:05",
    );
    expect(describeSchedule({ kind: "Cron", expr: "0 0 9 1 * *" }, t)).toBe(
      "Cron: 0 0 9 1 * *",
    );
    expect(describeSchedule({ kind: "Cron", expr: "0 0 9 * * XYZ" }, t)).toBe(
      "Cron: 0 0 9 * * XYZ",
    );
  });

  it("names the year for one-time runs outside the current year only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-04T08:00:00Z"));
    try {
      // Same year stays compact; next year and 2099 must be unmistakable.
      expect(formatDateTime(Date.parse("2026-12-30T09:00:00"))).not.toMatch(
        /2026/,
      );
      expect(formatDateTime(Date.parse("2027-01-02T03:04:00"))).toMatch(/2027/);
      expect(formatDateTime(Date.parse("2099-06-30T09:00:00"))).toMatch(/2099/);
      expect(
        describeSchedule(
          { kind: "At", at_ms: Date.parse("2099-06-30T09:00:00") },
          t,
        ),
      ).toContain("2099");
      // Invalid input never fabricates a date.
      expect(formatDateTime(Number.NaN)).toBe("");
      expect(describeSchedule({ kind: "At", at_ms: Number.NaN }, t)).toBe(
        "Once, on ",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("job names", () => {
  it("uses the first line of the message as the name", () => {
    const job = {
      name: "写周报\n根据这个文件夹里的文件和最近一周的改动，写一份本周周报，存成 周报.md。不要",
      message:
        "写周报\n根据这个文件夹里的文件和最近一周的改动，写一份本周周报，存成 周报.md。不要改动其他文件。",
    };
    expect(jobTitle(job)).toBe("写周报");
    expect(jobDetail(job)).toBe(
      "根据这个文件夹里的文件和最近一周的改动，写一份本周周报，存成 周报.md。不要改动其他文件。",
    );
  });

  it("marks a name Core cut off and has nothing more to add for a short message", () => {
    const long = "a".repeat(60);
    expect(jobTitle({ name: long.slice(0, 48), message: long })).toBe(
      `${long.slice(0, 48)}…`,
    );
    expect(jobTitle({ name: "Check", message: "Check" })).toBe("Check");
    expect(jobDetail({ name: "Check", message: "Check" })).toBe("");
  });

  it("keeps a message that says something other than its name", () => {
    expect(jobDetail({ name: "Queue check", message: "check the queue" })).toBe(
      "check the queue",
    );
  });
});
