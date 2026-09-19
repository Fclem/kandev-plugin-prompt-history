/**
 * The plugin entry point: the registration payload the host consumes
 * (`registerKandevPlugin`, catalog + task-panel registration) and the
 * `destroy` teardown that clears the module-scoped host handle.
 *
 * Nothing else in the suite imports `index.tsx`, so this is the only place
 * that pins the registered panel id/key, the `mobileEnabled` menu offering,
 * the bundled icon, the catalog set, and the re-enable cleanliness the host's
 * disable/enable cycle depends on.
 */
import { describe, expect, it, vi } from "vitest";
import plugin from "./index";
import { CATALOGS } from "./strings";
import { PLUGIN_ID, maybeHost } from "./host";
import { PromptHistoryPanel } from "./panel";
import type { PluginHost, PluginRegistry, TaskPanelRegistration } from "./host";

function fakeRegistry(): {
  registry: PluginRegistry;
  translations: unknown[];
  panels: TaskPanelRegistration[];
} {
  const translations: unknown[] = [];
  const panels: TaskPanelRegistration[] = [];
  const registry = {
    registerTranslations: (catalogs: unknown): void => {
      translations.push(catalogs);
    },
    registerTaskPanel: (registration: TaskPanelRegistration): void => {
      panels.push(registration);
    },
  } as unknown as PluginRegistry;
  return { registry, translations, panels };
}

describe("plugin entry point", () => {
  it("registers the catalogs and the prompt-history panel, then clears the host on destroy", () => {
    const { registry, translations, panels } = fakeRegistry();

    plugin.initialize(registry, {} as PluginHost);

    expect(translations).toEqual([CATALOGS]);
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    if (!panel) throw new Error("expected a panel registration");
    expect(panel.id).toBe("prompt-history");
    expect(panel.titleKey).toBe("panelTitle");
    expect(panel.title).toBe("Prompt History");
    expect(panel.mobileEnabled).toBe(true);
    expect(panel.Component).toBe(PromptHistoryPanel);
    expect(typeof panel.icon).toBe("function");

    expect(maybeHost()).not.toBeNull();
    plugin.destroy();
    expect(maybeHost()).toBeNull();
  });

  it("registers itself on the host global under the plugin id", async () => {
    vi.resetModules();
    const register = vi.fn<(id: string, plugin: unknown) => void>();
    window.registerKandevPlugin = register;

    // The registration runs during module evaluation, so the module boundary
    // is re-entered here: the static import at the top of this file already
    // ran it, before this spy existed.
    await import("./index");

    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toBe(PLUGIN_ID);
    expect(PLUGIN_ID).toBe("kandev-plugin-prompt-history");
    delete window.registerKandevPlugin;
  });
});
