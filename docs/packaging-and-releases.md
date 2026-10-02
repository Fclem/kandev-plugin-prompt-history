# Packaging, install, and releases

For building and testing locally, see [development](development.md).

## Minimum host version

`manifest.yaml` declares `min_kandev_version: "0.95.0"` — the first stable
release after PR #3588 added the browser conversation facade that
`ui/bundle.js` calls through `host.conversation`. The `messages` capability
audit floor is `0.91.1`; this plugin needs the facade, so the facade floor is
the binding minimum. A release host compares it against its own version at
install time and refuses an older one, so an operator gets a clear error
instead of a plugin that loads and then breaks on a missing API.

Two caveats worth knowing:

- The check is **release-only by design**. A host built from a git checkout
  reports a git-describe version like `v0.95.0-27-g4705f1fd0`, which isn't a
  release version, so the gate is skipped and the install succeeds whatever
  floor you declare. A successful sideload onto your dev instance is not
  evidence that your floor is correct — check it against the kandev history
  instead (`git merge-base --is-ancestor <commit> <tag>`).
- The floor is confirmed at release cut: `0.95.0` is the first stable release
  cut after the PR #3588 merge.

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
curl -F package=@kandev-plugin-prompt-history-<version>.tar.gz \
  http://localhost:<kandev-port>/api/plugins/install
```

kandev verifies `checksums.txt`, validates the manifest, extracts the package,
spawns the host-matching binary, and — once the go-plugin handshake completes —
marks the plugin active. Sideloaded plugins register **disabled/unverified**;
enable yours in **Settings > Plugins** (the `plugins` feature flag must be on).
Reinstalling the same version returns 409 — bump `version` in `manifest.yaml`.

A package dropped into the plugins directory (`<kandev-home>/plugins/*.tar.gz`)
is installed by **Sync** (Settings > Plugins) through the same verified
pipeline, which then deletes the file.

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
git tag v<version>
git push origin v<version>
```

The workflows check out the kandev monorepo as a sibling so the local Go and
TypeScript SDK paths resolve (see [development](development.md)). They pin one
source revision for the SDK contract; advance that pin deliberately and rerun
the backend and UI suites when adopting a newer SDK.
