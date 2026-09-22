/**
 * The shipped-artifact smoke: build `ui/bundle.js` with the repository's own
 * esbuild config, run its host-global registration, initialize it with a host
 * handle, and mount the registered panel under that host's React.
 *
 * Nothing else covers the bundle. The source-level suites import `src/*`
 * directly, so they exercise neither the esbuild aliases (which are what make
 * the bundle share kandev's React instance) nor the registration payload as
 * the host consumes it: dropping the `react` alias from `build.mjs` left the
 * whole suite green while the shipped bundle failed to mount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { TestHostStore, createTestHost, makeMessages, makeTurns } from "./test-host";
import type {
  PluginHost,
  PluginRegistry,
  PluginTaskPanelProps,
  TaskPanelRegistration,
} from "./host";

type RegisteredPlugin = {
  initialize(registry: PluginRegistry, host: PluginHost): void;
};

/** The mounted panel observes both element sizes and sentinel visibility; the
 * smoke asserts markup, so no-op observers are enough (jsdom has neither). */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class NoopIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeRegistry(): { registry: PluginRegistry; panels: TaskPanelRegistration[] } {
  const panels: TaskPanelRegistration[] = [];
  const registry = {
    registerTranslations: (): void => {},
    registerTaskPanel: (registration: TaskPanelRegistration): void => {
      panels.push(registration);
    },
  } as unknown as PluginRegistry;
  return { registry, panels };
}

describe("built bundle", () => {
  it("mounts its registered panel against the host's React instance", async () => {
    // The bundle is built by the suite's global setup, and this import cannot
    // be static for the same reason the other suites import from `src`: its
    // registration runs as a module-evaluation side effect, which is what this
    // case exists to exercise.
    const registered: RegisteredPlugin[] = [];
    window.registerKandevPlugin = (_id, plugin): void => {
      registered.push(plugin as RegisteredPlugin);
    };
    await import("../bundle.js");

    expect(registered).toHaveLength(1);
    const plugin = registered[0];
    if (!plugin) throw new Error("expected the bundle to register its plugin");

    const { registry, panels } = fakeRegistry();
    const store = new TestHostStore(makeMessages([]), makeTurns([]));
    const { host } = createTestHost(store);
    act(() => {
      plugin.initialize(registry, host);
    });

    expect(panels).toHaveLength(1);
    const panel = panels[0];
    if (!panel) throw new Error("expected a panel registration");

    const props: PluginTaskPanelProps = {
      taskId: "t",
      sessionId: "s",
      sessionKind: "managed",
      presentation: "desktop",
      panelId: "prompt-history",
      conversation: {
        openMessage: () => ({ status: "accepted" }),
        history: host.conversation,
      },
    };
    render(React.createElement(panel.Component, props));

    // A rendered state proves the bundle's hooks reached the host React: with
    // its own React copy they throw before any markup appears.
    expect(screen.getByText("No prompts yet.")).toBeTruthy();

    delete window.registerKandevPlugin;
  });
});
