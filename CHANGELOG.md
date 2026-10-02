# Changelog

## [1.3.0] - 2026-10-02

### Added

- **Agent prompt style `collapse`**: a fourth value for the
  `display_5_agent_style` selector. Each run of consecutive agent-sent prompts
  folds into one stacked card — the run's newest prompt on a grey front bubble
  with two offset outlines behind it, reading as a small deck in both themes.
  Hovering the card unfolds the run and moving the pointer off it folds it back;
  the card is also a real `button` with `aria-expanded` and a catalog label, so
  it unfolds on focus and toggles with Enter/Space (`Tab` into it to read the
  run).
- The card's meta column shows the front (newest) prompt's own send time and
  duration; the unfolded rows keep their ordinals, robot glyph, long-text expand
  control, transcript navigation, and favorite highlight. A run of exactly one
  agent prompt keeps the plain grey row (nothing to fold), and `collapse` paints
  every agent prompt grey, stacked or not.
- Folding changes neither numbering nor pagination: ordinals stay the server's
  `promptIndex` values, and paging still keys off every derived row, so a folded
  run whose oldest member is `#1` still stops older-page loading.

## [1.2.1] - 2026-10-02

### Changed

- Settings order is now **Show prompt numbering**, **Show prompt send time**,
  **Send time format**, **Show prompt duration**, **Agent prompt style**, and the
  format selector is labelled *Send time format* (it was "Prompt time format").
- The keys were renumbered to match that order
  (`display_1_show_numbers`, `display_2_show_time`, `display_3_time_format`,
  `display_4_show_duration`, `display_5_agent_style`). The two unchanged keys keep
  their stored values; the three renumbered ones (`show_numbers`, `show_time`,
  `time_format`) are no longer read, so those settings show their defaults until
  saved once on the settings page.

## [1.2.0] - 2026-10-02

### Added

- Operator display settings at Settings > Plugins > Prompt History, rendered by
  the host from the manifest's `config_schema` in this order:
  - **Show prompt send time** (clock) — boolean, on by default;
  - **Prompt time format** — required `relative` / `absolute` selector
    (default `relative`, the compact `5m` ladder). The row shows the selected
    form and hovers the other one, so the send-time hover is the absolute
    locale-formatted date under the compact relative text (matching the core
    panel's `title={formatDateTime(...)}`) and the host's relative phrase under
    the absolute text. The absolute form uses short date + short time
    (`1/1/26, 12:30 AM` in `en`) to stay narrow in the row's right column;
  - **Show prompt numbering** (`#N`) — boolean, on by default;
  - **Show prompt duration** (hourglass) — boolean, on by default;
  - **Agent prompt style** — required `normal` / `soft grey` / `hide` selector
    (default `normal`, the reference's own row). `soft grey` repaints prompts
    sent by another task's agent (the favorite highlight still wins), and
    `hide` drops those rows from the panel without renumbering the rest or
    changing pagination.
- With both right-edge toggles off the row renders no meta column, so the
  prompt text uses the full row width with equal left and right margins.
- `ui/src/panel-config.ts` reads the stored config once per panel mount through
  the host's scoped `GET /api/plugins/<id>/config`, keeping the default row for
  a failed, non-2xx, or malformed read, and `formatPromptDateTime` in
  `ui/src/derive.ts` renders the absolute form.

### Notes

- The field order is carried by the **keys**
  (`display_1_show_time` … `display_5_agent_style`): the host renders
  `Object.keys(properties)` from a JSON object marshalled out of a Go map,
  which sorts, so a manifest's declaration order never reaches the form. The
  prefixes are the only ordering lever, and `TestPanelConfigKeysAgreement` pins
  them (order, defaults, both `required` selectors and their enum members).
- Both selectors are `required`, which is what removes the host form's
  "Not set" choice; the panel still reads an absent or unknown value as the
  default (`relative` / `normal`), so a hand-edited config or a record written
  by an earlier version keeps working.

## [1.0.0] - 2026-09-23

### Changed

- Fix stale plugin stylesheet (grey bubble) and oversized row icons (046821f)
- Match the host's radius token and font metrics (9ab5189)
- Use the reference glyphs and the compact prompt age (d7c5766)

## [0.2.0] - 2026-09-22

### Changed

- Initial release


## [0.1.1] - 2026-09-22

### Changed

- Harden review edge cases (896f59f)
- Make favorite scope and send time observable in the suite (3bb637f)
- Build before typechecking, fix the release awk, and de-flake the gesture count (0d3b541)
- Pin the panel's scope, the manifest's surface, and error precedence (bd31879)
- Require the release tag to match the version and stop false loading status (3d6ec6b)
- Model the query task scope in the test host (ba47cf9)
- Check the manifest contract that packaging never parses (597f1b0)
- Cover committed-row errors and live deletion (39119a4)
- Only offer retry for retryable errors (62146c2)
- Enforce the plugin id and version agreement in CI (617b722)
- Record how the responsive matrix is verified (8f0fa75)
- Describe expand controls per row and unclip coarse-pointer targets (363f6a4)
- Pin the queued pin, indicator exclusivity, and the recovery claim (b0256db)
- Pin continuation-error recovery and document it (8e0f79a)
- Smoke-mount the built bundle under host React (91886f3)
- Pin the preload band and correct the stylesheet claim (f8c489e)
- Cover link-shaped nested targets and mark planned evidence (df8c2f5)
- Cover the pen retry gesture (a5769b7)
- Cover the sentinel re-arm and role-button chips (d38cdc0)
- Cover the disarm release and nested pointer retry (a116e66)
- Cover hydration, pagination gates, and locale copy (992ec11)
- Cover the preload band, duration units, and page size (6c81655)
- Cover session scoping, gestures, and indicator gating (4fe1c09)
- Cover the collapse control, query shaping, and shim (0e29977)
- Cover duration bounds, fallbacks, and registration (5c5d4b8)
- Assert the coverage the documents claim (6fa9d24)
- Render passthrough sessions before terminal removal (7b725d2)
- Cover the loading grace window and correct coverage claims (8b090d3)
- Retry older prompts once per touch tap (886c36f)
- Cover panel height transitions (f8dc1d9)
- Attach row measurement after loading (c0b7003)
- Enable keyboard prompt mentions (ffa8b93)
- Document stale pagination handoff (7c23453)
- Preserve interactive prompt controls (850c9bc)
- Guard active prompt pagination (eb308e2)
- Keep failed prompt pagination disarmed (3317d4e)
- Respect pagination scroll intent (dd000bb)
- Cover delayed final prompt commit (fc94d83)
- Preserve bottom pin on final prompt page (691e6bf)
- Use contracted React hooks only (7663b98)
- Fence prompt pagination lifecycle races (2bfdc49)
- Guard hidden prompt pagination (221c59c)
- Cover prompt panel state transitions (c399e39)
- Handle initial and removed panel states (fafdd0c)
- Harden prompt pagination rebinding (26b2b53)
- Address adversarial review findings (18cb90a)
- Match prompt history plugin UI parity (2229709)
- docs: clarify plugin implementation attribution (8f274c1)
- docs: format implementation attribution as callout (ad16ba1)
- docs: attribute prompt history plugin implementation (77a5efe)
- docs: set manifest author to Fclem (c0075f9)

