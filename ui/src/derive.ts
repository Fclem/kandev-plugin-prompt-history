/**
 * Pure prompt-history row derivation from the Host conversation DTOs.
 *
 * Mirrors `buildPromptHistoryEntries` in `apps/web/lib/prompt-history.ts` so
 * the parity assertions compare the same arithmetic, including the
 * fraction-preserving nanosecond timestamp parse. The deliberate difference:
 * the core re-sorts its messages by the backend's microsecond-truncated key
 * (with an id tie-break) because it receives the whole session; the Host
 * facade hands the panel an already-ordered page (older pages append; live
 * updates arrive already ordered), so `derive` preserves the facade's page
 * order and does not re-sort.
 */
import type {
  PluginConversationMessage,
  PluginConversationTurn,
} from "./host";

export type PromptHistoryRow = {
  messageId: string;
  content: string;
  sentAt: string;
  durationSeconds: number | null;
  isAgentPrompt: boolean;
  /** Absolute 1-based ordinal among ALL user messages of the session (from
   * the server's `promptIndex`), or null when the payload carried none. */
  promptNumber: number | null;
};

export type PromptDurationUnits = {
  s: string;
  m: string;
  h: string;
};

/** Returns whether a user prompt was sent by another task's agent. */
function isAgentPrompt(message: PluginConversationMessage): boolean {
  const senderTaskId = message.senderTaskId;
  return typeof senderTaskId === "string" && senderTaskId.length > 0;
}

/**
 * Parse an RFC3339/RFC3339Nano timestamp into a full BigInt epoch-nanosecond
 * key, returning `null` for missing or unparseable values. The variable-width
 * fraction is removed before whole-second parsing (Date.parse only has
 * millisecond precision and rounds the sub-ms remainder), then re-attached as
 * the digit run right-padded to nine digits. Offsets (e.g. `+02:00`) are
 * normalized by Date.parse to UTC; they are whole seconds, so the fraction
 * is preserved unchanged.
 */
function epochNanoseconds(value: string | undefined): bigint | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  let wholePart = value;
  let fractionDigits = "";
  if (dot !== -1) {
    const rest = value.slice(dot + 1);
    const digitMatch = /^\d+/.exec(rest);
    fractionDigits = digitMatch ? digitMatch[0] : "";
    // Remove only the fraction digits; the zone suffix (Z or ±HH:MM) stays in
    // the whole part so Date.parse still normalizes the offset to UTC.
    wholePart = value.slice(0, dot) + rest.slice(fractionDigits.length);
  }
  const parsed = Date.parse(wholePart);
  if (Number.isNaN(parsed)) return null;
  // The whole part has no fraction, so the ms value is a whole second.
  const seconds = BigInt(Math.floor(parsed / 1000));
  const fractionNs = BigInt(fractionDigits.padEnd(9, "0").slice(0, 9) || "0");
  return seconds * BigInt(1_000_000_000) + fractionNs;
}

/**
 * Derive one row per message, preserving the facade's newest-first page order
 * (no re-sort). Each prompt's duration is bounded by the EARLIER of its turn
 * completion and the chronologically next (newer) prompt's `createdAt` — the
 * PRECEDING element of the newest-first array (index - 1), not index + 1 —
 * floored to whole seconds and clamped at zero. A missing bound yields no
 * duration; durations are suppressed until turns hydrate (the core
 * `turnsHydrated` gate).
 */
export function derivePromptHistoryRows(
  messages: readonly PluginConversationMessage[],
  turns: readonly PluginConversationTurn[],
  turnsHydrated: boolean,
): PromptHistoryRow[] {
  const turnsBySessionAndId = new Map<string, string | undefined>();
  for (const turn of turns) {
    turnsBySessionAndId.set(`${turn.sessionId}:${turn.id}`, turn.completedAt);
  }

  return messages.map((message, index) => {
    const promptNumber =
      typeof message.promptIndex === "number" && message.promptIndex > 0
        ? message.promptIndex
        : null;

    // The next (newer) prompt is the preceding element of the newest-first
    // array; the newest prompt (index 0) has no newer bound.
    const nextNewer = index >= 1 ? messages[index - 1] : undefined;
    const bounds = [
      message.turnId
        ? turnsBySessionAndId.get(`${message.sessionId}:${message.turnId}`)
        : undefined,
      nextNewer ? nextNewer.createdAt : undefined,
    ].filter((value): value is string => value !== undefined);

    let end: bigint | undefined;
    for (const bound of bounds) {
      const boundNs = epochNanoseconds(bound);
      if (boundNs === null) continue;
      if (end === undefined || boundNs < end) end = boundNs;
    }
    const startNs = epochNanoseconds(message.createdAt);
    let durationSeconds: number | null = null;
    if (turnsHydrated && startNs !== null && end !== undefined) {
      const durationNs = end - startNs;
      durationSeconds = Number(durationNs < BigInt(0) ? BigInt(0) : durationNs / BigInt(1_000_000_000));
    }

    return {
      messageId: message.id,
      content: message.content,
      sentAt: message.createdAt,
      durationSeconds,
      isAgentPrompt: isAgentPrompt(message),
      promptNumber,
    };
  });
}

