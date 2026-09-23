import { describe, expect, it } from "vitest";
import { derivePromptHistoryRows, formatPromptAge, formatPromptDuration } from "./derive";
import type { PluginConversationMessage, PluginConversationTurn } from "./host";

function message(
  overrides: Partial<PluginConversationMessage>,
): PluginConversationMessage {
  return {
    id: "m",
    taskId: "t",
    sessionId: "s",
    authorType: "user",
    type: "message",
    content: "hi",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function turn(overrides: Partial<PluginConversationTurn>): PluginConversationTurn {
  return {
    id: "t",
    taskId: "t",
    sessionId: "s",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("derivePromptHistoryRows", () => {
  it("preserves the facade page order rather than sorting by timestamp", () => {
    // Two identical createdAt values whose ids are seeded so ascending-id
    // order contradicts the facade page order: a re-sort by (timestamp, id)
    // would emit [m1, m2], but the facade hands us [m2, m1] (newest-first).
    const newer = message({ id: "m2", createdAt: "2026-01-01T00:00:00Z" });
    const older = message({ id: "m1", createdAt: "2026-01-01T00:00:00Z" });
    const rows = derivePromptHistoryRows([newer, older], [], true);
    expect(rows.map((row) => row.messageId)).toEqual(["m2", "m1"]);
  });

  it("uses the fraction-preserving nanosecond parse, not millisecond truncation", () => {
    // The full-nanosecond difference is 999999999 ns (just under one second),
    // which floors to 0 seconds. A millisecond-truncated parse would yield
    // exactly 1000000000 ns (one second), flooring to 1 second. The
    // microsecond fractions straddle the second boundary.
    const created = "2026-01-01T00:00:01.000000005Z";
    const completed = "2026-01-01T00:00:02.000000004Z";
    const createdMessage = message({ id: "m", turnId: "t", createdAt: created });
    const rows = derivePromptHistoryRows(
      [createdMessage],
      [turn({ id: "t", completedAt: completed })],
      true,
    );
    expect(rows[0]?.durationSeconds).toBe(0);
  });

  it("derives the ordinal and agent-sent flag from the DTO fields", () => {
    const withOrdinal = message({ id: "m", promptIndex: 7, senderTaskId: "other" });
    const withoutOrdinal = message({ id: "n" });
    const zeroOrdinal = message({ id: "z", promptIndex: 0 });
    const rows = derivePromptHistoryRows(
      [withOrdinal, withoutOrdinal, zeroOrdinal],
      [],
      true,
    );
    expect(rows[0]?.promptNumber).toBe(7);
    expect(rows[0]?.isAgentPrompt).toBe(true);
    expect(rows[1]?.promptNumber).toBeNull();
    expect(rows[1]?.isAgentPrompt).toBe(false);
    // A zero index is "absent", not "#0".
    expect(rows[2]?.promptNumber).toBeNull();
  });

  it("bounds each duration by the earlier of turn completion and next-newer prompt", () => {
    // Newest-first: index 0 is the newest prompt, index 1 the older one.
    const newest = message({
      id: "newest",
      createdAt: "2026-01-01T00:00:02Z",
      turnId: "tn",
      promptIndex: 2,
    });
    const older = message({
      id: "older",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "to",
      promptIndex: 1,
    });
    // The older prompt's turn completes at 01Z (earlier than the next-newer
    // prompt's 02Z send time), so its duration is bounded by the turn.
    const turns = [
      turn({ id: "tn", completedAt: "2026-01-01T00:00:05Z" }),
      turn({ id: "to", completedAt: "2026-01-01T00:00:01Z" }),
    ];
    const rows = derivePromptHistoryRows([newest, older], turns, true);
    expect(rows[0]?.durationSeconds).toBe(3); // 05Z - 02Z, no newer bound
    expect(rows[1]?.durationSeconds).toBe(1); // min(01Z turn, 02Z newer) - 00Z
  });

  it("lets the next-newer prompt bound win when the turn completes later", () => {
    // Newest-first: index 0 is the newest prompt, index 1 the older one.
    const newer = message({
      id: "newer",
      createdAt: "2026-01-01T00:00:03.2Z",
      promptIndex: 2,
    });
    const older = message({
      id: "older",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "to",
      promptIndex: 1,
    });
    const rows = derivePromptHistoryRows(
      [newer, older],
      [turn({ id: "to", completedAt: "2026-01-01T00:00:10Z" })],
      true,
    );
    // 03.2Z - 00Z floors to 3, not the turn's 10s.
    expect(rows[1]?.durationSeconds).toBe(3);
  });

  it("lets the next-newer prompt bound win when the turn completion is unparseable", () => {
    const newer = message({
      id: "newer",
      createdAt: "2026-01-01T00:00:04Z",
      promptIndex: 2,
    });
    const older = message({
      id: "older",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "to",
      promptIndex: 1,
    });
    const rows = derivePromptHistoryRows(
      [newer, older],
      [turn({ id: "to", completedAt: "not-a-timestamp" })],
      true,
    );
    expect(rows[1]?.durationSeconds).toBe(4);
  });

  it("suppresses durations until turns hydrate", () => {
    const newest = message({
      id: "newest",
      createdAt: "2026-01-01T00:00:02Z",
      turnId: "tn",
    });
    const turns = [turn({ id: "tn", completedAt: "2026-01-01T00:00:05Z" })];
    const hydrated = derivePromptHistoryRows([newest], turns, true);
    const notHydrated = derivePromptHistoryRows([newest], turns, false);
    expect(hydrated[0]?.durationSeconds).toBe(3);
    expect(notHydrated[0]?.durationSeconds).toBeNull();
  });

  it("shows no duration when neither bound is present", () => {
    const lone = message({ id: "lone", createdAt: "2026-01-01T00:00:00Z" });
    const rows = derivePromptHistoryRows([lone], [], true);
    expect(rows[0]?.durationSeconds).toBeNull();
  });
});

describe("formatPromptDuration", () => {
  it("omits empty hour and minute parts", () => {
    const units = { s: "s", m: "m", h: "h" };
    expect(formatPromptDuration(5, units)).toBe("5s");
    expect(formatPromptDuration(65, units)).toBe("1m 5s");
    expect(formatPromptDuration(3665, units)).toBe("1h 1m 5s");
  });
});

describe("formatPromptAge", () => {
  const units = { justNow: "just now", m: "m", h: "h", d: "d" };
  const now = Date.parse("2026-09-23T12:00:00Z");
  const sentAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("walks the reference ladder at its bucket boundaries", () => {
    // Flooring matches the reference: 59.9s is still under a minute.
    expect(formatPromptAge(sentAgo(59), units, now)).toBe("just now");
    expect(formatPromptAge(sentAgo(60), units, now)).toBe("1m");
    expect(formatPromptAge(sentAgo(59 * 60 + 59), units, now)).toBe("59m");
    expect(formatPromptAge(sentAgo(60 * 60), units, now)).toBe("1h");
    expect(formatPromptAge(sentAgo(23 * 3600 + 3599), units, now)).toBe("23h");
    expect(formatPromptAge(sentAgo(24 * 3600), units, now)).toBe("1d");
    expect(formatPromptAge(sentAgo(72 * 3600), units, now)).toBe("3d");
  });

  it("never suffixes the age with 'ago'", () => {
    for (const seconds of [30, 90, 3600, 90_000]) {
      expect(formatPromptAge(sentAgo(seconds), units, now)).not.toMatch(/ago/);
    }
  });

  it("returns an empty label for unusable timestamps", () => {
    expect(formatPromptAge("", units, now)).toBe("");
    expect(formatPromptAge("not a date", units, now)).toBe("");
  });
});
