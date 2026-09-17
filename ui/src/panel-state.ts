/**
 * Pure panel state determination and `openMessage` outcome handling, consumed
 * by `panel.tsx` and tested against `test-host`. Keeping these seams pure
 * (no React) lets the vitest suite assert the state machine without mounting
 * the component.
 */
import type {
  PluginOpenMessageResult,
  PluginSessionMessagesState,
} from "./host";
import type { PromptHistoryRow } from "./derive";

/**
 * The panel's render states:
 * - `removed` - the Host facade's terminal state: committed rows stay visible,
 *   pagination and live updates stop.
 * - `passthrough` - the session kind is passthrough: an unconditional empty
 *   state with no controls (the transcript the arrow would jump to does not
 *   exist).
 * - `loading` - the initial load, no rows committed.
 * - `error` - the load failed with no rows committed: the retry surface. With
 *   committed rows the rows render without a retry affordance.
 * - `empty` - no rows, no `hasMore`: the definitive empty state.
 * - `rows` - rows are present (or the page is paginatable with `hasMore`);
 *   `loadingMore` renders the older-page loading indicator while `hasMore`.
 */
export type PanelState =
  | { kind: "removed" }
  | { kind: "passthrough" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "rows"; loadingMore: boolean };

/**
 * Determine the panel state from the Host messages state and the session kind.
 * Mirrors the core `fetchFailed && entries.length === 0` retry condition and
 * the `emptyEntriesSpec` zero-entries branch: a zero-entries page that still
 * has `hasMore` stays paginatable (sentinel) rather than declaring the session
 * empty.
 */
export function determinePanelState(
  messages: PluginSessionMessagesState,
  sessionKind: "managed" | "passthrough" | null,
): PanelState {
  if (messages.removed) return { kind: "removed" };
  if (sessionKind === "passthrough") return { kind: "passthrough" };
  if (messages.messages.length > 0) {
    return { kind: "rows", loadingMore: messages.loadingMore && messages.hasMore };
  }
  if (messages.loading) return { kind: "loading" };
  if (messages.error) return { kind: "error" };
  if (messages.hasMore) return { kind: "rows", loadingMore: messages.loadingMore && messages.hasMore };
  return { kind: "empty" };
}

/**
 * Handle an `openMessage` outcome. The `unavailable` target is consumed without
 * error surfacing: the panel stays in its current state (no error state, no row
 * change). `accepted` is a no-op success.
 */
export function applyOpenMessageOutcome(
  state: PanelState,
  outcome: PluginOpenMessageResult,
): PanelState {
  void outcome;
  return state;
}

/**
 * Paging stops when the first prompt (`#1`) is rendered: the older-page trigger
 * is active only while `hasMore` and no rendered entry has `promptNumber === 1`.
 */
export function shouldPaginate(rows: readonly PromptHistoryRow[], hasMore: boolean): boolean {
  return hasMore && !rows.some((row) => row.promptNumber === 1);
}
