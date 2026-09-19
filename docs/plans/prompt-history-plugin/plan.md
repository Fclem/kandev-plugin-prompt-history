---
created: 2026-09-15
status: draft
requirements:
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-001
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-002
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003
system_design:
  - "../../specs/plugins/system-design/prompt-history-plugin.md"
legacy_specs: []
---

# Implementation Plan: Prompt History Plugin

## Overview

Create `kdlbs/kandev-plugin-prompt-history` from
`kdlbs/kandev-plugin-template`, implement the Prompt History task panel with
feature parity to the shipped core panel, package the production artifact, and
prove parity once against a disposable development instance on desktop and
mobile. The monorepo is not changed: the core panel, the test-only fixture
plugin, and its E2E specs stay untouched. Work orders run in dependency order
01 -> 02 -> 03; they share one repository and one package artifact, so
parallel execution is not appropriate.

## Scope

### In scope

- The `kdlbs/kandev-plugin-prompt-history` repository with the production
  plugin: manifest identity, least-privilege capabilities, no-op Go backend,
  UI bundle with the parity panel, translation catalogs, and packaging.
- One-shot parity proof against a disposable development instance using the
  monorepo e2e harness as the driver (throwaway spec, not committed).
- Package verification: archive contents, checksums, staging leak check, and
  cross-platform executables.

### Out of scope

