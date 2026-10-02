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
	"path/filepath"
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
//
// `config_schema` is deliberately absent from this list: REQ-004 makes the
// operator display settings a required surface, and the host renders it as the
// settings form at Settings > Plugins > Prompt History. TestPanelConfigKeysAgreement
// pins the shape it is allowed to take.
var forbiddenTopLevelKeys = []string{
	"webhooks",
	"actions",
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

// The operator display settings are declared in the manifest's config_schema
// (the host renders them at Settings > Plugins > Prompt History and validates
// what it PATCHes back) and read by ui/src/panel-config.ts from
// GET /api/plugins/<id>/config. A one-sided rename fails silently in the worst
// way: the settings form keeps its control, the panel reads a key nobody
// writes, and the setting appears to do nothing. A missing default is the
// second silent failure — an instance whose config was never saved would
// render the panel's non-default branch instead of its original row.
//
// The order below is the field's order in the manifest *and* in the settings
// form: the `N_` segment exists because the host renders `Object.keys` of the
// schema, which reaches the browser as a JSON object marshalled from a Go map
// (sorted), so the key is the only ordering lever. A renamed or renumbered key
// therefore reorders the form, which is why the expected slice is pinned whole.
var wantPanelConfigKeys = []string{
	"display_1_show_numbers",
	"display_2_show_time",
	"display_3_time_format",
	"display_4_show_duration",
	"display_5_agent_style",
}

// The two selectors: the only non-boolean fields and the only required ones.
const (
	wantPanelDateFormatKey = "display_3_time_format"
	wantPanelAgentStyleKey = "display_5_agent_style"
)

// Every field except the two selectors is a boolean toggle.
var wantPanelBooleanKeys = []string{
	"display_1_show_numbers",
	"display_2_show_time",
	"display_4_show_duration",
}

func TestPanelConfigKeysAgreement(t *testing.T) {
	manifest := readDeclaration(t, "manifest.yaml")
	block := captureDeclaration(t, manifest, `(?m)^config_schema:\n((?:  [^\n]*\n|    [^\n]*\n|      [^\n]*\n)+)`, "manifest.yaml")

	declared := regexp.MustCompile(`(?m)^    (\w+):$`).FindAllStringSubmatch(block, -1)
	if len(declared) != len(wantPanelConfigKeys) {
		t.Fatalf("manifest config_schema declares %d properties, want %d (%v)",
			len(declared), len(wantPanelConfigKeys), wantPanelConfigKeys)
	}
	panelConfig := readDeclaration(t, filepath.Join("ui", "src", "panel-config.ts"))
	for i, want := range wantPanelConfigKeys {
		if got := declared[i][1]; got != want {
			t.Errorf("manifest config_schema property %d = %q, want %q", i, got, want)
		}
		// The reader keys off the literal, so the panel must name the field.
		if !strings.Contains(panelConfig, `"`+want+`"`) {
			t.Errorf("ui/src/panel-config.ts does not reference %q, which the manifest declares", want)
		}
	}

	// The `N_` prefix must be lexicographically ordered too: the host sorts the
	// keys, so a prefix that does not sort with its index would render the form
	// in an order this slice cannot see.
	for i, key := range wantPanelConfigKeys {
		if key[:10] != "display_"+string(rune('1'+i))+"_" {
			t.Errorf("manifest config_schema property %d = %q, want the display_%d_ render-order prefix", i, key, i+1)
		}
	}

	// A boolean without a default would render its off-branch on an instance
	// whose config was never saved; a wrong default would flip the panel's
	// original appearance.
	booleanWithDefault := regexp.MustCompile(`(?m)^      type: boolean\n      default: (true|false)\n`)
	if got := len(booleanWithDefault.FindAllStringSubmatch(block, -1)); got != len(wantPanelBooleanKeys) {
		t.Errorf("manifest config_schema declares %d defaulted booleans, want %d (%v)",
			got, len(wantPanelBooleanKeys), wantPanelBooleanKeys)
	}
	for _, key := range wantPanelBooleanKeys {
		prop := captureDeclaration(t, block, `(?m)^    `+key+`:\n((?:      [^\n]*\n)+)`, "manifest.yaml")
		if !strings.Contains(prop, "default: ") {
			t.Errorf("manifest config_schema %s declares no default", key)
		}
	}
	// The date-format selector must offer exactly the values the reader
	// understands, default to the relative form the reference shows, and be
	// required: requiring it is what removes the host form's "Not set" choice,
	// so a missing `required` silently reintroduces a third, meaningless state.
	dateFormat := captureDeclaration(t, block, `(?m)^    `+wantPanelDateFormatKey+`:\n((?:      [^\n]*\n)+)`, "manifest.yaml")
	if !strings.Contains(dateFormat, `enum: ["relative", "absolute"]`) {
		t.Errorf("manifest config_schema %s enum = %q, want [\"relative\", \"absolute\"]", wantPanelDateFormatKey, dateFormat)
	}
	if !strings.Contains(dateFormat, `default: "relative"`) {
		t.Errorf("manifest config_schema %s does not default to \"relative\"", wantPanelDateFormatKey)
	}
	// The agent-prompt style is the same shape: the three states the reader
	// knows, defaulting to the reference's row, and required for the same
	// reason.
	agentStyle := captureDeclaration(t, block, `(?m)^    `+wantPanelAgentStyleKey+`:\n((?:      [^\n]*\n)+)`, "manifest.yaml")
	if !strings.Contains(agentStyle, `enum: ["normal", "soft grey", "hide"]`) {
		t.Errorf("manifest config_schema %s enum = %q, want [\"normal\", \"soft grey\", \"hide\"]", wantPanelAgentStyleKey, agentStyle)
	}
	if !strings.Contains(agentStyle, `default: "normal"`) {
		t.Errorf("manifest config_schema %s does not default to \"normal\"", wantPanelAgentStyleKey)
	}
	required := captureDeclaration(t, block, `(?m)^  required: (.+)$`, "manifest.yaml")
	wantRequired := `["` + wantPanelDateFormatKey + `", "` + wantPanelAgentStyleKey + `"]`
	if required != wantRequired {
		t.Errorf("manifest config_schema required = %s, want %s", required, wantRequired)
	}
	panelDateFormatLiterals := regexp.MustCompile(`(?m)^export const PANEL_DATE_FORMATS = \["relative", "absolute"\] as const;`)
	if !panelDateFormatLiterals.MatchString(panelConfig) {
		t.Errorf("ui/src/panel-config.ts does not declare PANEL_DATE_FORMATS as the manifest's two values")
	}
	panelAgentStyleLiterals := regexp.MustCompile(`(?m)^export const PANEL_AGENT_PROMPT_STYLES = \["normal", "soft grey", "hide"\] as const;`)
	if !panelAgentStyleLiterals.MatchString(panelConfig) {
		t.Errorf("ui/src/panel-config.ts does not declare PANEL_AGENT_PROMPT_STYLES as the manifest's three values")
	}
}
