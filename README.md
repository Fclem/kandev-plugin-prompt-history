# Prompt History — a kandev plugin

[![CI](https://github.com/Fclem/kandev-plugin-prompt-history/actions/workflows/ci.yml/badge.svg)](https://github.com/Fclem/kandev-plugin-prompt-history/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Fclem/kandev-plugin-prompt-history)](https://github.com/Fclem/kandev-plugin-prompt-history/releases/latest)

A [kandev](https://github.com/kdlbs/kandev) native-UI plugin that adds a
**Prompt History** task panel: every prompt you sent in the active session, newest
first, in a scrollable list you can read at a glance and jump back into.

![The Prompt History panel](docs/assets/prompt-history-panel.png)

## What the panel does

- **Every prompt, numbered.** Each row shows its ordinal and prompt text.
- **Send age and agent work time.** The right column shows when the prompt was sent and how long the agent worked on it.
- **Long prompts read in place.** Overflowing text expands in a scrollable box.
- **Favorites stand out.** Starred prompts carry the transcript highlight.
- **Agent-sent prompts are marked.** A robot glyph identifies prompts sent by another task's agent.
- **Click through to the transcript.** Clicking a row navigates to that prompt.
- **Older prompts load as you scroll.** Pagination stops at your first prompt.
- **Stays in sync.** Live messages, deletions and favorites update the list.
- **Desktop and phone.** Available in the desktop add-panel menu and mobile Panels picker.
- **Localized.** `en`, `pt-pt`, `zh-cn`, `zh-hk`, `zh-tw`, and `pseudo` QA locale.

## Settings

Nine host-managed settings control prompt numbers, time display, agent prompt styling and visibility, and agent stack behavior. Defaults preserve the original panel appearance. See the [settings guide](docs/settings.md) for options, behavior, and configuration details.

## Install

kandev **0.95.0 or newer**, with the `plugins` feature enabled.

1. **Settings > Plugins**, then install **Prompt History** from the marketplace — or upload/point at the release package (`kandev-plugin-prompt-history-1.4.1.tar.gz`).
2. Open a task's panel menu and pick **Prompt History**.

To install against a running instance from the command line, see
[packaging and releases](docs/packaging-and-releases.md).

## How it works

It is a *native-UI plugin*: a browser-side panel registered through kandev's
public plugin contracts, plus a no-op Go backend that exists only for the
go-plugin handshake. No host patches, no private stores, no duplicated
transport.

- **Least privilege.** The manifest declares only `capabilities.api_read: ["messages"]`; the panel reads the active session's conversation through `host.conversation` and the plugin-scoped config endpoint described in [Settings](docs/settings.md). No events, state, secrets, or write access.
- **No-op backend.** `server/` embeds `pluginsdk.UnimplementedPlugin` and overrides no RPCs.
- **Parity by construction.** Rows mirror the shipped core panel's bubble styling, glyphs, time ladder, and pointer-dependent row heights.
- **Self-sufficient styling.** `ui/plugin.css` owns every `ph-plugin-*` class and uses host theme tokens.

Full design contract:
[docs/specs/plugins/system-design/prompt-history-plugin.md](docs/specs/plugins/system-design/prompt-history-plugin.md).

## Documentation

| | |
|---|---|
| [Settings](docs/settings.md) | options and behavior |
| [Development](docs/development.md) | layout, SDK sibling-checkout setup, build and test targets |
| [Packaging, install, and releases](docs/packaging-and-releases.md) | packaging, host-version floor, release workflow |
| [System design](docs/specs/plugins/system-design/prompt-history-plugin.md) | panel contracts and parity rules |
| [Plan](docs/plans/prompt-history-plugin/plan.md) | how the plugin was planned and built |
| [Changelog](CHANGELOG.md) | release history |
| [Screenshot gallery](docs/screenshots.md) | panel styles for settings combinations |

## Provenance

The plugin was entirely designed and written by a local Qwen 3.8 27B IQ3 XXS
model, derived from an existing internal implementation rather than implemented
from scratch.

## License

MIT — see [LICENSE](LICENSE).