- Saved-panel-identifier migration and removal of the core Prompt History
  panel (later monorepo packages, per the Step 2 ordering in
  [issue #3567](https://github.com/kdlbs/kandev/issues/3567)).
- Marketplace publication: release tagging and the
  `plugin-registry/plugins.yaml` catalog entry.
- A permanent monorepo E2E regression for the production package.
- Host, SDK, or backend changes; the plugin consumes the Step 1 contracts as
  merged in PR #3588.
- The test-only fixture plugin and its E2E specs remain test support.

## Technical approach

### Checkout layout

The plugin repository is checked out as a sibling of the monorepo worktree
(e.g. `../kandev-plugin-prompt-history`). The template assumes a sibling
directory literally named `kandev` in four places - the `go.mod` `replace`
(`../kandev/apps/backend`), the `KANDEV_SDK` Makefile variable, the root
`package.json` `@kandev/plugin-sdk` `file:` devDependency (the
`ui/package.json` created in Task 02 re-adds it at the renamed path), and
the CI checkout `path: kandev` (four checkout blocks: `ci.yml` verify,
`ci.yml` `base-floor`, `release.yml`, and `build.yml`) - so all are updated
to the worktree's directory name (`kdlbs-kandev`); the CI `ref:` values are
bumped separately (see Task 01). All verification commands below assume
this layout.

### Task 01: Bootstrap repo and installable skeleton

Create the public repository from the template, keeping its packaging,
test, and release safeguards. Rename the identity in the manifest `id`,
the `go.mod` module, the Makefile `BIN` and its derived `PKG_OUT`, and the
`window.registerKandevPlugin` id to `kandev-plugin-prompt-history` (the
Makefile `VERSION` matches the manifest `version`);
`display_name: "Prompt History"`, `author: "kandev"`, `repo_url` to the new
repository. The template's own package-name references are renamed with
the identity: the `release.yml` README sed pattern, the `release.yml`
Extract checksums `tar -xzf` glob, the `release.yml` release-asset glob,
and the `Makefile` `clean` archive glob; the `Makefile`'s "When you
rename the plugin" header comment is dropped rather than renamed.
Replace the template demo
behavior:

- Manifest: `api_version: 2`, `min_kandev_version: "0.95.0"` (the first
  release carrying the #3588 browser conversation facade; confirm at release
  cut), `capabilities: { api_read: ["messages"] }`, `ui.bundle: "/ui/bundle.js"`,
  `ui.styles: ["/ui/plugin.css"]`, a one-line `description`,
  `categories: ["tools"]`, all five platform executables. Remove webhooks,
  actions, `config_schema`, events, `state`, `user_state`, `secrets`,
  `agent_invoke`, `auth`, providers, and agent tools.
- `server/`: no-op `pluginsdk.UnimplementedPlugin` (the browser facade needs
  no backend logic; AC-PLUGINS-PROMPT-HISTORY-HOST-002.8).
- `ui/bundle.js`: minimal registration of a placeholder task panel
  (`registerTaskPanel` with `title`, `titleKey`, `mobileEnabled: true`, a
  bundled icon component, and no `visible` predicate) plus the
  translation-catalog skeleton (en, pt-pt, zh-cn, zh-hk, zh-tw, pseudo) and
  a placeholder `ui/plugin.css` (the real stylesheet lands in Task 02).
- Pinned SDK reference: the template's `go.mod` `replace` and
  `KANDEV_SDK` are plain paths with no ref (the template's root
  `package.json` `file:` devDependency goes away with the recipe slice;
  the SDK `file:` dependency exists only in the `ui/package.json` Task 02
  creates); the `ci.yml` verify, `build.yml`, and `release.yml` SDK
  checkouts pin `f218880e` (the `ci.yml` `base-floor` checkout pins tag
  `v0.86.0`), which predates the facade. Bump every CI `ref:` to the PR
  #3588 merge commit
  (`2b1d0cf7d`) or later, rename every CI checkout `path: kandev` to
  `kdlbs-kandev` (the `ci.yml` verify job, the `ci.yml` `base-floor` job,
  `release.yml`, and `build.yml`), add `apps/packages/plugin-sdk` to
  `build.yml`'s sparse checkout (Task 02's `make ui-install` resolves the
  `file:` dependency against it), and point the `go.mod` `replace` and
  `KANDEV_SDK` at the worktree, so the pinned `@kandev/plugin-sdk` carries
  the conversation types.
- Strip the template's recipe slice (the `recipes/` directory,
  `tsconfig.recipes.json`, the Makefile
  `test-recipes`/`typecheck-recipes`/`audit-recipes` targets and the
  `./recipes/...` paths in `go test` and `go vet`, the root
  `package.json`/`package-lock.json`, and the `make audit-recipes` steps in
  both `ci.yml` and `release.yml`): this is a panel-only plugin with no
  recipes. Also remove the template's root `npm ci --ignore-scripts` and
  `Set up Node` (cache `plugin/package-lock.json`) steps from `ci.yml` and
  `release.yml` (the Go-only skeleton needs no Node; Task 02 re-adds pnpm
  setup plus the `kandev-plugin-voice` UI CI steps to all three
  workflows). After the strip, `make test` is `test-backend` (Go-only);
  Task 02 changes it to `test-backend test-ui`. Keep the `base-floor` CI
  job (it builds the backend against the declared minimum SDK) but point
  its `ref:` at the PR #3588 merge commit (`2b1d0cf7d`) as a stand-in for
  the floor until the floor release is cut, then update it to the floor
  tag; rename the job to match its new ref (the template names it after
  the pinned ref, "Default template on Kandev v0.86.0"), and rewrite the
  sibling-path checkout comment in `ci.yml` (it cites
  `plugin/../kandev/apps/backend`) to `kdlbs-kandev` (`build.yml` and
  `release.yml` carry no such comment).
