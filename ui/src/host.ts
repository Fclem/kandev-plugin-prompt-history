/**
 * The module-scoped host handle plus the `@kandev/plugin-sdk` type re-exports.
 *
 * The types come from the `@kandev/plugin-sdk` `file:` dependency (see
 * `package.json`) rather than being restated here, so `tsc --noEmit`
 * typechecks the panel against the pinned SDK contract. The host handle
 * mirrors `kdlbs/kandev-plugin-voice`: `setHost`/`clearHost` are called by
 * `index.tsx` from `initialize`/`destroy`, and `host`/`maybeHost`/`hostReact`
 * are what `react-shim.ts` and the panel read.
 */
import type { PluginHost } from "@kandev/plugin-sdk";

export type {
  PluginConversationApi,
  PluginConversationAuthor,
  PluginConversationError,
  PluginConversationMessage,
  PluginConversationSort,
  PluginConversationTurn,
  PluginHost,
  PluginI18nApi,
  PluginOpenMessageResult,
  PluginRegistry,
  PluginSessionMessagesQuery,
  PluginSessionMessagesState,
  PluginSessionTurnsState,
  PluginTaskPanelProps,
  PluginUIApi,
  KandevPlugin,
  ResponsiveBreakpoint,
  TaskPanelRegistration,
} from "@kandev/plugin-sdk";

export const PLUGIN_ID = "kandev-plugin-prompt-history";

let current: PluginHost | null = null;

export function setHost(host: PluginHost): void {
  current = host;
}

export function clearHost(): void {
  current = null;
}

export function host(): PluginHost {
  if (!current) {
    throw new Error(`${PLUGIN_ID}: host API used before initialize()`);
  }
  return current;
}

/** Non-throwing variant for teardown paths that may run after `destroy`. */
export function maybeHost(): PluginHost | null {
  return current;
}

export function hostReact(): PluginHost["React"] {
  return host().React;
}
