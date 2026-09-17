---
status: draft
system: plugins
created: 2026-09-15
owners:
  - kandev
---
# Prompt History Plugin Requirements

## Overview

The Prompt History plugin is the production, independently packaged
implementation of the Prompt History task panel. It delivers feature parity
with the shipped core panel — user-prompt listing, per-row presentation,
older-page auto-loading, live reconciliation, transcript navigation, and
desktop/mobile placement — through the public Host contracts established by the
[Host prerequisites package](prompt-history-extraction-host.md), without
importing private stores or duplicating host-owned transport. It lives in the
dedicated `kdlbs/kandev-plugin-prompt-history` repository, not in the Kandev
monorepo. This document is authoritative only for the plugin's own behavior;
the core panel remains the parity reference and stays registered and
behaviorally unchanged until a later package migrates saved layouts and removes
core ownership.

## Terminology

- **Parity reference:** the shipped core Prompt History panel
  (`apps/web/components/task/prompt-history-panel-content.tsx` and its row
  component), whose observable behavior this plugin must match.
- **Host prerequisites:** the capability-gated `host.conversation` browser
  facade, task-panel context, scoped navigation, and host-owned display
  dependencies defined by
  [the Host prerequisites requirements](prompt-history-extraction-host.md).

## Requirements

### REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-001: Production Plugin Package

**Intent:** Ship Prompt History as an official, installable plugin with a
declared identity and least-privilege manifest.

#### Acceptance criteria

- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-001.1:** When the package is installed on
  a Kandev host at or above the declared `min_kandev_version`, the host shall
  activate the plugin with id `kandev-plugin-prompt-history`, author `kandev`,
  and `repo_url` pointing at `https://github.com/kdlbs/kandev-plugin-prompt-history`.
  The manifest `id`, the `go.mod` module, the Makefile `BIN` and its
  derived `PKG_OUT`, and the UI registration id shall all use that same
  identity, and the Makefile `VERSION` shall match the manifest
  `version`; the staged runtime executables keep the platform names
  (`server/plugin-<goos>-<goarch>`).
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-001.2:** The manifest shall declare
  `api_version: 2`, `capabilities.api_read: ["messages"]`, a `runtime` block
  covering all five supported platform executables, and `ui.bundle` pointing
  at the plugin UI module. The `min_kandev_version` shall be the first
  release carrying the browser conversation facade (PR #3588), which is at
  least the `messages` capability audit floor (0.91.1); as of this writing
  no release carries the facade, so the manifest shall declare the first
  stable release cut after the PR #3588 merge (0.95.0 at writing time;
  confirm at release cut).
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-001.3:** The manifest shall declare no
  webhooks, actions, `config_schema`, `ui.pages`, `ui.keybindings`,
  `web_apps`, repository providers, reference sources, agent tools, or
  `events`/`state`/`user_state`/`secrets`/`agent_invoke`/`auth`/`api_write`
  capabilities (the manifest declares `capabilities.api_read: ["messages"]`
  and nothing else). The plugin shall exercise only the capabilities it
  declares.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-001.4:** When the operator disables or
  uninstalls the plugin, the host shall remove the panel registration without
  error; re-enabling the plugin shall restore the registration with no
  operator action.

### REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-002: Prompt History Panel Feature Parity

**Intent:** Present the active session's user prompts with behavior that matches
the parity reference on desktop and mobile, using only the public Host
contracts.

#### Acceptance criteria

- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.1:** When the plugin is enabled, the
  host shall offer the panel from the desktop add-panel menu and the mobile
  Panels picker with a localized title, and render it as a task panel on
  both presentations (desktop and mobile) and for both session kinds. The
  panel shall be available for managed and passthrough
  sessions, with the panel body matching the parity reference in both; the
  menu-offering delta for passthrough sessions is recorded in the system
  design (it deviates from the menu half of AC-UI-PROMPT-HISTORY-PANEL-001.2
  in docs/specs/ui/requirements/prompt-history-panel.md: the desktop "+"
  menu and the mobile Panels picker offer the panel on passthrough sessions,
  opening an empty panel).
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.2:** The panel shall list
  user-authored prompts of the panel's session newest-first, 20 prompts per
  page (matching the parity reference and the host facade default), and
  shall not list agent-authored messages. Each row whose prompt index is
  present shall display the absolute 1-based `#N` ordinal; rows without a
  prompt index shall display no ordinal. Rows whose prompt was sent by an
  agent shall display the agent-sent indicator.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.3:** Each row shall render the prompt
  text with custom-prompt alias rendering, truncate overflowing text, and
  expose a distinct expand control; the expanded view shall wrap text inside a
  box capped at 40% of the panel height with its own scroll.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.4:** Each row shall show the prompt
  send time through the host's locale-aware relative time formatting. When
  the prompt has a duration bound (turn completion or the next prompt's send
  time) and turns are hydrated, the row shall show the agent-work duration
  bounded by the earlier of turn completion and the next prompt's send time,
  floored to whole seconds and clamped at zero; rows without a bound, and
  all rows before turns hydrate, shall show no duration.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.5:** Prompts whose host favorite state
  is set shall be visually distinguished from non-favorited rows. The plugin
  shall read favorite state through the Host read-only capability only.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.6:** When the user scrolls the panel
  to the oldest rendered prompt, the panel shall load the
  next older page automatically with a visible loading indicator, without an
  explicit load-more button. In-flight older-page requests for the same
  continuation shall be joined rather than duplicated (the Host facade's
  join; the core's cross-surface chat join is a store-level guarantee a
  plugin cannot observe), and exhausted history shall stop rendering the
  loading state.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.7:** Live additions, updates, and
  deletions of prompts and turn completions shall be reflected in the panel
  without reload; a completed turn shall update the affected row's duration.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.8:** Selecting a prompt shall navigate
  to it in the transcript through the scoped navigation capability. When the
  capability reports an unavailable target, the panel shall not enter an error
  state.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.9:** The panel shall render the
  parity reference's initial loading, empty, fetch-failure with retry, and
  passthrough degraded states with equivalent observable behavior. The
  `removed` state is the Host facade's terminal state, not a
  parity-reference state (the core panel unmounts with the task): when the
  active session is removed, committed rows shall remain visible and both
  further pagination and further live reconciliation shall stop. The plugin
  additionally marks the empty state with `role="status"`
  (an accessibility-only addition; the core's empty and passthrough
  states are plain divs).
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-002.10:** All plugin user-facing copy
  shall resolve through the plugin translation catalog with an English
  fallback, and shall include catalogs for every supported locale plus the
  pseudo locale. No copy shall be hardcoded.

### REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003: Parity Proof and Core Preservation

**Intent:** Prove that the production package delivers the parity behavior
before the package is considered complete, without changing core ownership.

#### Acceptance criteria

- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.1:** When the packaged production
  artifact is installed on a disposable Kandev development instance, the
  plugin panel shall pass parity checks against the parity reference
  covering prompt ordering, ordinals, alias rendering, durations, favorite
  distinction, agent-sent indicator, older-page auto-loading, live, error,
  and passthrough states, desktop and mobile placement, and the computed
  styles of the favorite highlight and the 40% expanded-box cap.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.2:** The package shall leave the core
  Prompt History panel registered and behaviorally unchanged, and shall leave
  the test-only fixture plugin and its E2E specs unchanged.
- **AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.3:** The production archive shall
  contain `manifest.yaml`, the UI bundle, the declared executables for all
  five platforms, and the generated internal checksum file; the archive shall
  pass the repository's package verification.

## Out of scope

- Saved-panel-identifier migration and removal of the core Prompt History
  panel; both remain later monorepo packages after this package proves parity
  (per the Step 2 ordering in
  [issue #3567](https://github.com/kdlbs/kandev/issues/3567)).
- Marketplace publication: release tagging and the `plugin-registry/plugins.yaml`
  catalog entry are external steps performed when requested.
- A permanent monorepo E2E regression for the production package; the parity
  proof is one-shot against a disposable instance in this package.
- New Host capabilities, SDK contract changes, or backend conversation routes;
  the plugin consumes the contracts from the
  [Host prerequisites package](prompt-history-extraction-host.md) as-is.