- README: replace the template's demo-surface documentation (the
  `/template` nav route, host-component page, webhook and `config_schema`
  surfaces) with plugin-specific content - identity, `api_read:
  ["messages"]`, install via Settings > Plugins, the sibling-worktree dev
  layout, and the `make ui-install`/`typecheck`/`test-ui`/`ui`/`package`
  targets - keeping the `kandev-plugin-prompt-history-0.1.0.tar.gz`
  archive name mentioned once so the `release.yml` README sed keeps
  applying. Also remove the source-control recipe pitch (the intro
  pitch paragraph, the `Make it yours` Git-provider opt-in paragraph,
  and the `pluginsdk.ActionHandler`/`EntityReferenceSearcher`/
  `EntityReferenceAuthorizer` example in `How a plugin runs`), the
  `recipes/`+`package.json`+`tsconfig.recipes.json` Layout entries,
  the
  "hand-written, no build step" `ui/bundle.js` paragraph (Task 02's
  esbuild toolchain replaces it), and the recipe-only `npm
  ci --ignore-scripts` install line; rewrite the "Developing against
  the SDK" section (the `replace` snippet and `some-dir/` sibling diagram
  to `kdlbs-kandev` paths, and the frontend paragraph that names the
  recipe and the removed root `package.json`, which after this task has
  the `file:` dependency in `ui/package.json` and `ui/bundle.js` as Task
  02's esbuild build output), restate the "Minimum host version" section
  as the first
  release carrying the browser conversation facade (0.95.0 at writing
  time) and drop its source-control-recipe floor paragraph, update the
  `manifest.yaml`, `bundle.js`, `server/plugin.go`, and
  `server/plugin_test.go` Layout comments (the `manifest.yaml` one cites
  `config_schema`, removed from the manifest; the `bundle.js` one says
  "hand-written, no-build ES module", which Task 02's esbuild output
  replaces; the `plugin.go` one names the new type with no overridden
  RPCs; the `plugin_test.go` one describes the no-op contract test),
  drop the `templatePlugin`/`Serve(&templatePlugin{})` sentence in
  `How a plugin runs`, drop the recharts "needs no bundler" clause
  (Task 02's
  esbuild build is the bundler), rewrite the workflow pin sentence that
  names the recipe ("reproducible provider contracts" and the "rerun
  both contract suites" tail - both recipe suites are gone with the
  recipe strip; the pin sentence ends "rerun the backend and UI suites
  when adopting a newer SDK"), and leave the "Both stage `manifest.yaml`
  + `ui/`" packaging sentence and the "make package" inline comment
  ("packs manifest + ui/ + binaries") to Task 02's `stage_common`
  staging switch - and keep the "Developing against
  the SDK" heading that `go.mod`'s comment cites.

### Task 02: Parity panel implementation

Adopt the official-plugin toolchain from `kdlbs/kandev-plugin-voice`:
TypeScript sources under `ui/src/` built by `ui/build.mjs` (esbuild, no
bundled React, `react` and `react/jsx-runtime` aliased to the
host-delegating `ui/src/react-shim.ts`) into `ui/bundle.js`, with
collocated
vitest tests against a `test-host` mock. The Makefile `test` target
becomes `test-backend test-ui` (for local runs; `ci.yml`'s `Test` step
runs `make test-backend` instead, mirroring `kandev-plugin-voice`'s
`make test-go`, so the UI suite runs exactly once, in its own step after typechecking). CI
gains the `kandev-plugin-voice` UI steps - `Set up Node` (node 22,
`Set up pnpm` (v10), and `make ui-install` - anchored to each
workflow's verification step, not to packaging (all three workflows
have no Node steps after Task 01's strip): `ci.yml` gains them
immediately before its `Test` step, then `make typecheck`,
`make test-ui`, and `make ui`; `build.yml` gains them before its
`make build` step; `release.yml` gains them before its `Verify` step,
which runs `make test` - not merely before `make verify-package` -
since the `test` target includes `test-ui` and the Makefile `package`
target depends on `ui`.

- `ui/src/derive.ts`: pure row derivation mirroring
  `apps/web/lib/prompt-history.ts` - `#N` from `promptIndex`, agent-sent
  flag from `senderTaskId`, duration = floor of the earlier of turn
  `completedAt` and the chronologically next (newer) prompt's `createdAt`
  - the preceding element of the facade's newest-first array, not
  `index + 1` - clamped at zero, whole seconds; durations suppressed until
  turns hydrate (the core
  `turnsHydrated` gate); plus the plugin-local `formatPromptDuration`
  mirror (`h m s` unit labels from the translation catalog). Ordering is
  the facade's page order (older pages append; live updates arrive already
  ordered by the host); derive does not re-sort. The vitest suite includes
  a case with two identical `createdAt` values whose ids are seeded so
  ascending-id order contradicts the facade page order, to pin that derive
  preserves page order rather than sorting by timestamp.
- `ui/src/panel.tsx`: consumes
  `conversation.history.useSessionMessages({ sessionId, taskId,
  authorTypes: ["user"], sort: "desc", pageSize: 20 })` (passing
  `pageSize: 20` explicitly; the host facade's `query.pageSize ?? 20`
  default is a cross-check) and
  `conversation.history.useSessionTurns(sessionId, taskId)`; per-row
  `useMessageFavorite`, `host.ui.PromptMentionText` alias rendering,
  `host.utils.formatRelativeTime` send time (documented parity delta: full
  Intl phrase instead of the core compact ladder), the agent-sent indicator
  (inline SVG glyph, since `host.ui` exposes no icon primitive), truncation
  with overflow detection and a distinct expand control, expanded box
  capped at 40% of the panel height with its own scroll, expansion state
  keyed by message id. States: initial loading, empty, error with retry
  only when no rows are committed (the core
  `fetchFailed && entries.length === 0` condition), `loadingMore` indicator
  while `hasMore`, `removed` (the Host facade's terminal state, not a
  parity-reference state; the core unmounts with the task), passthrough
  degraded state (`sessionKind === "passthrough"`). Pagination mirrors the
  core: paging stops when the first prompt (`#1`) is rendered, a minimum
  400 ms loading-indicator window, floating vs in-flow indicator by
  measured scrollability, stick-to-bottom while loading, and the sentinel
  with `rootMargin: "0px 0px 200px 0px"` (the Host facade joins concurrent
  older-page loads; the sentinel must not re-issue a load already in
  flight). Row selection calls `conversation.openMessage(messageId)`;
  `unavailable` outcomes are consumed without error surfacing - both
  delegate to the pure `ui/src/panel-state.ts` seam (the vitest suite
  now includes permanent rendered component tests that import `panel.tsx`
  directly from source (not the built bundle), with `react`,
  `react-dom`, `@types/react`, `@types/react-dom`, and
  `@testing-library/react` as dev dependencies and `test-host`
  installed with the same real React instance (Vitest does not apply the
  production `react` alias; `panel.tsx` and the renderer resolve the
  installed `react` package, and `test-host` passes that same module to
  `setHost`; only the esbuild production build aliases `react`/
  `react-jsx-runtime` to `react-shim.ts`) plus controlled
  ResizeObserver/IntersectionObserver - for initial load,
  retry/recovery, in-flight pagination suppression, loading grace,
  expansion/40% cap, favorites/live updates, terminal removal, and indicator
  placement (in flow when not scrollable, floating when scrollable) with
  older-page appends preserving bottom anchoring;
  `panel.tsx` is also rendered by the
  throwaway parity spec for
  cross-repository production-artifact parity).
  The panel
  registers with panel key `prompt-history`, a `titleKey`,
  `mobileEnabled: true` (the mobile Panels picker and bottom nav filter on
  it), a bundled icon component, and no `visible` predicate (the host's
  `registrationIsVisible` gates both the menu entry and the panel body;
  omitting it keeps the passthrough state reachable at the accepted cost of
  offering the panel on passthrough sessions - deviating from the menu half
  of AC-UI-PROMPT-HISTORY-PANEL-001.2, see the system design) and uses
  `ph-plugin-` test ids distinct from the core panel's. Accessibility
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
  mobile accessibility delta from the core's pointer-only
  implementation; deliberate delta: the plugin
  also puts `role="status"` on the empty state (the core's empty and
  passthrough states are plain divs with no role).
- `ui/plugin.css`: the plugin-owned stylesheet (declared as
  `ui.styles: ["/ui/plugin.css"]` in the Task 01 manifest; the Task 01
  placeholder is replaced here). The bundle is built in a separate
  repository and imported at runtime from `/api/plugins/{id}/bundle`,
  so the host's build never sees it and the stylesheet owns every
  `ph-plugin-*` class it
  renders (the host's `@source` globs in `apps/web/app/globals.css` cover
  only `apps/web/components/**` and `apps/packages/ui/src/**`); the row bubble
  also reuses the host's global `markdown-body` / `markdown-body-user` classes
  for transcript parity; namespaced
  class names and kandev CSS custom properties for theme fidelity,
  mirroring `kandev-plugin-voice` (`ui/plugin.css` + `ui.styles`).
- `ui/src/host.ts`: re-exports the `@kandev/plugin-sdk` types (the
  `file:../../kdlbs-kandev/apps/packages/plugin-sdk` dependency in
  `ui/package.json`) instead of restating the contract, so
  `tsc --noEmit` typechecks the panel against the pinned SDK.
- `ui/src/strings.ts`: translation catalogs for en plus every supported
  locale and pseudo (`en` required; `pt-pt`, `zh-cn`, `zh-tw`, `zh-hk`,
  `pseudo`), flat keys matching `^[a-z][a-zA-Z0-9_-]*$` (no dots or
  nesting), at most 1000 messages per locale and 4096 characters per
  message (a violation throws at `initialize` and aborts every
  registration); `registerTranslations` in `initialize`.

### Task 03: Package and parity proof

`make package` + `make verify-package` in the plugin repo (the Makefile
stages only the built `ui/bundle.js` and `ui/plugin.css`, mirroring
`kdlbs/kandev-plugin-voice`'s `stage_common`; `verify-package` and
`verify-package-host` assert `ui/plugin.css` is present and `ui/src`,
`ui/node_modules`, and `ui/package.json` are absent from the archive),
then the one-shot parity
proof against a disposable development instance:

1. The `pnpm e2e:run` build step (backend + web assets, which also
   packages the plugin-fixture; `--no-build` reuses those artifacts).
2. A throwaway spec (created for the run under
   `apps/web/e2e/tests/plugins/`, deleted after) installs the production
   `kandev-plugin-prompt-history-0.1.0.tar.gz` through the existing upload
   flow, reusing the `openInstallDialog(page)` and
   `uploadPackage(page, filePath)` exports in
   `apps/web/e2e/tests/plugins/plugin-test-helpers.ts` verbatim (only
   `uploadPackage` is path-parameterized) and inlining only the plugin id,
   the tarball path, and the readiness assertion (the shared
   `installFixturePlugin`/`uninstallFixturePlugin` helpers hardcode the
   fixture's `kandev-plugin-e2e` id and package), and
   drives the parity checks, targeting the production
   panel's `ph-plugin-` test ids: prompt ordering, `#N` ordinals, alias
   rendering, durations, favorite distinction, agent-sent indicator,
   older-page auto-loading, live transitions, navigation, initial loading
   (hold the first read to assert the loading state), fetch-failure with
   retry (fail then recover the first read through Retry), empty, error,
   passthrough, and removed (after rows commit, delete the active session
   and assert committed rows remain and a sentinel-triggered `loadMore`
   emits no request; post-terminal transport fencing - later events do not
   change rows - is covered by the existing Host unit test
   `apps/web/lib/plugins/conversation-host.test.tsx:638-648`)
   states, desktop plus mobile placement, and computed-style
   parity of the favorite highlight and the 40% expanded-box cap. The
   fixture specs (`prompt-history-plugin.spec.ts` and
   `mobile-prompt-history-plugin.spec.ts`) are the source for the ordering,
   live, and navigation assertions; the older-page auto-load check takes its
   oracle from `e2e/tests/task/prompt-history-auto-load.spec.ts` with the
   `e2e/helpers/prompt-history-long-seed.ts` 121-prompt seed -
   scroll-to-sentinel, no load-more assertion (the production panel has no
   load-more control).
   Before the runs, copy the already-verified tarball to
   `.tmp/prompt-history-plugin/kandev-plugin-prompt-history-0.1.0.tar.gz`
   (an ignored path under REPO_ROOT; the Docker runner mounts only REPO_ROOT
   at /work, so the sibling path is absent in the container), and point
   both throwaway specs at that path; remove the copy after the run, and do
   not rebuild or replace it with `package-host`.
3. Re-run the core prompt-history E2E specs (including
   `e2e/tests/task/prompt-history-auto-load.spec.ts`) to confirm the core
   panel and fixture remain behaviorally unchanged.

## ASCII UI preview

### UI-01: Desktop panel (dockview, via "+" menu)

```text
+----------------------------+
| Prompt History             |
+----------------------------+
| #3 fix the login flow ...  | 12 minutes ago  (AC-002.2, .4)
|            [expand]        | 1m 23s    (AC-002.3, .4)
|                            |
| #2 why did the deploy ...  | 1 hour ago
|            [expand]        | 2m 05s
|                            |
| #1 set up the project ...  | 3 days ago
|                            |
+----------------------------+
| Loading older messages     |  floating chip only when the
+----------------------------+  panel scrolls; in-flow otherwise
                                  (AC-002.6)
```

### UI-01E: Expanded row

```text
+----------------------------+
| #3 fix the login flow      |
|   (wrapped text inside a   |  cap: 40% of panel height,
|   box with its own scroll) |  own scroll area (AC-002.3)
|            [collapse]      |
+----------------------------+
```

### UI-01M: Phone (Panels picker, full height)

```text
+--------------------------+
| Prompt History            |
+--------------------------+
| #3 fix the login flow ... | 12 minutes ago
|            [expand]       | 1m 23s
|                           |  rows: min 44px tap targets;
| #2 why did the deploy ... | 1 hour ago   expansion is a distinct
|            [expand]       | 2m 05s   control (AC-002.1, .3)
+--------------------------+
```

### States (shared, both presentations)

- Loading: neutral "Loading" row, no rows, no arrows.
- Empty: localized empty text, no controls.
- Error: retry control only when no rows are committed; committed rows
  render without a retry affordance (AC-002.9).
- Passthrough: the same localized empty copy as the empty state (the core
  renders the same string with no controls), no rows and no controls. The
  panel is still offered in both menus for passthrough sessions (accepted
  delta: the core hides it there; the host's `visible` predicate gates both
  the menu entry and the panel body, so the registration declares none -
  deviating from the menu half of AC-UI-PROMPT-HISTORY-PANEL-001.2, opening
  an empty panel).
- Removed: the Host facade's terminal state (not a parity-reference state;
  the core unmounts with the task). Committed rows remain, no pagination,
  no live updates.

Fixed regions: panel header, panel chrome. Scrolling region: the prompt rows.
The preview is structural; spacing is not a pixel specification. Copy is
plugin-localized (AC-002.10).

## Tests

| Criterion | Evidence |
| --- | --- |
| AC-001.1 | `server/identity_test.go` enforces the invariant the manifest header states: the manifest `id` equals the `go.mod` module, the Makefile `BIN` and `PKG_OUT` prefixes, and `PLUGIN_ID` for the bundle's `window.registerKandevPlugin` call, and the manifest `version` equals the Makefile `VERSION`. It runs in `make test-backend`, which `ci.yml` runs, so a one-sided rename or a version drift now fails CI - previously this was a manual invariant, and the host silently drops a registration whose id differs from the manifest-derived one, so a drift would have shipped a plugin that never activates. The UI half of the registration is asserted in `ui/src/index.test.ts`. The other mechanisms are narrower: `release.yml` compares manifest `version` against Makefile `VERSION` only in its `workflow_dispatch`-only `prepare` job, and `make verify-package` checks archive members and checksums while plugin-pack validates the manifest's shape. |
| AC-001.2, .3, AC-003.3 | `make verify-package` (run by `build.yml`): plugin-pack validates the manifest as it packs, then the target verifies the archive contents, the `checksums.txt` digests, and that development files (`ui/src`, `ui/node_modules`, `ui/package.json`) did not leak into the package |
| AC-001.4 | Disposable-instance enable, disable, and re-enable smoke: the panel registration is removed without error and restored on re-enable |
| AC-002.2, .3, .4, .6, .7, .9 | `ui/src/derive.test.ts` and `ui/src/panel.test.tsx` in the plugin repo (vitest against `test-host`; the mirrored `vitest.config.ts` collects `src/**/*.test.ts` and `src/**/*.test.tsx`; `panel.test.tsx` covers the pure `panel-state.ts` seam and the permanent rendered component tests - the rendered favorite distinction, the agent-sent indicator, the states, live updates (a live prepend, a content change, a completed turn, a live deletion of one prompt from a multi-prompt snapshot, and terminal removal), and controlled ResizeObserver/IntersectionObserver coverage for non-scrollable in-flow indicator placement, scrollable floating indicator placement, the loading grace window, and older-page append while the sentinel is active preserving bottom anchoring; `ui/src/index.test.ts` covers the module's registration payload, and `ui/src/bundle.test.ts` smoke-mounts the built `ui/bundle.js` through that registration, which is the only coverage of the esbuild React aliases as they ship): ordering, ordinals, duration bounds, the turns-hydration gate, the agent-sent flag, state determination, `openMessage` outcome handling, and page-order preservation with identical `createdAt` values (ids seeded to contradict page order) |
| AC-002.1, .5, .6, .7, .8 and AC-003.1 | Throwaway parity spec from Task 03 against the disposable instance (desktop + mobile), older-page auto-load oracled by `e2e/tests/task/prompt-history-auto-load.spec.ts` + `e2e/helpers/prompt-history-long-seed.ts` |
| AC-003.2 | Both fixture E2E specs (`e2e/tests/plugins/prompt-history-plugin.spec.ts` and `e2e/tests/plugins/mobile-prompt-history-plugin.spec.ts`) plus a scoped post-cleanup worktree-cleanliness assertion using `git status --porcelain` for the fixture paths |
| AC-002.10 | Pseudo-locale pass in the throwaway parity spec plus `ui/src/strings.test.ts` in the plugin repo (the catalog-shape unit test: asserts every catalog - `en`, `pt-pt`, `zh-cn`, `zh-tw`, `zh-hk`, `pseudo` - carries exactly the same key set) |
| Go backend no-op contract | `server/plugin_test.go` (template-derived) |

The AC-001.4, AC-002.1/.5/.6/.7/.8 and AC-003.1, AC-003.2, and AC-002.10 rows
name the planned throwaway/disposable-instance runs from Task 03. Those specs
live in the monorepo e2e harness, are not committed to this repository, and
have not been run in this worktree, so those rows state the required evidence
rather than coverage that exists here; `Verification results` below stays
`Pending` until the disposable run happens and its results are recorded. Every
other row is backed by committed tests or by CI/packaging mechanisms that run
in this repository.

One property is verified by measurement rather than by a committed test: the
stylesheet's responsive control matrix (the 24 px fine-pointer control, the
44 px coarse-pointer and phone-width targets, and the pointer-scoped row
height that keeps the coarse-pointer control unclipped). The suite runs under
jsdom, which neither applies `ui/plugin.css` nor evaluates media queries, and
this repository carries no browser test runner - the browser runs belong to
the Task 03 parity proof. The rules therefore keep their rationale in
comments next to them in `ui/plugin.css`, the measured values are recorded in
the system design, and any change to those rules must be re-measured in a
browser (`ui/plugin.css` is the artifact under test, not a rendering of it).

## E2E tests

One-shot, throwaway (not committed): `prompt-history-parity-check.spec.ts`
(desktop, chromium project) and the mobile equivalent (mobile-chrome /
Pixel 5), both driving the production tarball and mapping to
AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.1, and the Task 03 in-scope
behavior list (ordering, `#N` ordinals, alias rendering, durations,
favorite distinction, agent-sent indicator, older-page auto-loading, live
transitions, navigation, initial loading, fetch-failure with retry,
empty, error, passthrough, and terminal removed states (committed rows
remain; `loadMore` emits no request; post-terminal transport fencing is
covered by the existing Host unit test), desktop plus mobile placement,
the computed-style parity checks, the loading-indicator placement (in
flow when not scrollable, floating when scrollable) with bottom anchoring
preserved on older-page appends, the expand button's `boundingBox()`
width and height each at least 44 px on the mobile run, and the
pseudo-locale run asserting the panel's rendered labels and states after
selecting pseudo). Core preservation
is confirmed by re-running the existing core specs
(`e2e/tests/task/prompt-history-panel.spec.ts`,
`mobile-prompt-history-panel.spec.ts`, and
`e2e/tests/task/prompt-history-auto-load.spec.ts`),
both fixture specs (`e2e/tests/plugins/prompt-history-plugin.spec.ts`
and `mobile-prompt-history-plugin.spec.ts`), and a scoped
post-cleanup worktree-cleanliness assertion using `git status
--porcelain` for the fixture paths.

## Work orders

- [ ] [Task 01: Bootstrap repo and installable skeleton](task-01-bootstrap-repo-skeleton.md)
- [ ] [Task 02: Implement the parity panel](task-02-implement-parity-panel.md)
- [ ] [Task 03: Package and prove parity](task-03-package-and-prove-parity.md)

## Verification results

Pending.

## Risks

- Host contract drift: the plugin pins `min_kandev_version` to the first
  release carrying the facade (0.95.0 at writing time); a later host release
  changing the `host.conversation` DTO shapes would break the bundle. The
  drift mitigation is the pinned `@kandev/plugin-sdk`: `ui/package.json`
  depends on it via `file:../../kdlbs-kandev/apps/packages/plugin-sdk` and
  `ui/src/host.ts` re-exports its types, so `tsc --noEmit` catches DTO drift
  at build time, which is why the pinned ref must include PR #3588.
- One-shot proof only: per the settled scope, no permanent monorepo
  regression covers the production package; the follow-up migration package
  must add one when it removes the core panel.
- Parity delta: send time uses `host.utils.formatRelativeTime` (full Intl
  phrase) instead of the core compact ladder; this is host-contract-mandated
  and documented in the system design, not a defect.
- Disposable instance availability: the parity proof needs the monorepo e2e
  harness and a working browser; environment-sensitive e2e failures must be
  attributed before treating them as plugin defects.
- Repository creation is an external GitHub action; the repository must be
  created before Task 01 proceeds, and the template must be the source of
  the initial tree.
- Styling: the bundle is built in a separate repository and imported at
  runtime from `/api/plugins/{id}/bundle`, so the host's build never
  sees it and every utility is plugin-owned in `ui/plugin.css`; a utility
  the panel relies on but the css misses renders unstyled, which the
  computed-style parity assertion catches.
- Passthrough and removed deltas: the plugin panel is offered for
  passthrough sessions where the core hides it (the host's `visible`
  predicate gates both the menu entry and the panel body, so the
  registration declares none - deviating from the menu half of
  AC-UI-PROMPT-HISTORY-PANEL-001.2, opening an empty panel), and the
  `removed` state leaves rows visible where the core unmounts; both are
  recorded in the system design.

## Open questions

None.
