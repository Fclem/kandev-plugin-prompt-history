import { describe, expect, it } from "vitest";
import { derivePromptHistoryRows, formatPromptDuration } from "./derive";
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
    const rows = derivePromptHistoryRows([withOrdinal, withoutOrdinal], [], true);
    expect(rows[0]?.promptNumber).toBe(7);
    expect(rows[0]?.isAgentPrompt).toBe(true);
    expect(rows[1]?.promptNumber).toBeNull();
    expect(rows[1]?.isAgentPrompt).toBe(false);
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
