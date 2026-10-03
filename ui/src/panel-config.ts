/**
 * Operator display settings for the panel, read from this plugin's own
 * `config_schema` (manifest.yaml) through the Host's scoped fetch
 * (`host.api.fetch`) of `GET /api/plugins/<id>/config`.
 *
 * The host renders `config_schema` as the settings form at Settings > Plugins >
 * Prompt History; the panel never writes config and owns no storage. Every
 * field defaults to the panel's original appearance, so an instance whose
 * config was never saved — and every failed or unauthorized read — renders
 * exactly as it did before the settings existed.
 *
 * The fetch is one-shot on mount: config is stable for a mounted panel, and a
 * saved change applies the next time the panel mounts (session/task switch or
 * reload). The read is deliberately not part of the conversation facade, which
 * carries prompts only.
 */
import { useEffect, useState } from "react";
import { host } from "./host";

export type PanelDisplaySettings = {
  /** Show the agent-work duration (hourglass) at the row's right edge. */
  showDuration: boolean;
  /** Show the prompt's send time (clock) at the row's right edge. */
  showTime: boolean;
  /** Show the `#N` ordinal. */
  showNumbers: boolean;
  /** Where the ordinal sits: inline before the text, or as a pill on the
   * bubble's top-left corner. */
  numberStyle: PanelNumberStyle;
  /** How the send time reads; the other form is the hover title. */
  dateFormat: PanelDateFormat;
  /** Whether agent-sent prompts keep the reference's bubble colour or get a
   * soft grey one. Independent of `agentPromptDisplay`. */
  agentPromptStyle: PanelAgentPromptStyle;
  /** Whether agent-sent prompts are listed as ordinary rows, hidden, or
   * folded into stacks. Independent of `agentPromptStyle`. */
  agentPromptDisplay: PanelAgentPromptDisplay;
  /** With the `collapse` display, the smallest run of consecutive agent-sent
   * prompts that folds into a stack; shorter runs stay separate rows. */
  agentStackMinRun: PanelAgentStackMinRun;
  /** With the `collapse` display, what unfolds a stack. */
  agentStackExpand: PanelAgentStackExpand;
};

/** `relative` is the compact ladder ("5m", the parity reference's default);
 * `absolute` is the locale-formatted date and time. */
export type PanelDateFormat = "relative" | "absolute";

/** The `display_3_time_format` enum the manifest declares. */
export const PANEL_DATE_FORMATS = ["relative", "absolute"] as const;

/**
 * Where a prompt's `#N` ordinal goes: `inline` is the reference's own spot, in
 * front of the text; `pill` lifts it onto the bubble's top-left corner in the
 * same pill the folded stack uses for its count. The values double as the
 * settings form's option labels — the host renders an enum's members verbatim.
 */
export const PANEL_NUMBER_STYLES = ["inline", "pill"] as const;
export type PanelNumberStyle = (typeof PANEL_NUMBER_STYLES)[number];

/**
 * The colour of agent-sent prompts: `default` is the reference's prompt colour
 * (with the robot glyph), `soft grey` repaints the bubble. Colour only — what
 * is listed is `PANEL_AGENT_PROMPT_DISPLAYS`.
 */
export const PANEL_AGENT_PROMPT_STYLES = ["default", "soft grey"] as const;
export type PanelAgentPromptStyle = (typeof PANEL_AGENT_PROMPT_STYLES)[number];

/**
 * How agent-sent prompts are listed: `default` is one row per prompt, `hide`
 * drops those rows from the panel entirely, and `collapse` folds each run of
 * consecutive agent-sent prompts into one stacked card (see
 * `groupPromptHistoryRows` in `ui/src/derive.ts` and `AgentPromptStack` in
 * `ui/src/panel.tsx`).
 */
export const PANEL_AGENT_PROMPT_DISPLAYS = ["default", "hide", "collapse"] as const;
export type PanelAgentPromptDisplay = (typeof PANEL_AGENT_PROMPT_DISPLAYS)[number];

/** The `display_7_agent_stack_min` enum the manifest declares: the smallest run
 * of consecutive agent-sent prompts the `collapse` display folds into a stack. */
export const PANEL_AGENT_STACK_MIN_RUNS = [2, 3, 4, 5] as const;
export type PanelAgentStackMinRun = (typeof PANEL_AGENT_STACK_MIN_RUNS)[number];

/** What unfolds a stack: `hover` also unfolds on focus and a press and folds
 * when the pointer or focus leaves; `click` unfolds and folds only on a click
 * (or Enter/Space) of the card. */
export const PANEL_AGENT_STACK_EXPANDS = ["hover", "click"] as const;
export type PanelAgentStackExpand = (typeof PANEL_AGENT_STACK_EXPANDS)[number];

/**
 * Config keys declared by `config_schema.properties` in manifest.yaml. The
 * settings form and the panel must agree on these names, so they live here and
 * `server/manifest_contract_test.go` fails if the manifest drifts.
 *
 * Listed in the order the host's settings form renders them, and that order is
 * what groups the form into topics (numbers, time, agent prompts, agent
 * stacks). The `display_<n>_` segment is the position, not decoration: the host
 * renders `Object.keys(properties)` and receives them as a JSON object
 * marshalled from a Go map (sorted by byte value), so reordering the
 * manifest's `properties` block changes nothing — the key is the only ordering
 * lever a plugin has. `display_1b_` sorts between `display_1_` and `display_2_`
 * (`_` is below `b`), which is how the second numbers setting sits next to the
 * first without renaming the three keys operators may already have stored.
 */
