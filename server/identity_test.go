// The plugin's identity is declared in four places that the host requires to
// agree. Its manifest header states the invariant: `id` "MUST match the Go
// module name in go.mod and the id you pass to window.registerKandevPlugin(...)
// in ui/bundle.js". The host derives the plugin id from the manifest and
// matches a bundle's registration against it, so a one-sided rename leaves a
// plugin that never activates - the registration is dropped and only the
// console reports it, with no packaging or CI signal. These declarations are
// checked here because `go test ./server/...` already runs in CI and needs no
// new tooling.
package main

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func readDeclaration(t *testing.T, name string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(content)
}

func captureDeclaration(t *testing.T, source, pattern, file string) string {
	t.Helper()
	match := regexp.MustCompile(pattern).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s: %q did not match", file, pattern)
	}
	return match[1]
}

func TestPluginIdentityAgreement(t *testing.T) {
	want := captureDeclaration(t, readDeclaration(t, "manifest.yaml"), `(?m)^id: "([^"]+)"$`, "manifest.yaml")

	if got := captureDeclaration(t, readDeclaration(t, "go.mod"), `(?m)^module (\S+)$`, "go.mod"); got != want {
		t.Errorf("go.mod module = %q, want the manifest id %q", got, want)
	}

	makefile := readDeclaration(t, "Makefile")
	if got := captureDeclaration(t, makefile, `(?m)^BIN := bin/(\S+)$`, "Makefile"); got != want {
		t.Errorf("Makefile BIN = %q, want the manifest id %q", got, want)
	}
	if got := captureDeclaration(t, makefile, `(?m)^PKG_OUT := (\S+)-\$\(VERSION\)\.tar\.gz$`, "Makefile"); got != want {
		t.Errorf("Makefile PKG_OUT = %q, want the manifest id %q", got, want)
	}

	host := readDeclaration(t, filepath.Join("ui", "src", "host.ts"))
	if got := captureDeclaration(t, host, `(?m)^export const PLUGIN_ID = "([^"]+)";$`, "ui/src/host.ts"); got != want {
		t.Errorf("ui/src/host.ts PLUGIN_ID = %q, want the manifest id %q", got, want)
	}
}

func TestReleaseVersionAgreement(t *testing.T) {
	manifestVersion := captureDeclaration(t, readDeclaration(t, "manifest.yaml"), `(?m)^version: "([^"]+)"$`, "manifest.yaml")
	makeVersion := captureDeclaration(t, readDeclaration(t, "Makefile"), `(?m)^VERSION := (\S+)$`, "Makefile")

	if makeVersion != manifestVersion {
		t.Errorf("Makefile VERSION = %q, want the manifest version %q", makeVersion, manifestVersion)
	}
}
