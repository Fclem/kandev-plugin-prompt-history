---
status: draft
system: plugins
requirements:
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-001
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-002
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003
---
# Prompt History Plugin System Design

## Purpose and boundaries

This design covers the production Prompt History plugin: the package in
`kdlbs/kandev-plugin-prompt-history` and the one-shot parity proof against a
disposable development instance. The plugin owns presentation and derivation
only. Conversation access, authorization, sanitization, pagination
transport, live reconciliation, lifecycle fencing, and transcript navigation
belong to the Host and are owned by
[the Host prerequisites system design](prompt-history-extraction-host.md);
this design consumes those contracts and does not restate them. The core
Prompt History panel remains the parity reference; its behavior is owned by
the UI system and is not modified here.

## Requirement mapping

| Requirement | Design section |
| --- | --- |
| `REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-001` | [Package and identity](#package-and-identity) |
| `REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-002` | [UI bundle architecture](#ui-bundle-architecture), [Data and contracts](#data-and-contracts), [Control flow](#control-flow), [Failure and recovery](#failure-and-recovery) |
| `REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003` | [Parity proof](#parity-proof), [Verification](#verification) |

## Package and identity

The repository is created from `kdlbs/kandev-plugin-template` and keeps the
template's packaging, test, and release safeguards. Identity is synchronized
across the manifest `id`, the `go.mod` module, the Makefile `BIN` and its
derived `PKG_OUT`, and the `window.registerKandevPlugin` id:
`kandev-plugin-prompt-history`; the Makefile `VERSION` matches the manifest
`version`.

Manifest fields, per the [manifest reference](../../../public/plugins-manifest.md):

- `id: "kandev-plugin-prompt-history"`, `api_version: 2`,
  `version: "0.1.0"`, `display_name: "Prompt History"`, a one-line
  `description`, `author: "kandev"`, `categories: ["tools"]`, and
  `repo_url: "https://github.com/kdlbs/kandev-plugin-prompt-history"`.
- `min_kandev_version` — the first release carrying the browser
  conversation facade (PR #3588). `0.91.1` is only the `messages`
  capability audit floor (`MinimumMessagesCapabilityVersion`); as of this
  writing no release carries the facade (latest release 0.94.0, 2026-09-09;
  #3588 merged 2026-09-15), so the manifest declares the first stable
  release cut after the merge (0.95.0 at writing time; confirm at release
  cut).
- `runtime.type: binary` with all five platform executables under `server/`.
  The installer requires a managed runtime even for a UI-focused plugin; the
  executable is a no-op `pluginsdk.UnimplementedPlugin` server (the Host
  prerequisites requirements
  [AC-PLUGINS-PROMPT-HISTORY-HOST-002.8](../requirements/prompt-history-extraction-host.md#req-plugins-prompt-history-host-002-browser-conversation-host-boundary)
  confirm the browser facade needs no plugin backend).
- `capabilities: { api_read: ["messages"] }` and only that capability.
- `ui: { bundle: "/ui/bundle.js", styles: ["/ui/plugin.css"] }`. No
  `ui.pages`, `ui.keybindings`, webhooks, actions, `config_schema`, or
  provider declarations.
- Packaging stages only `manifest.yaml`, the built `ui/bundle.js` and
  `ui/plugin.css`, and the five `server/plugin-<goos>-<goarch>` executables
  (mirroring `kandev-plugin-voice`'s `stage_common`); the `ui/` source tree,
  `ui/package.json`, and `ui/node_modules` are never staged, and the
  plugin's `verify-package` additionally asserts their absence from the
  archive.
- The template's CI checkout `ref:` pins a pre-facade commit (`f218880e`);
  the `go.mod` `replace` and `KANDEV_SDK` are plain paths with no ref. The
  repository bumps the CI `ref:` to the PR #3588 merge commit (`2b1d0cf7d`)
  or later and requires its sibling worktree to be at or after that commit,
  so the pinned `@kandev/plugin-sdk` carries the conversation types. The UI
  sources obtain the SDK types from a
  `file:../../kdlbs-kandev/apps/packages/plugin-sdk` dependency in
  `ui/package.json`; `ui/src/host.ts` re-exports those types rather than
  restating them, so `tsc --noEmit` typechecks against the pinned SDK.

## UI bundle architecture

The bundle follows the official-plugin toolchain used by
`kdlbs/kandev-plugin-voice`: TypeScript sources under `ui/src/` compiled by
`ui/build.mjs` (esbuild) into the single ES module `ui/bundle.js`, with
collocated vitest tests against a `test-host` mock. No React is bundled; the
build aliases `react` and `react/jsx-runtime` to a host-delegating shim.

Module layout:

- `ui/src/index.tsx` — `window.registerKandevPlugin` entry;
  `initialize(registry, host)` calls `setHost(host)` before registering
  the task panel and translations, and `destroy()` calls `clearHost()` so
  a same-tab disable/enable cycle starts clean (AC-001.4); the
  registrations are repeatable across enable/disable cycles. It also pins
  the plugin's own host-injected stylesheet: the host injects `ui.styles`
  as `link[rel=stylesheet][data-plugin-id=<id>]` carrying the bare
  manifest path, while the bundle URL it loads *is* versioned (`?v=`), so
  the stylesheet URL stayed identical across releases and the browser kept
  serving the previous release's CSS against the new markup — an updated
  plugin rendered the old bubble colour and left the new SVG glyphs
  unsized (Chromium: >1300 px, the reported "giant icons").
  `initialize` re-points each of this plugin's links at `?v=<manifest
  version>`, inlined by `ui/build.mjs` as `__PLUGIN_VERSION__`; an
  already-versioned href and other plugins' links are left untouched, and
  the re-point is a no-op when the version is absent (a direct
  `src/index.tsx` import under vitest).
- `ui/src/panel.tsx` — the `PromptHistoryPanel` component, registered with
  panel key `prompt-history` (layout id
  `plugin:kandev-plugin-prompt-history:prompt-history`), a `titleKey`
  resolved by the host through the plugin's translation namespace
  (`resolveTaskPanelTitle` falls back to `title`), a bundled icon component
  (registration `icon` accepts a plugin-owned component; no curated history
  glyph exists, so a string name would fall back to the puzzle glyph),
  `mobileEnabled: true` (the mobile Panels picker and bottom nav filter on
  it), and no `visible` predicate. The host's `registrationIsVisible`
  gates both the
  menu entry and the panel body, so declaring one (mirroring the core
  `!isPassthrough` guard) would satisfy the menu half of
  AC-UI-PROMPT-HISTORY-PANEL-001.2 in
  docs/specs/ui/requirements/prompt-history-panel.md but replace the panel
  body with the host's `PluginTaskPanelUnavailable` placeholder, breaking
  the layout-restore half and the passthrough state; omitting it is forced
  by that single predicate and keeps the passthrough state reachable, at
  the accepted cost that the desktop "+" menu and the mobile Panels picker
  offer the panel on passthrough sessions, opening an empty panel. Renders
  rows (including the agent-sent indicator as an inline SVG glyph, since
  `host.ui` exposes no icon primitive — every row glyph is rendered with
  intrinsic `width`/`height` attributes (12 px clock/hourglass, 14 px
  robot and chevrons) mirroring the reference's `h-3 w-3` / `h-3.5 w-3.5` /
  `size={14}`: an inline `<svg>` with a `viewBox` and no intrinsic size
  sizes itself to its container, so a stale or missing `plugin.css` — a
  reachable state, see the stylesheet version pinning above — rendered the
  glyphs at panel width instead of at icon size. `ui/plugin.css` still
  wins over the attributes and remains the styling source of truth),
  loading, empty, error, passthrough,
  and removed states; owns expansion state keyed by message id. State
  determination and `openMessage` outcome handling delegate to the
  pure `ui/src/panel-state.ts` seam. Test ids use
  a `ph-plugin-` prefix distinct from the core panel's ids. Accessibility
  mirrors the parity reference where it exists:
  `role="status" aria-live="polite"` on the loading indicator (the core
  renders it on every loading render), the row bubble's 44 px mobile
  minimum with its desktop release (the core's `min-h-11 md:min-h-0`)
  and a focusable full-row navigate `<button>` (the core's `min-h-11`),
  both supplied by `ui/plugin.css`, and `aria-describedby` on the navigate
  `<button>` pointing at an `sr-only` span that holds the row's prompt
  content, so the button keeps the row label as its name and gains the
  prompt itself as its description (deliberate a11y delta: the core puts
  the row label in that element and describes its bubble, expand, and
  navigate controls with it), and a real
  `<button>` expand control with `aria-expanded`, a catalog `aria-label`,
  and the three-context size matrix (desktop/tablet+fine pointer 24x24
  px, desktop/tablet+coarse pointer and phone-width+fine pointer each at
  least 44x44 px) matching the parity reference's two nominal sizes (24
  px and 44 px); phone-width+fine-pointer sizing is a control-sizing/
  mobile accessibility delta from the core's pointer-only implementation
  (the parity spec's role-based queries and 44 px tap-target
  assertions depend on these). The matrix itself lives only in
  `ui/plugin.css`: the parity spec's mobile run asserts the 44 px branch
  through `boundingBox()`, and the 24 px fine-pointer branch has no
  automated assertion. Deliberate delta: the plugin also puts
  `role="status"` on the empty state; the core's empty and passthrough
  states are plain divs with no role.
- `ui/plugin.css` — the plugin-owned stylesheet, declared as
  `ui.styles: ["/ui/plugin.css"]` in the manifest. The bundle is built in a
  separate repository and imported at runtime from
  `/api/plugins/{id}/bundle`, so the host's build never sees it and
  no utility in the host's Tailwind sources applies to it; the stylesheet
  therefore owns every `ph-plugin-*` class it renders (the host's `@source`
  globs in `apps/web/app/globals.css` cover only
  `apps/web/components/**` and `apps/packages/ui/src/**`). The row bubble is
  the one exception by design: it also carries the host's global
  `markdown-body` and `markdown-body-user` classes, which the host always
  loads, so prompt text renders exactly as it does in the transcript. It uses
  namespaced class names and kandev CSS
  custom properties for theme fidelity, mirroring `kandev-plugin-voice`
  (`ui/plugin.css` + `ui.styles`). Because the host injects this file
  without a cache key, `initialize` re-points it at the running bundle's
  version (see `ui/src/index.tsx` above) and the row glyphs carry
  intrinsic sizes (see `ui/src/panel.tsx` above) so neither a stale nor a
  missing stylesheet can render the earlier release's colours or
  container-wide icons. Row height follows the pointer: the
  compact desktop row (`min-height: 0`) is scoped to
  `(min-width: 768px) and (pointer: fine)`, so a coarse-pointer desktop or
  tablet keeps the 44 px row and the 44 px expand control is not clipped by
  the bubble's `overflow: hidden` (measured in Chromium at 1024 px: a 33 px
  bubble left the top and bottom of the nominal 44 px target unhittable).
- `ui/src/derive.ts` — pure entry derivation from the Host DTOs: `#N`
  ordinal from `promptIndex`, agent-sent flag from `senderTaskId`, and
  duration bounded by the earlier of turn completion and the
  chronologically next (newer) prompt's send time - the preceding element
  of the facade's newest-first array, not `index + 1` (floored to seconds,
  clamped at zero). Ordering is the
  facade's page order (older pages append; live updates arrive already
  ordered by the host); derive does not re-sort. Mirrors
  `buildPromptHistoryEntries` in
  `apps/web/lib/prompt-history.ts` so parity assertions compare the same
  arithmetic, including the fraction-preserving nanosecond timestamp parse
  (not `Date.parse`/millisecond truncation), and provides the
  plugin-local `formatPromptDuration` mirror
  (`h m s` unit labels from the translation catalog) matching
  `apps/web/lib/prompt-history.ts` `formatPromptDuration`. The vitest suite
  includes a case with two identical `createdAt` values whose ids are
  seeded so ascending-id order contradicts the facade page order, to pin
  that derive preserves page order rather than sorting by timestamp, and a
  case with microsecond `createdAt`/`completedAt` values straddling a
  second boundary, to pin the fraction-preserving parse.
- `ui/src/panel-state.ts` — pure panel state determination and
  `openMessage` outcome handling, consumed by `panel.tsx` and tested
  against `test-host`: the states rendered above (initial loading,
  empty, error with retry only when no rows are committed,
  `loadingMore` while `hasMore`, passthrough, and `removed` - rows stay,
  pagination and live updates stopped -) and the `unavailable`
  outcome consumed without error surfacing. The vitest suite now includes
  permanent rendered component tests that import `panel.tsx` directly
  from source (not the built bundle), with `react`, `react-dom`,
  `@types/react`, `@types/react-dom`, and `@testing-library/react`
  as dev dependencies and `test-host` installed
  with the same real React instance (Vitest does not apply the production
  `react` alias; `panel.tsx` and the renderer resolve the installed
  `react` package, and `test-host` passes that same module to `setHost`;
  only the esbuild production build aliases `react`/`react-jsx-runtime`
  to `react-shim.ts`) plus controlled
  ResizeObserver/IntersectionObserver; the suite covers
  initial load, retry/recovery, in-flight pagination suppression,
  loading grace, expansion/40% cap, favorites/live updates, and terminal
  removal, plus indicator placement (non-scrollable content renders the
  indicator in flow, scrollable content renders it as the floating
  indicator) and older-page appends while the sentinel is active preserving
  bottom anchoring;
  `panel.tsx` is also rendered by the
  throwaway parity spec for cross-repository production-artifact parity, and
  `ui/src/bundle.test.ts` smoke-mounts the built `ui/bundle.js` (built by the
  suite's global setup) through its host-global registration and
  `initialize`, so the esbuild React aliases and the registration payload are
  covered as the host consumes them rather than only through `src/` imports.
- `ui/src/strings.ts` — translation catalogs (en plus every supported locale
  and the pseudo locale), registered through
  `registry.registerTranslations`. Catalog shape is pinned: flat keys
  matching `^[a-z][a-zA-Z0-9_-]*$` (no dots or nesting), exactly the
  supported locale set (`en` is the only catalog the host requires;
  AC-002.10 requires all six), at most 1000 messages per locale and 4096
  characters
  per message; a violation throws at `initialize` and aborts every
  registration. Except for the panel title, every value matches the pinned
  core `task.json` catalogs character-for-character in all six locales. The
  title is a recorded delta: `panelTitle` reads `"Prompt History"` (canonical
  capitalisation, matching the core layout constant that names the saved
  panel), where the core's localized `task:promptHistory` copy reads
  `"Prompt history"`, and the plugin's pseudo title uses different glyphs for
  `h`/`i` than the host's pseudo generator emits. The title is display-only
  (the panel's layout identity is its `plugin:<id>:prompt-history` key), so
  the difference shows only as casing in the desktop "+" menu and the mobile
  Panels picker.
- `ui/src/host.ts` — re-exports the `@kandev/plugin-sdk` types (the
  `file:../../kdlbs-kandev/apps/packages/plugin-sdk` dependency in
  `ui/package.json`) instead of restating the contract, so
  `tsc --noEmit` typechecks the panel against the pinned SDK, and,
  mirroring `kdlbs/kandev-plugin-voice`, owns the module-scoped host
  handle (`host()`, `maybeHost()`, `hostReact()`) that
  `ui/src/react-shim.ts` and the panel import, and its write side
  (`setHost(host)`, `clearHost()`) that `ui/src/index.tsx` calls from
  `initialize` and `destroy`.
- `ui/src/react-shim.ts` — the host-delegating shim that `ui/build.mjs`
  aliases `react` and `react/jsx-runtime` to (mirroring
  `kdlbs/kandev-plugin-voice`): every `react` import in the bundle
  resolves through a lazy `hostReact()` lookup, so kandev owns the
  single React instance and the bundle carries no React of its own.
- `ui/src/test-host.ts` — Host mock for the vitest suite: fake
  `useSessionMessages`/`useSessionTurns` state machines, `openMessage`
  outcomes, `host.ui.PromptMentionText`, and `host.utils.formatRelativeTime`.
  The messages hook applies the query's observable shaping rather than handing
  back the store unchanged: the session scope, the task scope (an omitted
  `taskId` falls back to the panel's task, as the facade's `resolveTaskId`
  does), `authorTypes`, `sort` and `pageSize`. A query that names another
  session or task therefore drops those rows in the suite exactly as the
  facade's scoped request would. Favorites are stored and queried per session,
  matching the facade's `bySession[sessionId][messageId]` lookup, and the
  relative-time formatter derives its answer from the value it is given, so
  the panel's arguments are observable rather than assumed.

## Data and contracts

The panel component receives `PluginTaskPanelProps`
(`taskId`, `sessionId`, `sessionKind`, `presentation`, `panelId`,
`conversation`) and consumes only:

- `conversation.history.useSessionMessages({ sessionId, taskId,
  authorTypes: ["user"], sort: "desc", pageSize: 20 })` — `pageSize: 20`
  passed explicitly, matching the parity reference
  (`OLDER_PROMPT_PAGE_LIMIT = 20` in `apps/web/hooks/use-lazy-load-prompts.ts`,
  `limit: 20` in `apps/web/hooks/domains/session/use-session-prompts.ts`);
  the host facade's `query.pageSize ?? 20` default is a cross-check, not the
  dependency.
  State: `messages`, `loading`, `hydrated`, `loadingMore`, `error`, `hasMore`,
  `removed`, `loadMore()`, `retry()`.
- `conversation.history.useSessionTurns(sessionId, taskId)` — turn
  `startedAt`/`completedAt` for duration derivation, with state `loading`,
  `hydrated`, `error`, `removed`, `retry`. Durations render only after turns
  hydrate; until then rows show no duration, mirroring the core
  `turnsHydrated` gate.
- `conversation.history.useMessageFavorite(sessionId, messageId)` — read-only
  favorite state per row.
- `conversation.openMessage(messageId)` — transcript navigation; the
  `{ status: "accepted" | "unavailable" }` outcome is consumed without error
  surfacing for `unavailable`.
- `host.ui.PromptMentionText` — custom-prompt alias rendering and preview.
- `host.utils.formatRelativeTime` — locale-aware send-time rendering.
  Intentional parity delta: the core row uses the catalog-backed compact
  ladder (`formatRelativeCompact`, e.g. "5m"); plugins must use the host
  `formatRelativeTime` (full Intl phrase, e.g. "5 minutes ago") so timestamps
  follow the user's locale. Accepted delta: the core row's absolute-time
  `title` tooltip (`formatDateTime`) has no `host.utils` counterpart, so the
  plugin omits it.
- `host.i18n.t` / `host.i18n.useTranslation()` — resolution of every
  user-facing string through the plugin-scoped catalog namespace built
  from `ui/src/strings.ts` (the SDK `PluginI18nApi`; the only surface
  that reads the registered catalogs).

DTO fields used: `id`, `turnId`, `createdAt`, `updatedAt`, `promptIndex`,
`senderTaskId`, `content`, `authorType` (messages); `id`, `startedAt`,
`completedAt`, `updatedAt` (turns). No field beyond the sanitized
`PluginConversationMessage`/`PluginConversationTurn` shapes is read.

## Control flow

1. The Host mounts the panel for the active task/session/presentation and
   hands the component generation-scoped props.
2. The panel calls the two conversation hooks; the Host facade owns
   snapshot/subscription ordering, deterministic cursors, live
   reconciliation, reconnects, and generation fencing — the panel never
   touches WebSocket frames.
3. `derive.ts` maps DTOs to rows on every state change; React re-renders rows
   keyed by message id. Expansion state survives row reordering because it is
   keyed by message id, not row index.
4. Row selection calls `conversation.openMessage(messageId)`; the Host
   validates the target and drives the native desktop or mobile navigation
   owner.
5. Unmount, session switch, or plugin generation change aborts the panel's
   work through the Host facade; the panel holds no module-level conversation
   state of its own.

## Pagination and reveal

The panel mirrors the core's pagination and reveal behavior:

- Paging stops when the first prompt (`#1`) is rendered: the older-page
  trigger is active only while `hasMore` and no rendered entry has
  `promptNumber === 1`.
- A minimum 400 ms loading-indicator display window keeps back-to-back
  auto-loads readable as one indicator.
- The loading indicator floats or renders in-flow based on measured
  scrollability, and the view sticks to the bottom while older pages load. Its
  minimum-display grace bridges a settled page into the next chained one, so a
  rejected page - which leaves no request in flight and no re-armed successor -
  suppresses it: the error status is reported instead of a loading claim.
- The sentinel uses `rootMargin: "0px 0px 200px 0px"`; the Host facade joins
  concurrent older-page loads for the same continuation, and the panel's
  sentinel must not re-issue a load already in flight. (The core's
  cross-surface join with the chat surface is a store-level guarantee the
  plugin cannot observe.)

## Failure and recovery

- The messages hook's `error` renders the retry surface only when no rows
  are committed (mirroring the core `fetchFailed && entries.length === 0`
  condition) and only when the error is retryable: the facade's `retry()`
  returns early unless `error.retryable` (`unauthenticated` and
  `invalid_query` are explicitly not), so a non-retryable failure renders its
  status without a control that could not do anything. With committed rows,
  the rows render without a retry affordance. `retry()` re-runs the Host
  facade's recovery. The turns hook's `error` is not surfaced.
- A *continuation* failure is not terminal: the pinned facade keeps the
  committed rows, the continuation cursor and `hasMore`, stores a retryable
  `error`, and leaves `loadMore` usable (its guard is scope, `removed`,
  `hasMore` and the cursor; the loader's early `throw` is the query-level
  `taskId` error, not this one). So with rows on screen the panel recovers by
  retrying the continuation through a user gesture or an observed sentinel
  exit and re-entry (which clears the disarm), and the facade clears `error`
  on the successful page. The post-commit geometry recheck does not recover
  it: a rejected page sets the disarm, and `recheck()` bails while disarmed.
  Only the zero-rows case needs the visible retry surface.
- `removed` is the Host facade's terminal state, not a parity-reference
  state: the core panel unmounts with the task, so the plugin's "rows stay
  visible, `hasMore` false" behavior is the accepted delta. On `removed`,
  pagination and live updates stop and committed rows remain visible.
- `loading` renders the initial loading state; `loadingMore` renders the
  older-page loading indicator while `hasMore` is true.
- Duration derivation uses whichever bound exists (turn completion or the
  next prompt's send time); a row with no bound shows no duration, matching
  the core `durationSeconds === null` branch.

## Persistence

The plugin owns no durable state. Favorites, custom-prompt aliases, and
conversation rows are host-owned; the no-op backend executable stores
nothing. Uninstall removes the panel registration and the Host-managed
plugin record; no plugin data directory is written.

## Security

- Least privilege: only `api_read: ["messages"]` is declared; the server-side
  capability gate on `/api/plugins/{id}/conversation/...` enforces it.
- Same-origin native plugin: the bundle runs in the Kandev origin with Host
  store access; it does not read `host.store`, import `apps/web` modules, or
  call unscoped `/api/v1` routes.
- No secrets, webhooks, or inbound routes. No operator settings.

## Parity proof

The one-shot proof (per
[REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003](../requirements/prompt-history-plugin.md))
runs against a disposable development instance:

1. `make package` in the plugin repo produces
   `kandev-plugin-prompt-history-0.1.0.tar.gz`; `make verify-package`
   checks contents (including `ui/plugin.css`), checksums, and leak-free
   staging, so the installed five-platform artifact is the artifact
   verified for AC-003.3 (`package-host` writes the same `PKG_OUT`
   filename, so it must not replace the verified archive).
2. The monorepo e2e test-base backend and Playwright harness are used as
   the disposable instance and driver. A throwaway spec (not committed to
   the monorepo) reuses the `openInstallDialog(page)` and
   `uploadPackage(page, filePath)` exports in
   `apps/web/e2e/tests/plugins/plugin-test-helpers.ts` verbatim (only
   `uploadPackage` is path-parameterized), inlining only the plugin id,
   the tarball path, and the readiness assertion (the
   shared `installFixturePlugin`/`uninstallFixturePlugin` helpers hardcode
   the fixture's `kandev-plugin-e2e` id and package), and drives the same
   behavioral
   checks as `apps/web/e2e/tests/plugins/prompt-history-plugin.spec.ts` and
   `mobile-prompt-history-plugin.spec.ts` for the ordering, live, and
   navigation assertions, plus the passthrough degraded state (reachable in
   the plugin only because the registration declares no `visible`
   predicate), the initial loading and fetch-failure-with-retry states,
   the terminal removed state (committed rows remain, a sentinel-triggered
   `loadMore` emits no request; post-terminal transport fencing - later
   events do not change rows - is covered by the existing Host unit test
   `apps/web/lib/plugins/conversation-host.test.tsx:638-648`),
   and the computed-style parity checks (favorite highlight background,
   expanded-box cap) plus the loading-indicator placement (in flow when
   not scrollable, floating when scrollable), bottom anchoring on
   older-page appends, and the expand button's `boundingBox()` width and
   height each at least 44 px on the mobile parity run. The older-page
   auto-load check takes its
   oracle from `apps/web/e2e/tests/task/prompt-history-auto-load.spec.ts`
   with the `apps/web/e2e/helpers/prompt-history-long-seed.ts` 121-prompt
   seed: scroll-to-sentinel, no load-more assertion (the production panel
   has no load-more control). The spec addresses the production panel by
   its `ph-plugin-` test ids and layout identity, distinct from the core
   panel's ids.
   Before the runs, copy the already-verified tarball to
   `.tmp/prompt-history-plugin/kandev-plugin-prompt-history-0.1.0.tar.gz`
   (an ignored path under REPO_ROOT; the Docker runner mounts only REPO_ROOT
   at /work, so the sibling path is absent in the container), and point
   both throwaway specs at that path; remove the copy after the run, and do
   not rebuild or replace it with `package-host`.
3. The core panel (including
   `e2e/tests/task/prompt-history-auto-load.spec.ts`) and the fixture plugin
   are exercised alongside to confirm they remain behaviorally unchanged.

## Verification

- Plugin repo: `make ui-install` (installs `ui/node_modules` once, as
  voice's CI does), `make test` (Go tests + vitest suite), `make vet`,
  `test -z "$(gofmt -l .)"` (the template's `make fmt` lists unformatted
  files but exits 0, so it is advisory), `make typecheck`, `make ui`,
  `make package` (cross-platform), `make verify-package` (archive
  contents, checksums, staging leak check, absence of `ui/src`,
  `ui/node_modules`, `ui/package.json`), CI equivalent.
- Parity: the throwaway desktop and mobile Playwright runs from the parity
  proof section, plus the harness build step, which packages the
  plugin-fixture, and the existing core prompt-history E2E specs to
  confirm core preservation.

## Related decisions

- [Browser plugins read session conversations through a typed Host
  facade](../../../decisions/2026-09-06-browser-plugin-conversation-facade.md)
  (proposed; this plugin is the first consumer).
- [ADR 0047: Plugin host conversation reads](../../../decisions/0047-plugin-host-conversation-reads.md)
  — the Go-side reads this plugin does not use.
- [Host prerequisites requirements](../requirements/prompt-history-extraction-host.md)
  and [Host prerequisites system design](prompt-history-extraction-host.md).
