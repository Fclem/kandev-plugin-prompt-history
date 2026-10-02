/**
 * Operator display settings for the panel, read from this plugin's own
 * `config_schema` (manifest.yaml) through the Host's scoped fetch
 * (`host.api.fetch`) of `GET /api/plugins/<id>/config`.
 *
 * The host renders `config_schema` as the settings form at Settings > Plugins >
 * Prompt History; the panel never writes config and owns no storage. Every
 * field is a boolean that defaults to the panel's original always-show
 * behavior, so an instance whose config was never saved — and every failed or
 * unauthorized read — renders exactly as it did before the settings existed.
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
  /** Show the `#N` ordinal at the start of the row. */
  showNumbers: boolean;
  /** How the send time reads; the other form is the hover title. */
  dateFormat: PanelDateFormat;
  /** How prompts sent by another task's agent are shown. */
  agentPromptStyle: PanelAgentPromptStyle;
};

/** `relative` is the compact ladder ("5m", the parity reference's default);
 * `absolute` is the locale-formatted date and time. */
export type PanelDateFormat = "relative" | "absolute";

/**
 * How agent-sent prompts are presented: `normal` is the reference's row (the
 * same bubble as every other prompt, with the robot glyph), `soft grey`
 * repaints the bubble, and `hide` drops those rows from the panel entirely.
 * The values double as the settings form's option labels — the host renders an
 * enum's members verbatim.
 */
export type PanelAgentPromptStyle = "normal" | "soft grey" | "hide";

/** The `display_5_agent_style` enum the manifest declares, in form order. */
export const PANEL_AGENT_PROMPT_STYLES = ["normal", "soft grey", "hide"] as const;

/**
 * Config keys declared by `config_schema.properties` in manifest.yaml. The
 * settings form and the panel must agree on these names, so they live here and
 * `server/manifest_contract_test.go` fails if the manifest drifts.
 *
 * Listed in the order the host's settings form renders them. The `N_` segment
 * in each key is that position, not decoration: the host renders
 * `Object.keys(properties)` and receives them as a JSON object marshalled from
 * a Go map (sorted), so reordering the manifest's `properties` block changes
 * nothing — the key is the only ordering lever a plugin has.
 */
export const PANEL_CONFIG_KEYS = {
  showTime: "display_1_show_time",
  dateFormat: "display_2_time_format",
  showNumbers: "display_3_show_numbers",
  showDuration: "display_4_show_duration",
  agentStyle: "display_5_agent_style",
} as const;

/** The `display_2_time_format` enum the manifest declares. */
export const PANEL_DATE_FORMATS = ["relative", "absolute"] as const;

/** The panel's original appearance: what it rendered before the config
 * existed, and what an absent, unreadable, or malformed value falls back
 * to. */
export const DEFAULT_PANEL_DISPLAY_SETTINGS: PanelDisplaySettings = {
  showDuration: true,
  showTime: true,
  showNumbers: true,
  dateFormat: "relative",
  agentPromptStyle: "normal",
};

/** `host.api.fetch` resolves this against `/api/plugins/<id>`. */
const PANEL_CONFIG_PATH = "/config";

/** Whether two settings render identically, so the mount-time read can skip a
 * pointless re-render of every row. */
function samePanelDisplaySettings(
  left: PanelDisplaySettings,
  right: PanelDisplaySettings,
): boolean {
  return (
    left.showDuration === right.showDuration &&
    left.showTime === right.showTime &&
    left.showNumbers === right.showNumbers &&
    left.dateFormat === right.dateFormat &&
    left.agentPromptStyle === right.agentPromptStyle
  );
}

/**
 * Map a config payload to the panel's display settings. Anything absent or
 * mistyped keeps the default: the backend validates declared fields, so a
 * bad value here means the config came from a hand-edited file or a host that
 * answered with an unexpected shape, and rendering the wrong rows is the worse
 * failure. Both enums are total — only the exact stored member is applied, and
 * everything else (including a missing key) stays on the default.
 */
export function readPanelDisplaySettings(payload: unknown): PanelDisplaySettings {
  const settings = { ...DEFAULT_PANEL_DISPLAY_SETTINGS };
  if (!payload || typeof payload !== "object" || !("config" in payload)) return settings;
  const { config } = payload;
  if (!config || typeof config !== "object") return settings;
  const { showDuration, showTime, showNumbers, dateFormat, agentStyle } = PANEL_CONFIG_KEYS;
  if (showDuration in config && typeof config[showDuration] === "boolean") {
    settings.showDuration = config[showDuration];
  }
  if (showTime in config && typeof config[showTime] === "boolean") {
    settings.showTime = config[showTime];
  }
  if (showNumbers in config && typeof config[showNumbers] === "boolean") {
    settings.showNumbers = config[showNumbers];
  }
  if (dateFormat in config && config[dateFormat] === "absolute") {
    settings.dateFormat = "absolute";
  }
  if (agentStyle in config) {
    const stored = config[agentStyle];
    settings.agentPromptStyle =
      stored === "soft grey" ? "soft grey" : stored === "hide" ? "hide" : "normal";
  }
  return settings;
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
