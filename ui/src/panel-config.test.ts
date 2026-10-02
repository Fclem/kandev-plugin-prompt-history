/**
 * The pure config reader behind the panel's display toggles. The hook itself
 * (one fetch per mount) is covered through the rendered panel suite; these
 * cases pin the mapping from the `GET /api/plugins/<id>/config` envelope to
 * the three booleans, including every shape that must fall back to the
 * shown-by-default row.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_DISPLAY_SETTINGS,
  PANEL_AGENT_PROMPT_STYLES,
  PANEL_CONFIG_KEYS,
  PANEL_DATE_FORMATS,
  readPanelDisplaySettings,
} from "./panel-config";

describe("readPanelDisplaySettings", () => {
  it("shows everything for a missing or unreadable payload", () => {
    for (const payload of [
      undefined,
      null,
      "nope",
      42,
      [],
      {},
      { config: null },
      { config: undefined },
      { config: [] },
      { config: "display_2_show_time" },
    ]) {
      expect(readPanelDisplaySettings(payload)).toEqual(DEFAULT_PANEL_DISPLAY_SETTINGS);
    }
  });

  it("reads each stored boolean and both enums", () => {
    expect(readPanelDisplaySettings({ config: { display_4_show_duration: false } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      showDuration: false,
    });
    expect(readPanelDisplaySettings({ config: { display_2_show_time: false } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      showTime: false,
    });
    expect(readPanelDisplaySettings({ config: { display_1_show_numbers: false } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      showNumbers: false,
    });
    expect(readPanelDisplaySettings({ config: { display_5_agent_style: "soft grey" } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      agentPromptStyle: "soft grey",
    });
    expect(readPanelDisplaySettings({ config: { display_5_agent_style: "hide" } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      agentPromptStyle: "hide",
    });
    expect(readPanelDisplaySettings({ config: { display_5_agent_style: "collapse" } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      agentPromptStyle: "collapse",
    });
    expect(readPanelDisplaySettings({ config: { display_5_agent_style: "normal" } })).toEqual(
      DEFAULT_PANEL_DISPLAY_SETTINGS,
    );
    expect(readPanelDisplaySettings({ config: { display_3_time_format: "absolute" } })).toEqual({
      ...DEFAULT_PANEL_DISPLAY_SETTINGS,
      dateFormat: "absolute",
    });
    expect(readPanelDisplaySettings({ config: { display_3_time_format: "relative" } })).toEqual(
      DEFAULT_PANEL_DISPLAY_SETTINGS,
    );
    expect(
      readPanelDisplaySettings({
        config: {
          display_4_show_duration: false,
          display_2_show_time: false,
          display_1_show_numbers: false,
          display_5_agent_style: "hide",
          display_3_time_format: "absolute",
        },
      }),
    ).toEqual({
      showDuration: false,
      showTime: false,
      showNumbers: false,
      dateFormat: "absolute",
      agentPromptStyle: "hide",
    });
  });

  it("ignores non-boolean values instead of coercing them", () => {
    expect(
      readPanelDisplaySettings({
        config: {
          display_4_show_duration: "false",
          display_2_show_time: 0,
          display_1_show_numbers: null,
        },
      }),
    ).toEqual(DEFAULT_PANEL_DISPLAY_SETTINGS);
  });

  it("falls back to the default for an unknown enum member", () => {
    for (const value of ["Relative", "ABSOLUTE", "", "epoch", 1, null, true, {}]) {
      expect(readPanelDisplaySettings({ config: { display_3_time_format: value } })).toEqual(
        DEFAULT_PANEL_DISPLAY_SETTINGS,
      );
    }
    for (const value of ["Soft Grey", "SOFT GREY", "hidden", "Collapse", "", 0, null, false, []]) {
      expect(readPanelDisplaySettings({ config: { display_5_agent_style: value } })).toEqual(
        DEFAULT_PANEL_DISPLAY_SETTINGS,
      );
    }
  });

  it("keeps the key names and enums the manifest declares", () => {
    // Mirrored by TestPanelConfigKeysAgreement in server (manifest vs. these
    // constants); this pin catches a rename that updates only the reader.
    expect(PANEL_CONFIG_KEYS).toEqual({
      showNumbers: "display_1_show_numbers",
      showTime: "display_2_show_time",
      dateFormat: "display_3_time_format",
      showDuration: "display_4_show_duration",
      agentStyle: "display_5_agent_style",
    });
    expect(PANEL_DATE_FORMATS).toEqual(["relative", "absolute"]);
    expect(PANEL_AGENT_PROMPT_STYLES).toEqual(["normal", "soft grey", "hide", "collapse"]);
  });
});
