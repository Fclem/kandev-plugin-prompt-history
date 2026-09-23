/**
 * kandev Prompt History — plugin entry point.
 *
 * Registers the translation catalogs and the parity `prompt-history` task
 * panel. Everything else is host-owned: the Host facade owns the conversation
 * reads and live reconciliation, and `conversation.openMessage` drives the
 * native transcript navigation.
 */
import {
  PLUGIN_ID,
  setHost,
  clearHost,
  type PluginHost,
  type PluginRegistry,
} from "./host";
import { PromptHistoryPanel } from "./panel";
import { CATALOGS } from "./strings";

/** The release version from `manifest.yaml`, inlined by `ui/build.mjs`.
 * Undefined when this module is imported directly (the test suite), where the
 * stylesheet re-point below is exercised against a stubbed global. */
declare const __PLUGIN_VERSION__: string;

/**
 * Pins this plugin's host-injected stylesheets to the running bundle's version.
 *
 * The host injects `ui.styles` as `<link rel="stylesheet" data-plugin-id=…>`
 * with the manifest's bare path, while the bundle it loads *is* versioned
 * (`?v=<version>`, see `toActivePlugin`). The stylesheet URL therefore stayed
 * identical across releases and the browser kept serving the previous
 * release's CSS against the new markup: an updated plugin painted last
 * version's bubble and left the new SVG glyphs unsized (rendered at container
 * width). Re-pointing each of our own links at `?v=<version>` gives the
 * stylesheet the same cache key the bundle already has.
 *
 * Only links the host tagged for this plugin are touched — foreign plugins'
 * stylesheets are never rewritten — and an already-versioned href is left
 * alone so a host that starts versioning style URLs itself stays in charge.
 */
function versionPluginStylesheets(version: string): void {
  if (!version || typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLLinkElement>(`link[rel="stylesheet"][data-plugin-id="${PLUGIN_ID}"]`)
    .forEach((link) => {
      if (link.href.includes("v=")) return;
      link.href = `${link.href}${link.href.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
    });
}

/**
 * A bundled icon component. The registration `icon` accepts a plugin-owned
 * component; no curated history glyph exists, so a string name would fall
 * back to the puzzle glyph. Drawn by hand at 16px to match first-party icons.
 */
function HistoryIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

const plugin = {
  initialize(registry: PluginRegistry, host: PluginHost): void {
    setHost(host);

    // The host injects this plugin's stylesheet before it imports the bundle
    // (see `injectStyles` in the host's `lib/plugins/host.ts`), so our own
    // `<link>` is already in the document here and can be versioned.
    versionPluginStylesheets(typeof __PLUGIN_VERSION__ === "string" ? __PLUGIN_VERSION__ : "");

    // Register the translation catalog. The host requires an English fallback
    // and validates the key shape, message count, and length; a violation
    // throws and aborts every registration.
    registry.registerTranslations(CATALOGS);

    // Register the parity task panel. `titleKey` is resolved by the host
    // through the plugin's translation namespace (falling back to `title`);
    // `mobileEnabled: true` makes the mobile Panels picker and bottom nav offer
    // it; no `visible` predicate, so the host's registrationIsVisible gates
    // both the menu entry and the panel body.
    registry.registerTaskPanel({
      id: "prompt-history",
      title: "Prompt History",
      titleKey: "panelTitle",
      mobileEnabled: true,
      icon: HistoryIcon,
      Component: PromptHistoryPanel,
    });
  },

  destroy(): void {
    // The host bulk-unregisters everything under this plugin's id; this clears
    // the module-scoped host handle so a same-tab disable/enable cycle starts
    // clean rather than replaying a stale host.
    clearHost();
  },
};

declare global {
  interface Window {
    registerKandevPlugin?: (id: string, plugin: unknown) => void;
  }
}

window.registerKandevPlugin?.(PLUGIN_ID, plugin);

export default plugin;
