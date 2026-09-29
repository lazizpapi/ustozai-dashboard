import { describe, expect, it } from "vitest";

import type { JarvisNote } from "@/lib/jarvis/notes";

import { dueLabel, groupNotes } from "./notes";

const note = (id: string, due_on: string | null, created_at = "2026-09-20T10:00:00.000Z"): JarvisNote => ({
  id,
  text: `note ${id}`,
  due_on,
  created_at,
});

describe("groupNotes", () => {
  it("splits reminders due by today, reminders still to come, and plain notes", () => {
    const groups = groupNotes(
      [
        note("later", "2026-10-05"),
        note("plain-old", null, "2026-09-01T10:00:00.000Z"),
        note("today", "2026-09-29"),
        note("soon", "2026-09-30"),
        note("overdue", "2026-09-25"),
        note("plain-new", null, "2026-09-28T10:00:00.000Z"),
      ],
      "2026-09-29",
    );
    expect(groups.due.map((n) => n.id)).toEqual(["overdue", "today"]);
    expect(groups.upcoming.map((n) => n.id)).toEqual(["soon", "later"]);
    expect(groups.notes.map((n) => n.id)).toEqual(["plain-new", "plain-old"]);
  });
});

describe("dueLabel", () => {
  it("names the day a reminder is due without shifting it across time zones", () => {
    expect(dueLabel("2026-09-30")).toBe("Wed 30 Sept");
  });
});