export const PANEL_CONFIG_KEYS = {
  showNumbers: "display_1_show_numbers",
  numberStyle: "display_1b_number_style",
  showTime: "display_2_show_time",
  dateFormat: "display_3_time_format",
  showDuration: "display_4_show_duration",
  agentStyle: "display_5_agent_prompt_style",
  agentDisplay: "display_6_agent_prompt_display",
  agentStackMin: "display_7_agent_stack_min",
  agentStackExpand: "display_8_agent_stack_expand",
} as const;

/** The panel's original appearance: what it rendered before the config
 * existed, and what an absent, unreadable, or malformed value falls back
 * to. */
export const DEFAULT_PANEL_DISPLAY_SETTINGS: PanelDisplaySettings = {
  showDuration: true,
  showTime: true,
  showNumbers: true,
  numberStyle: "inline",
  dateFormat: "relative",
  agentPromptStyle: "default",
  agentPromptDisplay: "default",
  agentStackMinRun: 2,
  agentStackExpand: "hover",
};

/** `host.api.fetch` resolves this against `/api/plugins/<id>`. */
const PANEL_CONFIG_PATH = "/config";

/** Whether two settings render identically, so the mount-time read can skip a
 * pointless re-render of every row. */
function samePanelDisplaySettings(
  left: PanelDisplaySettings,
  right: PanelDisplaySettings,
): boolean {
  return (Object.keys(left) as (keyof PanelDisplaySettings)[]).every(
    (key) => left[key] === right[key],
  );
}

/** The stored value when it is exactly one of the enum's members; anything
 * else — absent, mistyped, differently cased, out of range — is the fallback. */
function readMember<T>(members: readonly T[], stored: unknown, fallback: T): T {
  return members.find((member) => member === stored) ?? fallback;
}

function readBoolean(stored: unknown, fallback: boolean): boolean {
  return typeof stored === "boolean" ? stored : fallback;
}

/**
 * Map a config payload to the panel's display settings. Anything absent or
 * mistyped keeps the default: the backend validates declared fields, so a
 * bad value here means the config came from a hand-edited file or a host that
 * answered with an unexpected shape, and rendering the wrong rows is the worse
 * failure. Every enum is total — only the exact stored member is applied, and
 * everything else (including a missing key) stays on the default.
 */
export function readPanelDisplaySettings(payload: unknown): PanelDisplaySettings {
  const defaults = DEFAULT_PANEL_DISPLAY_SETTINGS;
  if (!payload || typeof payload !== "object" || !("config" in payload)) return { ...defaults };
  const { config } = payload;
  if (!config || typeof config !== "object") return { ...defaults };
  const stored = config as Record<string, unknown>;
  const keys = PANEL_CONFIG_KEYS;
  return {
    showDuration: readBoolean(stored[keys.showDuration], defaults.showDuration),
    showTime: readBoolean(stored[keys.showTime], defaults.showTime),
    showNumbers: readBoolean(stored[keys.showNumbers], defaults.showNumbers),
    numberStyle: readMember(PANEL_NUMBER_STYLES, stored[keys.numberStyle], defaults.numberStyle),
    dateFormat: readMember(PANEL_DATE_FORMATS, stored[keys.dateFormat], defaults.dateFormat),
    agentPromptStyle: readMember(
      PANEL_AGENT_PROMPT_STYLES,
      stored[keys.agentStyle],
      defaults.agentPromptStyle,
    ),
    agentPromptDisplay: readMember(
      PANEL_AGENT_PROMPT_DISPLAYS,
      stored[keys.agentDisplay],
      defaults.agentPromptDisplay,
    ),
    agentStackMinRun: readMember(
      PANEL_AGENT_STACK_MIN_RUNS,
      stored[keys.agentStackMin],
      defaults.agentStackMinRun,
    ),
    agentStackExpand: readMember(
      PANEL_AGENT_STACK_EXPANDS,
      stored[keys.agentStackExpand],
      defaults.agentStackExpand,
    ),
  };
}

/**
 * Read the plugin's display settings once per mount. A failed read (offline
 * host, unauthenticated split origin, or an unmount abort) leaves the
 * defaults in place and never surfaces an error: the rows stay at parity with
 * the reference rather than degrading over a settings read.
 */
export function usePanelDisplaySettings(): PanelDisplaySettings {
  const [settings, setSettings] = useState(DEFAULT_PANEL_DISPLAY_SETTINGS);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await host().api.fetch(PANEL_CONFIG_PATH, {
          signal: controller.signal,
          // The route has no cache headers; a saved change must be visible on
          // the next mount instead of a heuristic HTTP-cache hit.
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        const next = readPanelDisplaySettings(payload);
        // Keep the previous object when nothing changed so the default read
        // (config never saved) does not re-render every row on every mount.
        if (!cancelled) {
          setSettings((previous) =>
            samePanelDisplaySettings(previous, next) ? previous : next,
          );
        }
      } catch {
        // Keep the defaults.
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);
  return settings;
}
