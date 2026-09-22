// The manifest is the host's declarative contract, but the packaging path that
// CI runs does not parse it: `make verify-package` (build.yml) invokes
// plugin-pack without `-platform-only`, and plugin-pack reads the manifest only
// on that host-only path, while the target's own checks are archive members and
// checksums. A drifted contract therefore packages cleanly. The capability
// grant is the sharp edge: the host answers the panel's conversation reads with
// 404 when `api_read: ["messages"]` is missing, and the facade maps that to its
// terminal removal state, so the panel renders "No prompts yet." on every
// session with no error, no retry and only a console line. A declared asset
// path that the Makefile does not stage fails the same silent way.
//
// These checks are textual on purpose: `ui/bundle.js` is a gitignored build
// artifact and does not exist when `make test-backend` runs in a fresh
// checkout, so the declaration is compared against the Makefile that produces
// and verifies it rather than against the filesystem.
package main

import (
	"regexp"
	"strings"
	"testing"
)

const (
	wantCapabilitiesBlock = "  api_read: [\"messages\"]\n"
	wantUIBlock           = "  bundle: \"/ui/bundle.js\"\n  styles: [\"/ui/plugin.css\"]\n"
)

func TestManifestCapabilityContract(t *testing.T) {
	manifest := readDeclaration(t, "manifest.yaml")

	if got := captureDeclaration(t, manifest, `(?m)^api_version: (\d+)$`, "manifest.yaml"); got != "2" {
		t.Errorf("api_version = %s, want 2", got)
	}

	capabilities := captureDeclaration(t, manifest, `(?m)^capabilities:\n((?:  [^\n]*\n)+)`, "manifest.yaml")
	if capabilities != wantCapabilitiesBlock {
		t.Errorf("capabilities block = %q, want exactly %q", capabilities, wantCapabilitiesBlock)
	}

	ui := captureDeclaration(t, manifest, `(?m)^ui:\n((?:  [^\n]*\n)+)`, "manifest.yaml")
	if ui != wantUIBlock {
		t.Errorf("ui block = %q, want exactly %q", ui, wantUIBlock)
	}

	// The host serves those paths from the package root, so they must name the
	// files the Makefile stages.
	makefile := readDeclaration(t, "Makefile")
	for _, staged := range []string{"$(STAGE)/ui/bundle.js", "$(STAGE)/ui/plugin.css"} {
		if !strings.Contains(makefile, staged) {
			t.Errorf("Makefile does not stage %s, which the manifest declares", staged)
		}
	}
}

// The scope half of the declaration. The capability block and the ui block are
// pinned exactly above, which already rejects an added capability
// (`api_write`, `events`, `state`, `secrets`, ...) and any `ui.pages` or
// `ui.keybindings`; these are the remaining top-level surfaces the acceptance
// criteria forbid and the published identity fields, both of which the pinned
// host exposes to operators (the plugin list renders the repo link).
var forbiddenTopLevelKeys = []string{
	"webhooks",
	"actions",
	"config_schema",
	"web_apps",
	"repository_providers",
	"reference_sources",
	"agent_tools",
}

func TestManifestLeastPrivilege(t *testing.T) {
	manifest := readDeclaration(t, "manifest.yaml")
	for _, key := range forbiddenTopLevelKeys {
		if regexp.MustCompile(`(?m)^` + key + `:`).MatchString(manifest) {
			t.Errorf("manifest.yaml declares %q, but the plugin is documented as least-privilege", key)
		}
	}
}

func TestManifestIdentityMetadata(t *testing.T) {
	manifest := readDeclaration(t, "manifest.yaml")
	for _, want := range []struct{ key, value string }{
		{"display_name", `"Prompt History"`},
		{"author", `"kandev"`},
		{"repo_url", `"https://github.com/Fclem/kandev-plugin-prompt-history"`},
		{"categories", `["tools"]`},
	} {
		got := captureDeclaration(t, manifest, `(?m)^`+want.key+`: (.+)$`, "manifest.yaml")
		if got != want.value {
			t.Errorf("manifest.yaml %s = %s, want %s", want.key, got, want.value)
		}
	}
}

func TestManifestRuntimeContract(t *testing.T) {
	manifest := readDeclaration(t, "manifest.yaml")
	block := captureDeclaration(t, manifest, `(?m)^  executables:\n((?:    [^\n]*\n)+)`, "manifest.yaml")

	declared := map[string]string{}
	entry := regexp.MustCompile(`^    (\S+): "([^"]+)"$`)
	for _, line := range strings.Split(strings.TrimRight(block, "\n"), "\n") {
		match := entry.FindStringSubmatch(line)
		if match == nil {
			t.Fatalf("manifest.yaml: %q is not a platform: path entry", line)
		}
		declared[match[1]] = match[2]
	}

	want := map[string]string{
		"linux-amd64":   "server/plugin-linux-amd64",
		"linux-arm64":   "server/plugin-linux-arm64",
		"darwin-amd64":  "server/plugin-darwin-amd64",
		"darwin-arm64":  "server/plugin-darwin-arm64",
		"windows-amd64": "server/plugin-windows-amd64.exe",
	}
	if len(declared) != len(want) {
		t.Errorf("manifest declares %d platforms, want %d", len(declared), len(want))
	}
	for platform, path := range want {
		if declared[platform] != path {
			t.Errorf("manifest executables[%s] = %q, want %q", platform, declared[platform], path)
		}
	}

	// verify-package checks these archive members by name, so the names it
	// knows must be the ones the manifest declares.
	makefile := readDeclaration(t, "Makefile")
	for _, path := range want {
		name := strings.TrimPrefix(path, "server/")
		if !strings.Contains(makefile, name) {
			t.Errorf("Makefile does not build or verify %s, which the manifest declares", name)
		}
	}
}
