import { describe, expect, it, vi } from "vitest";

import { handleNotes, type JarvisNote, type NotesDeps } from "./notes";

const NOTE: JarvisNote = {
  id: "8c1c2f1e-6a4b-4b8e-9d3a-2f0c7c5e1a90",
  text: "Call the Payme team about the refund",
  due_on: "2026-09-30",
  created_at: "2026-09-29T10:00:00.000Z",
};

function deps(overrides: Partial<NotesDeps> = {}): NotesDeps {
  return {
    list: vi.fn(async () => [NOTE]),
    save: vi.fn(async (_role, note) => ({ ...NOTE, ...note })),
    clear: vi.fn(async () => true),
    ...overrides,
  };
}

describe("handleNotes", () => {
  it("refuses a request that does not say which department is asking", async () => {
    const result = await handleNotes({ role: null, method: "GET", body: {} }, deps());
    expect(result.status).toBe(403);
  });

  it("lists the open notes of the caller's department only", async () => {
    const d = deps();
    const result = await handleNotes({ role: "marketing", method: "GET", body: {} }, d);
    expect(d.list).toHaveBeenCalledWith("marketing");
    expect(result).toEqual({ status: 200, body: { ok: true, notes: [NOTE] } });
  });

  it("saves a note for the caller's department, with an optional due day", async () => {
    const d = deps();
    const result = await handleNotes(
      {
        role: "marketing",
        method: "POST",
        body: { action: "save", text: "  Call Payme  ", due_on: "2026-09-30" },
      },
      d,
    );
    expect(d.save).toHaveBeenCalledWith("marketing", { text: "Call Payme", due_on: "2026-09-30" });
    expect(result.status).toBe(200);
  });

  it("saves a plain note with no due day", async () => {
    const d = deps();
    await handleNotes(
      { role: "it", method: "POST", body: { action: "save", text: "Keys rotate in May" } },
      d,
    );
    expect(d.save).toHaveBeenCalledWith("it", { text: "Keys rotate in May", due_on: null });
  });

  it.each([
    [{ action: "save", text: "   " }],
    [{ action: "save", text: "x".repeat(501) }],
    [{ action: "save", text: "Call Payme", due_on: "tomorrow" }],
    [{ action: "clear", id: "not-a-uuid" }],
    [{ action: "shout" }],
  ])("rejects a malformed request: %j", async (body) => {
    const d = deps();
    const result = await handleNotes({ role: "ceo", method: "POST", body }, d);
    expect(result.status).toBe(400);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.clear).not.toHaveBeenCalled();
  });

  it("clears a note only within the caller's department", async () => {
    const d = deps({ clear: vi.fn(async () => false) });
    const result = await handleNotes(
      { role: "product", method: "POST", body: { action: "clear", id: NOTE.id } },
      d,
    );
    expect(d.clear).toHaveBeenCalledWith("product", NOTE.id);
    // Not found in this department, whether it exists elsewhere or not.
    expect(result.status).toBe(404);
  });

  it("confirms a cleared note", async () => {
    const result = await handleNotes(
      { role: "ceo", method: "POST", body: { action: "clear", id: NOTE.id } },
      deps(),
    );
    expect(result).toEqual({ status: 200, body: { ok: true, cleared: NOTE.id } });
  });

  it("takes only GET and POST", async () => {
    const result = await handleNotes({ role: "ceo", method: "DELETE", body: {} }, deps());
    expect(result.status).toBe(405);
  });

  it("reports a storage failure with its reason instead of an empty list", async () => {
    const d = deps({
      list: vi.fn(async () => {
        throw new Error("relation jarvis_notes does not exist");
      }),
    });
    const result = await handleNotes({ role: "ceo", method: "GET", body: {} }, d);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain("jarvis_notes");
  });
});