/**
 * Format a duration in seconds as a compact `h m s` string using the given
 * unit labels, omitting empty hour/minute parts. Mirrors
 * `formatPromptDuration` in `apps/web/lib/prompt-history.ts`.
 */
export function formatPromptDuration(seconds: number, units: PromptDurationUnits): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) return `${hours}${units.h} ${minutes}${units.m} ${remainingSeconds}${units.s}`;
  if (minutes > 0) return `${minutes}${units.m} ${remainingSeconds}${units.s}`;
  return `${remainingSeconds}${units.s}`;
}

export type PromptAgeUnits = {
  /** Shown below the first minute, e.g. "just now". */
  justNow: string;
  /** Suffixed to the minute count, e.g. "m" in "5m". */
  m: string;
  h: string;
  d: string;
};

/** The absolute form the row shows: short numeric date and short time
 * (`1/1/26, 12:30 AM` in `en`), the compact pair that fits the row's
 * right-hand column and its tooltip. The parity reference's `formatDateTime`
 * uses `dateStyle: "medium"` (`Jan 1, 2026, 12:30 AM`); the short date is a
 * deliberate delta — the absolute form here is a real row state, not only a
 * hover tooltip, so it has to stay narrow. */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

/** Per-locale formatters, mirroring the reference's cached
 * `Intl.RelativeTimeFormat` map: a row re-renders on every live update, and
 * constructing a formatter per row per render is avoidable work. */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Format a prompt's timestamp as the absolute date and time in the host
 * locale, in the short date/short time form (`DATE_TIME_OPTIONS`). It is the
 * row's visible text when the operator selects the absolute prompt time
 * format, and the hover title otherwise (the reference always hovers the
 * absolute form; this plugin inverts it with the visible form, so the tooltip
 * is never the text already on screen).
 *
 * `pseudo` is a QA locale with no CLDR data, so it maps to `en` exactly as
 * the reference's `intlLocale()` does. An unparseable timestamp formats as
 * "" and an unusable locale tag falls back to `en` rather than throwing
 * inside a row render.
 */
export function formatPromptDateTime(sentAt: string, locale: string): string {
  const parsed = Date.parse(sentAt);
  if (Number.isNaN(parsed)) return "";
  const resolved = locale === "pseudo" ? "en" : locale || "en";
  const cached = dateTimeFormatters.get(resolved);
  if (cached) return cached.format(parsed);
  try {
    const formatter = new Intl.DateTimeFormat(resolved, DATE_TIME_OPTIONS);
    dateTimeFormatters.set(resolved, formatter);
    return formatter.format(parsed);
  } catch {
    const fallback = new Intl.DateTimeFormat("en", DATE_TIME_OPTIONS);
    dateTimeFormatters.set(resolved, fallback);
    return fallback.format(parsed);
  }
}

/**
 * Format a prompt's age as the compact relative label the parity reference's
 * row shows — `just now` / `5m` / `5h` / `3d`, with no "ago".
 *
 * The host's `utils.formatRelativeTime` (the only relative-time helper the
 * plugin contract exposes) is `Intl.RelativeTimeFormat`, which always phrases
 * a magnitude — "5 minutes ago" — and the reference deliberately reads
 * `formatRelativeCompact` instead, because the row already carries the
 * hourglass/duration affordance. So the ladder is reproduced here from the
 * plugin's own catalog; the buckets match `formatRelativeCompact` in
 * `apps/web/lib/i18n/formats.ts` exactly (floor of seconds/minutes, 60s, 60m
 * and 24h boundaries). `now` is injectable so the buckets are testable.
 */
export function formatPromptAge(
  sentAt: string,
  units: PromptAgeUnits,
  now: number = Date.now(),
): string {
  if (!sentAt) return "";
  const sent = Date.parse(sentAt);
  if (Number.isNaN(sent)) return "";
  const diffSeconds = Math.floor((now - sent) / 1000);
  if (diffSeconds < 60) return units.justNow;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}${units.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${units.h}`;
  return `${Math.floor(hours / 24)}${units.d}`;
}
