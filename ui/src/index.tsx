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
