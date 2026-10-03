# Prompt History settings

The manifest's `config_schema` provides nine operator settings, rendered at **Settings > Plugins > Prompt History** and stored by the host. Defaults reproduce the original panel appearance. The [screenshot gallery](screenshots.md) shows combinations.

| Topic | Setting | Options | Default |
|---|---|---|---|
| Numbers | Show prompt numbers | on/off | on |
| Numbers | Style | `inline` / `pill` | `inline` |
| Time | Show send time | on/off | on |
| Time | Send time format | `relative` / `absolute` | `relative` |
| Time | Show duration | on/off | on |
| Agent prompts | Style | `default` / `soft grey` | `default` |
| Agent prompts | Display | `default` / `hide` / `collapse` | `default` |
| Agent stacks | Minimum prompts to stack | `2` / `3` / `4` / `5` | `2` |
| Agent stacks | Expand on | `hover` / `click` | `hover` |

![The Settings > Plugins > Prompt History form: the nine settings listed by topic — Numbers, Time, Agent prompts, Agent stacks — each label starting with its topic](assets/prompt-history-settings-grouped.png)

## Numbers

- **`inline`** puts the `#N` ordinal in front of the prompt text. **`pill`** lifts it onto the bubble's top-left corner in the same small pill the agent stack uses for its count. The accessible row label (`Prompt N`) is unchanged.

  ![Prompt numbers as pills on the top-left corner of each bubble, with the agent stack's +2 count on its top-right corner](assets/prompt-history-numbers-pill-light.png)

## Time

- The row shows one time format and hovers the other. Relative time is compact (`5m`); its hover is the absolute locale-formatted date. Absolute display uses a short date and time (`1/1/26, 12:30 AM` in `en`) and hovers the relative phrase.
- With send time and duration both off, no meta column is rendered; the prompt bubble uses the full row width.

## Agent prompts

Style and display are independent.

- **Style** colours prompts sent by another task's agent: `default` uses the normal bubble; `soft grey` repaints it. The favorite highlight still wins, and the robot glyph marks agent prompts either way.
- **Display** lists one row each (`default`), hides them without renumbering or changing pagination (`hide`), or folds runs into stacks (`collapse`).

  ![A folded stack in soft grey](assets/prompt-history-agent-stack-folded-softgrey-light.png)

## Agent stacks

These settings only apply when agent prompt display is `collapse`. They remain listed because the host's settings form cannot conditionally hide fields.

- **`collapse`** folds each consecutive run of agent prompts into one stacked card: the newest prompt appears in front, with offset cards behind and a `+n` count. Activating the card unfolds the ordinary prompt rows; their ordinals, robot glyphs, long-text controls, transcript navigation, and favorite highlights remain. Folding never renumbers prompts or changes pagination.

  ![A folded run of three agent prompts](assets/prompt-history-agent-stack-folded-light.png)

- **Minimum prompts to stack** sets the run length threshold, from 2 to 5 (default 2). Shorter runs stay separate.
- **Expand on** chooses `hover` (default) or `click`. Hover mode unfolds on pointer hover, keyboard focus, or press, and folds when pointer/focus leaves. Click mode unfolds only on click or Enter/Space and stays as left.

  ![An unfolded run with a count header above its prompt rows](assets/prompt-history-agent-stack-expanded-light.png)

- Folding a tall run restores the view to the stack's prior position when scrolling down through it; scrolling up past the run is left alone. In hover mode, the stack does not reopen until the pointer moves after hand-back.

## Configuration behavior

All six selectors are required, removing the host form's “Not set” choice; absent or unknown values use defaults. The panel reads config once per mount through the host's scoped `GET /api/plugins/<id>/config` (`ui/src/panel-config.ts`) and never writes it. Failed or unauthorized reads keep defaults without surfacing an error; saved changes apply on the next panel mount (session/task switch or reload).

The keys carry their form position (`display_1_show_numbers` … `display_8_agent_stack_expand`) because the host sorts schema keys and does not preserve manifest property order.
