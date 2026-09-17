---
id: "03-package-and-prove-parity"
title: "Package and prove parity"
status: pending
wave: 3
depends_on:
  - "02-implement-parity-panel"
plan: "plan.md"
requirements:
  - REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003
acceptance_criteria:
  - AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.1
  - AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.2
  - AC-PLUGINS-PROMPT-HISTORY-PLUGIN-003.3
system_design:
  - ../../specs/plugins/system-design/prompt-history-plugin.md
---

# Task 03: Package and Prove Parity

## Summary

Package the production artifact with `make package` and `make verify-package`,
then prove feature parity against a disposable development instance: install
the production tarball through the monorepo e2e harness, drive the parity
checks on desktop and mobile with a throwaway spec (not committed), and
confirm the core panel and fixture remain behaviorally unchanged.

## In scope

- Cross-platform packaging of `kandev-plugin-prompt-history-0.1.0.tar.gz`
  and the `verify-package` archive checks (contents, checksums, staging
  leak check, presence of `ui/plugin.css`, and absence of `ui/src`,
  `ui/node_modules`, `ui/package.json`); the Makefile stages only the built
  `ui/bundle.js` and `ui/plugin.css` (mirroring
  `kdlbs/kandev-plugin-voice`'s `stage_common`), not the `ui/` source tree.
- The throwaway parity spec(s) under `apps/web/e2e/tests/plugins/`
  (created for the run, deleted after): reuse the `openInstallDialog(page)`
  and `uploadPackage(page, filePath)` exports in
  `apps/web/e2e/tests/plugins/plugin-test-helpers.ts` verbatim (only
  `uploadPackage` is path-parameterized), inlining only the plugin id,
  the tarball path, and the readiness assertion (the shared
  `installFixturePlugin`/`uninstallFixturePlugin` helpers hardcode the
  fixture's `kandev-plugin-e2e` id and package path) to install the
  production tarball, and drive the parity checks - prompt
  ordering, `#N` ordinals, alias rendering, durations, favorite
  distinction, agent-sent indicator, older-page auto-loading, live
  transitions, navigation, initial loading (hold the first read to assert
  the loading state), fetch-failure with retry (fail then recover the first
  read through Retry), empty, error, passthrough, and removed (after rows
  commit, delete the active session and assert committed rows remain and a
  sentinel-triggered `loadMore` emits no request; post-terminal transport
  fencing - later events do not change rows - is covered by the existing
  Host unit test `apps/web/lib/plugins/conversation-host.test.tsx:638-648`)
  states,
  desktop plus mobile placement,
  and computed-style parity of the favorite highlight, the 40%
  expanded-box cap, and the loading-indicator placement (in flow when not
  scrollable, floating when scrollable) with older-page appends preserving
  bottom anchoring, and a pseudo-locale run asserting the panel's rendered
  labels and states after selecting pseudo - targeting the production
  panel's `ph-plugin-` test ids. The fixture specs
  (`apps/web/e2e/tests/plugins/prompt-history-plugin.spec.ts` and
  `mobile-prompt-history-plugin.spec.ts`) are the source for the ordering,
  live, and navigation assertions; the older-page auto-load check takes its
  oracle from `apps/web/e2e/tests/task/prompt-history-auto-load.spec.ts`
  with the `apps/web/e2e/helpers/prompt-history-long-seed.ts` 121-prompt
  seed (scroll-to-sentinel, no load-more assertion - the production panel
  has no load-more control).
- Tarball access: before the parity runs, copy the already-verified
  `kandev-plugin-prompt-history-0.1.0.tar.gz` to
  `.tmp/prompt-history-plugin/kandev-plugin-prompt-history-0.1.0.tar.gz`
  (an ignored path under REPO_ROOT; the Docker runner mounts only REPO_ROOT
  at /work, so the sibling path is absent in the container when
  `run-e2e.sh` auto-selects Docker), and point both throwaway specs at that
  path; remove the copy after the run, and do not rebuild or replace it with
  `package-host`.
- Core preservation: re-run the existing core prompt-history E2E specs
  (`e2e/tests/task/prompt-history-panel.spec.ts`,
  `e2e/tests/task/mobile-prompt-history-panel.spec.ts`, and
  `e2e/tests/task/prompt-history-auto-load.spec.ts`), both fixture specs
  (`e2e/tests/plugins/prompt-history-plugin.spec.ts` and
  `mobile-prompt-history-plugin.spec.ts`), and a scoped
  post-cleanup worktree-cleanliness assertion using `git status
  --porcelain` for the fixture paths.

## Out of scope

- Committing the parity spec to the monorepo (one-shot proof per the settled
  scope).
- Saved-layout migration, core panel removal, release tagging, and the
  marketplace catalog entry.

## Acceptance

- `make verify-package` passes in the plugin repo and the archive contains
  `manifest.yaml`, the UI bundle, `ui/plugin.css`, all five platform
  executables, and the generated checksum file, with no `ui/src`,
  `ui/node_modules`, or `ui/package.json` entries.
- The throwaway parity runs pass on the disposable instance: desktop
  (chromium project) and mobile (mobile-chrome / Pixel 5), covering the
  behaviors listed in the plan's Technical approach, including the
  AC-002.9 observable states (initial loading, fetch-failure with retry,
  and the terminal removed state where committed rows remain and
  pagination/live updates stop), and the pseudo-locale run asserting the
  panel's rendered labels and states after selecting pseudo.
- The core prompt-history and fixture E2E specs pass unchanged after the
  parity runs, and a scoped post-cleanup `git status --porcelain`
  assertion confirms the worktree is clean for every fixture-owned path
  (`apps/backend/cmd/plugin-fixture`, `apps/web/e2e/fixtures/plugins/
  prompt-history-plugin`, and both fixture E2E specs).

## Verification

```bash
cd ../kandev-plugin-prompt-history   # sibling of the monorepo worktree
make ui-install
make package
make verify-package
```

Parity runs (from the monorepo worktree; the throwaway spec files are
created for the run and deleted after):

```bash
# Stage the already-verified production tarball under REPO_ROOT (the Docker
# runner mounts only REPO_ROOT at /work, so the sibling path is absent in
# the container); both throwaway specs install it from this path, and
# package-host must not rebuild or replace it.
mkdir -p .tmp/prompt-history-plugin
cp ../kandev-plugin-prompt-history/kandev-plugin-prompt-history-0.1.0.tar.gz \
   .tmp/prompt-history-plugin/kandev-plugin-prompt-history-0.1.0.tar.gz
trap 'rm -rf .tmp/prompt-history-plugin \
  apps/web/e2e/tests/plugins/prompt-history-parity-check.spec.ts \
  apps/web/e2e/tests/plugins/mobile-prompt-history-parity-check.spec.ts' EXIT

(cd apps && pnpm install --frozen-lockfile)
(cd apps && pnpm --filter @kandev/web e2e:run -- e2e/tests/plugins/prompt-history-parity-check.spec.ts)
(cd apps && pnpm --filter @kandev/web e2e:run -- --project mobile-chrome --no-build -- e2e/tests/plugins/mobile-prompt-history-parity-check.spec.ts)
(cd apps && pnpm --filter @kandev/web e2e:run -- --no-build -- e2e/tests/task/prompt-history-panel.spec.ts e2e/tests/task/prompt-history-auto-load.spec.ts e2e/tests/plugins/prompt-history-plugin.spec.ts)
(cd apps && pnpm --filter @kandev/web e2e:run -- --project mobile-chrome --no-build -- e2e/tests/task/mobile-prompt-history-panel.spec.ts e2e/tests/plugins/mobile-prompt-history-plugin.spec.ts)
# After the runs, remove the staged tarball and the throwaway spec files
# (the EXIT trap is a fallback for failure cleanup).
rm -rf .tmp/prompt-history-plugin \
  apps/web/e2e/tests/plugins/prompt-history-parity-check.spec.ts \
  apps/web/e2e/tests/plugins/mobile-prompt-history-parity-check.spec.ts
# Prove the fixture plugin and its E2E specs stayed unchanged: assert the
# worktree is clean for every fixture-owned path, catching untracked files
# (not only tracked diffs).
test -z "$(git status --porcelain -- apps/backend/cmd/plugin-fixture \
  apps/web/e2e/fixtures/plugins/prompt-history-plugin \
  apps/web/e2e/tests/plugins/prompt-history-plugin.spec.ts \
  apps/web/e2e/tests/plugins/mobile-prompt-history-plugin.spec.ts)"
```

## Files likely touched

- `kdlbs/kandev-plugin-prompt-history/` (packaging output only; no source
  changes unless packaging exposes a defect)
- `apps/web/e2e/tests/plugins/prompt-history-parity-check.spec.ts`
  (throwaway, deleted after the run)
- `apps/web/e2e/tests/plugins/mobile-prompt-history-parity-check.spec.ts`
  (throwaway, deleted after the run)

## Dependencies

- Task 02 (parity panel implementation).

## Risks

- The disposable instance is environment-sensitive (browser, backend build,
  fixture packaging); attribute e2e failures to the environment before
  treating them as plugin defects.
- The throwaway spec targets the production panel's `ph-plugin-` test ids
  and its `plugin:kandev-plugin-prompt-history:prompt-history` layout
  identity; if the implementation's ids differ from the pinned scheme,
  update the throwaway spec (not the committed core specs) before the run.
- The throwaway spec's role-based queries (`getByRole("button")`,
  `role="status"`) and 44 px tap-target assertions - including the
  expand button's `boundingBox()` width and height each at least
  44 px - depend on the accessibility attributes pinned in Task 02; if
  the implementation omits them, the spec fails before any parity
  judgment.

## Parallelism

`sequential`

## Inputs

- `apps/web/e2e/tests/task/prompt-history-auto-load.spec.ts` and
  `apps/web/e2e/helpers/prompt-history-long-seed.ts` (the older-page
  auto-load oracle: scroll-to-sentinel, no load-more assertion).
- [Requirements](../../specs/plugins/requirements/prompt-history-plugin.md)
  REQ-PLUGINS-PROMPT-HISTORY-PLUGIN-003.
- [System design](../../specs/plugins/system-design/prompt-history-plugin.md),
  Parity proof and Verification.
- `apps/web/e2e/tests/plugins/prompt-history-plugin.spec.ts` and
  `apps/web/e2e/tests/plugins/mobile-prompt-history-plugin.spec.ts`
  (fixture parity checks to mirror behaviorally).
- `apps/web/e2e/helpers/plugin-fixture.ts` (the
  `installFixturePlugin`/`uninstallFixturePlugin` helpers that hardcode
  the fixture's `kandev-plugin-e2e` id and package path).
- `apps/web/e2e/tests/plugins/plugin-test-helpers.ts` (the
  `openInstallDialog(page)` and `uploadPackage(page, filePath)` exports,
  reused verbatim; only `uploadPackage` is path-parameterized, and only
  the plugin id, the tarball path, and the readiness assertion are
  inlined).
- Parity reference: `apps/web/components/task/prompt-history-panel-content.tsx`.

## Results

Pending.
