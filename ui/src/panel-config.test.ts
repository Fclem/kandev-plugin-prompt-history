/**
 * The pure config reader behind the panel's display settings. The hook itself
 * (one fetch per mount) is covered through the rendered panel suite; these
 * cases pin the mapping from the `GET /api/plugins/<id>/config` envelope to
 * the nine settings, including every shape that must fall back to the
 * shown-by-default row.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_DISPLAY_SETTINGS,
  PANEL_AGENT_PROMPT_DISPLAYS,
  PANEL_AGENT_PROMPT_STYLES,
  PANEL_AGENT_STACK_EXPANDS,
  PANEL_AGENT_STACK_MIN_RUNS,
  PANEL_CONFIG_KEYS,
  PANEL_DATE_FORMATS,
  PANEL_NUMBER_STYLES,
  readPanelDisplaySettings,
  type PanelDisplaySettings,
} from "./panel-config";

/** Every enum setting: its config key, the settings field it feeds, and the
 * members the manifest declares for it. */
const ENUM_SETTINGS = [
  { key: "display_1b_number_style", field: "numberStyle", members: PANEL_NUMBER_STYLES },
  { key: "display_3_time_format", field: "dateFormat", members: PANEL_DATE_FORMATS },
  { key: "display_5_agent_prompt_style", field: "agentPromptStyle", members: PANEL_AGENT_PROMPT_STYLES },
  { key: "display_6_agent_prompt_display", field: "agentPromptDisplay", members: PANEL_AGENT_PROMPT_DISPLAYS },
  { key: "display_7_agent_stack_min", field: "agentStackMinRun", members: PANEL_AGENT_STACK_MIN_RUNS },
  { key: "display_8_agent_stack_expand", field: "agentStackExpand", members: PANEL_AGENT_STACK_EXPANDS },
] as const satisfies readonly {
  key: string;
  field: keyof PanelDisplaySettings;
  members: readonly unknown[];
}[];

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

  it("defaults to the panel's original appearance", () => {
    expect(DEFAULT_PANEL_DISPLAY_SETTINGS).toEqual({
      showNumbers: true,
      numberStyle: "inline",
      showTime: true,
      dateFormat: "relative",
      showDuration: true,
      agentPromptStyle: "default",
      agentPromptDisplay: "default",
      agentStackMinRun: 2,
      agentStackExpand: "hover",
    });
  });

  it("reads each stored boolean", () => {
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
  });

  it("applies every declared member of every enum, one at a time", () => {
    for (const { key, field, members } of ENUM_SETTINGS) {
      for (const member of members) {
        expect(readPanelDisplaySettings({ config: { [key]: member } })).toEqual({
          ...DEFAULT_PANEL_DISPLAY_SETTINGS,
          [field]: member,
        });
      }
    }
  });

  it("reads a fully customised config", () => {
    expect(
      readPanelDisplaySettings({
        config: {
          display_1_show_numbers: false,
          display_1b_number_style: "pill",
          display_2_show_time: false,
          display_3_time_format: "absolute",
          display_4_show_duration: false,
          display_5_agent_prompt_style: "soft grey",
          display_6_agent_prompt_display: "collapse",
          display_7_agent_stack_min: 4,
          display_8_agent_stack_expand: "click",
        },
      }),
    ).toEqual({
      showNumbers: false,
      numberStyle: "pill",
      showTime: false,
      dateFormat: "absolute",
      showDuration: false,
      agentPromptStyle: "soft grey",
      agentPromptDisplay: "collapse",
      agentStackMinRun: 4,
      agentStackExpand: "click",
    });
  });

  it("keeps colour and listing independent", () => {
    // Each of the two agent settings applies without touching the other.
    expect(
      readPanelDisplaySettings({ config: { display_5_agent_prompt_style: "soft grey" } }),
    ).toMatchObject({ agentPromptStyle: "soft grey", agentPromptDisplay: "default" });
    expect(
      readPanelDisplaySettings({ config: { display_6_agent_prompt_display: "hide" } }),
    ).toMatchObject({ agentPromptStyle: "default", agentPromptDisplay: "hide" });
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
    const strangers = ["", "Pill", "HOVER", "epoch", "normal", 0, 1, null, true, false, [], {}];
    for (const { key } of ENUM_SETTINGS) {
      for (const value of strangers) {
        expect(readPanelDisplaySettings({ config: { [key]: value } })).toEqual(
          DEFAULT_PANEL_DISPLAY_SETTINGS,
        );
      }
    }
    // The members of the old single `display_5_agent_style` setting are not
    // read by its replacements.
    for (const value of ["normal", "Soft Grey", "SOFT GREY", "hidden", "Collapse"]) {
      expect(readPanelDisplaySettings({ config: { display_5_agent_prompt_style: value } })).toEqual(
        DEFAULT_PANEL_DISPLAY_SETTINGS,
      );
    }
    expect(readPanelDisplaySettings({ config: { display_5_agent_style: "hide" } })).toEqual(
      DEFAULT_PANEL_DISPLAY_SETTINGS,
    );
  });

  it("applies only the exact members 2 to 5 for the stack minimum", () => {
    // Out-of-range, fractional, and stringified numbers all keep the default.
    for (const value of [0, 1, 6, 10, 2.5, -3, "3", "", null, true, [], {}]) {
      expect(readPanelDisplaySettings({ config: { display_7_agent_stack_min: value } })).toEqual(
        DEFAULT_PANEL_DISPLAY_SETTINGS,
      );
    }
  });

  it("keeps the key names and enums the manifest declares", () => {
    // Mirrored by TestPanelConfigKeysAgreement in server (manifest vs. these
    // constants); this pin catches a rename that updates only the reader.
    expect(PANEL_CONFIG_KEYS).toEqual({
      showNumbers: "display_1_show_numbers",
      numberStyle: "display_1b_number_style",
      showTime: "display_2_show_time",
      dateFormat: "display_3_time_format",
      showDuration: "display_4_show_duration",
      agentStyle: "display_5_agent_prompt_style",
      agentDisplay: "display_6_agent_prompt_display",
      agentStackMin: "display_7_agent_stack_min",
      agentStackExpand: "display_8_agent_stack_expand",
    });
    expect(PANEL_NUMBER_STYLES).toEqual(["inline", "pill"]);
    expect(PANEL_DATE_FORMATS).toEqual(["relative", "absolute"]);
    expect(PANEL_AGENT_PROMPT_STYLES).toEqual(["default", "soft grey"]);
    expect(PANEL_AGENT_PROMPT_DISPLAYS).toEqual(["default", "hide", "collapse"]);
    expect(PANEL_AGENT_STACK_MIN_RUNS).toEqual([2, 3, 4, 5]);
    expect(PANEL_AGENT_STACK_EXPANDS).toEqual(["hover", "click"]);
  });
});
