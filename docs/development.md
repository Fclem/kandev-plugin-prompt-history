# Development

How the plugin is built, wired, and tested. For what it does, see the
[README](../README.md); for the design contract, the
[system design](specs/plugins/system-design/prompt-history-plugin.md).

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

The panel needs none of that: it is a browser-side native-UI contribution, so
the binary is only the handshake.

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
directly. Edit the sources in `ui/src/` and rebuild with `make ui` — do not
hand-edit `ui/bundle.js`.

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
level down. Adjust the `replace` path if your layout differs. Once
`pkg/pluginsdk` ships as a standalone, versioned module, this repo will drop
the `replace` and pin a real version instead.

The frontend follows the same source-checkout model: `ui/package.json` depends
on `@kandev/plugin-sdk` via
`file:../../kdlbs-kandev/apps/packages/plugin-sdk`, and `ui/src/host.ts`
re-exports those types rather than restating the contract, so `tsc --noEmit`
typechecks the panel against the pinned SDK.

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

The UI suite renders the panel with a fake host and asserts the shipped
bundle's own behaviour; `ui/src/test-host.ts` is the facade stand-in.
