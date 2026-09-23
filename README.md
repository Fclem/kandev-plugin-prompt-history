# kandev-plugin-prompt-history

A [kandev](https://github.com/kdlbs/kandev) **native-UI plugin** that ships the
Prompt History task panel as a production, independently packaged package. It
lists the active session's user prompts with feature parity to the shipped
core panel — user-prompt rows, `#N` ordinals, alias rendering, send time, agent
work durations, favorite highlighting, the agent-sent indicator, older-page
auto-loading, live reconciliation, transcript navigation, and desktop/mobile
placement — through the public Host contracts, without importing private stores
or duplicating host-owned transport.

It is packaged into a versioned tarball and installed against a running kandev
instance via **Settings > Plugins**.
> [!NOTE]
> This plugin was entirely designed and written by a local Qwen 3.8 27B IQ3
> XXS model, derived from an existing internal implementation rather than
> implemented from scratch.

## What it contributes

- **A task panel** — `ui/bundle.js` registers a `prompt-history` task panel
  (`registerTaskPanel`) with a localized title, a bundled icon component, and
  `mobileEnabled: true` so both the desktop add-panel menu and the mobile
  Panels picker offer it. It declares no `visible` predicate: the host's
  `registrationIsVisible` gates both the menu entry and the panel body, so
  omitting it keeps the passthrough state reachable.
- **Least-privilege capabilities** — the manifest declares only
  `capabilities.api_read: ["messages"]`. The panel reads the active session's
  conversation through the Host facade (`host.conversation`) and nothing else;
  the no-op Go backend exercises no events, state, secrets, or write access.
- **A no-op backend** — `server/` embeds `pluginsdk.UnimplementedPlugin` and
  overrides no RPCs. The browser conversation facade needs no plugin backend
  logic, so the platform-matching binary is only the go-plugin handshake.
- **A plugin-owned stylesheet** — `ui/plugin.css` owns every `ph-plugin-*`
  class the panel renders (the bundle is built in a separate repository and
  imported at runtime from `/api/plugins/{id}/bundle`, so the host's build
  never sees it and no utility in the host's Tailwind sources applies to it).
  The row bubble deliberately also reuses the host's global `markdown-body`
  and `markdown-body-user` classes, which the host's `globals.css` always
  loads, so prompt text renders exactly as it does in the transcript. The
  host injects the stylesheet without a cache key while the bundle URL is
  versioned, so `initialize` re-points this plugin's `<link>` at
  `?v=<manifest version>`; the row glyphs additionally carry intrinsic
  `width`/`height` so a stale or missing stylesheet cannot render them at
  container width.
- **Localized copy** — every user-facing string resolves through the plugin
  translation catalog (`ui/src/strings.ts`) with an English fallback; catalogs
  exist for `en`, `pt-pt`, `zh-cn`, `zh-hk`, `zh-tw`, and `pseudo`.

## Minimum host version

`manifest.yaml` declares `min_kandev_version: "0.95.0"` — the first stable
release after PR #3588 added the browser conversation facade that `ui/bundle.js` calls
through `host.conversation`. The `messages` capability audit floor is `0.91.1`;
this plugin needs the facade, so the facade floor is the binding minimum. A
release host compares it against its own version at install time and refuses an
older one, so an operator gets a clear error instead of a plugin that loads and
then breaks on a missing API.

Two caveats worth knowing:

- The check is **release-only by design**. A host built from a git checkout
  reports a git-describe version like `v0.95.0-27-g4705f1fd0`, which isn't a
  release version, so the gate is skipped and the install succeeds whatever
  floor you declare. A successful sideload onto your dev instance is not
  evidence that your floor is correct — check it against the kandev history
  instead (`git merge-base --is-ancestor <commit> <tag>`).
- The floor is confirmed at release cut: `0.95.0` is the first stable release
  cut after the PR #3588 merge.

## How a plugin runs (gRPC subprocess, not HTTP)

kandev spawns the platform-matching binary from `runtime.executables` in
`manifest.yaml` as a subprocess and talks to it over a private gRPC connection
([hashicorp/go-plugin](https://github.com/hashicorp/go-plugin)) — there is no
HTTP listen address, no shared secret, and no manual wiring: `pluginsdk.Serve`
in `server/main.go` owns the entire transport. The base interface has two RPCs
and gives you a `Host` handle back:

```go
type Plugin interface {
    OnEvent(ctx context.Context, e *Event) error
    HandleWebhook(ctx context.Context, req *WebhookRequest) (*WebhookResponse, error)
}
```

`server/plugin.go`'s `promptHistoryPlugin` embeds `pluginsdk.UnimplementedPlugin`
(a no-op default for both RPCs, plus `Host()`/`SetHost()` accessors) and
overrides none. `server/main.go` is just
`pluginsdk.Serve(&promptHistoryPlugin{})`.

## Developing against the SDK

`pkg/pluginsdk` is not published as its own module yet, so `go.mod` here uses a
local `replace`:

```
replace github.com/kandev/kandev => ../kdlbs-kandev/apps/backend
```

This assumes this plugin repo is checked out as a **sibling** of the `kandev`
monorepo worktree:

```
some-dir/
├── kdlbs-kandev/                 # https://github.com/kdlbs/kandev, Go module at apps/backend/
└── kandev-plugin-prompt-history/ # this repo
```

Note the module root is `kdlbs-kandev/apps/backend`, not the repo root —
`kandev` is a monorepo and the Go backend (including `pkg/pluginsdk`) lives one
level down. Adjust the `replace` path if your layout differs. Once `pkg/pluginsdk`
ships as a standalone, versioned module, this repo will drop the `replace` and
pin a real version instead.

The frontend follows the same source-checkout model: `ui/package.json` depends on
`@kandev/plugin-sdk` via `file:../../kdlbs-kandev/apps/packages/plugin-sdk`, and
`ui/src/host.ts` re-exports those types rather than restating the contract, so
`tsc --noEmit` typechecks the panel against the pinned SDK. `ui/bundle.js` is the
esbuild build output of `ui/src/` (built by `make ui`); edit the sources and
rebuild, not the bundle.

## Layout

```
manifest.yaml          # plugin manifest — id, capabilities, runtime.executables, ui.bundle + ui.styles
server/
  main.go              # pluginsdk.Serve wiring — no flags, no HTTP, no secrets
  plugin.go            # promptHistoryPlugin: embeds UnimplementedPlugin, no overridden RPCs
  plugin_test.go       # no-op contract tests, no subprocess spawn needed
ui/
  src/                 # TypeScript sources, built into ui/bundle.js by ui/build.mjs (esbuild)
  plugin.css           # plugin-owned stylesheet, declared as ui.styles in manifest.yaml
  build.mjs            # esbuild build (no bundled React; react aliased to a host-delegating shim)
  package.json         # @kandev/plugin-sdk file: dependency plus the UI toolchain
```

`ui/bundle.js` is the esbuild output of `ui/src/`. There is a build step: it
ships as a single ES module inside the package tar.gz, and kandev serves it
directly. Edit the sources in `ui/src/` and rebuild with `make ui` — do not hand-
edit `ui/bundle.js`.

## Build and test

```sh
make build               # go build -o bin/... ./server/...
make test                # backend Go tests plus the UI vitest suite
make typecheck           # tsc --noEmit against the pinned @kandev/plugin-sdk
make ui                  # build ui/bundle.js with esbuild
make verify-package-host # validate a host-only tarball and checksums
```

> Note: bare `go build ./server/...` (no `-o`) fails with `build output
> "server" already exists and is a directory` — Go's default output name for a
> lone main package is the last path element ("server"), which collides with
> the `server/` source directory. Always pass `-o`, run `go build .` from
> inside `server/`, or use `make build`. `go vet`/`go test` are unaffected.

## Package it

```sh
make package        # cross-compiles linux/darwin (amd64+arm64) + windows/amd64,
                    # then packs manifest + built UI assets + binaries into a versioned .tar.gz

make package-host   # host platform only — faster local iteration
make verify-package # build + validate the five-platform archive
```

Both stage `manifest.yaml` + `ui/` alongside the freshly built
`server/plugin-<goos>-<goarch>[.exe]` binaries, then pack the tree with
kandev's `cmd/plugin-pack`, which computes `checksums.txt` and writes the
tarball.

Note the Makefile runs `plugin-pack` with `cd $(KANDEV_SDK) && go run
./cmd/plugin-pack`, from inside the sibling kandev checkout, rather than as
`go run github.com/kandev/kandev/cmd/plugin-pack` from here. The second
spelling resolves plugin-pack's dependencies against *this* module's `go.sum`,
and plugin-pack reaches much further into the kandev backend than `server/`
does — so those entries are missing and packaging fails with `missing go.sum
entry`. Pulling them in would force this repo's `go.sum` to track every
dependency the kandev backend grows. Building the tool where it lives keeps
`go.sum` scoped to what this plugin actually imports.

## Install it against a running kandev

Either through the UI (**Settings > Plugins > Install plugin**, URL or file
upload), or directly:

```sh
curl -F package=@kandev-plugin-prompt-history-0.2.0.tar.gz \
  http://localhost:<kandev-port>/api/plugins/install
```

kandev verifies `checksums.txt`, validates the manifest, extracts the package,
spawns the host-matching binary, and — once the go-plugin handshake completes —
marks the plugin active. Sideloaded plugins register **disabled/unverified**;
enable yours in **Settings > Plugins** (the `plugins` feature flag must be on).
Reinstalling the same version returns 409 — bump `version` in `manifest.yaml`.

## Publish a release

Pull requests run `.github/workflows/ci.yml` (tidy, format, vet, and test) and
`.github/workflows/build.yml` (host build plus a five-platform package). Push a
tag that matches the manifest version to run `.github/workflows/release.yml`:
it repeats verification, cross-compiles all platforms, packs the tarball, and
creates a GitHub Release with the two assets the kandev
[marketplace](https://github.com/kdlbs/kandev/blob/main/docs/public/plugins-marketplace.md)
install pipeline expects. The workflow refuses a pushed tag that does not
match the manifest `version` (checked against the Makefile `VERSION` too), so a
mistyped tag fails before anything is published instead of attaching a
differently-versioned package to it.

- `<id>-<version>.tar.gz` — the plugin package (with its own internal
  `checksums.txt` verified on install), and
- `checksums.txt` — the package's internal file checksums, extracted from the
  tarball for inspection and marketplace tooling.

```sh
# bump VERSION in Makefile + version in manifest.yaml first, then:
git tag v0.1.0
git push origin v0.1.0
```

The workflows check out the kandev monorepo as a sibling so the local Go and
TypeScript SDK paths resolve (see "Developing against the SDK"). They pin one
source revision for the SDK contract; advance that pin deliberately and rerun
the backend and UI suites when adopting a newer SDK.

## License

MIT — see [LICENSE](LICENSE). This repository is a production kandev plugin;
the plugin is packaged and distributed under this license.
