/**
 * Host mock for the vitest suite: fake `useSessionMessages`/`useSessionTurns`
 * state machines, `openMessage` outcomes, `host.ui.PromptMentionText`, and
 * `host.utils.formatRelativeTime`.
 *
 * The conversation state machines are reactive through `useSyncExternalStore`:
 * the fake hooks read a referentially-stable snapshot from the store, and a
 * test calls `store.setMessages`/`setTurns`/`setFavorite` (inside `act`) to
 * mutate and emit, so the panel re-renders exactly as it would against the
 * live Host facade. The store passes the same real `react` module to
 * `setHost` that `panel.tsx` and the renderer resolve, so hook identity holds.
 */
import * as React from "react";
import { setHost } from "./host";
import type {
  PluginHost,
  PluginConversationMessage,
  PluginConversationSort,
  PluginConversationTurn,
  PluginSessionMessagesQuery,
  PluginSessionMessagesState,
  PluginSessionTurnsState,
} from "./host";
import { CATALOGS } from "./strings";

/** Mirrors the pinned facade's `compareConversationMessages`: millisecond
 * comparison, then the nanosecond fraction, then an id tie-break, negated for
 * `desc`. */
function compareMessages(
  left: PluginConversationMessage,
  right: PluginConversationMessage,
  sort: PluginConversationSort,
): number {
  const ordered =
    compareTimestamps(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);
  return sort === "asc" ? ordered : -ordered;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    if (leftMs !== rightMs) return leftMs < rightMs ? -1 : 1;
    return compareStrings(fractionNanoseconds(left), fractionNanoseconds(right));
  }
  return compareStrings(left, right);
}

function fractionNanoseconds(value: string): string {
  return (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "").padEnd(9, "0").slice(0, 9);
}

export class TestHostStore {
  messagesState: PluginSessionMessagesState;
  turnsState: PluginSessionTurnsState;
  favorites = new Set<string>();
  openMessageResult: { status: "accepted" | "unavailable" } = { status: "accepted" };
  openedMessageIds: string[] = [];
  mentionActivations = 0;
  locale = "en";

  private listeners = new Set<() => void>();
  private queryCache = new Map<string, { source: PluginSessionMessagesState; value: PluginSessionMessagesState }>();
  private turnsCache = new Map<string, { source: PluginSessionTurnsState; value: PluginSessionTurnsState }>();

  constructor(messagesState: PluginSessionMessagesState, turnsState: PluginSessionTurnsState) {
    this.messagesState = messagesState;
    this.turnsState = turnsState;
  }

  /** The messages snapshot as the pinned facade would return it for `query`:
   * the session scope, `authorTypes`, `sort` and `pageSize` are the query's
   * observable shaping (the panel relies on the session scope for isolation,
   * on `authorTypes` to exclude agent-authored messages, on `desc` for the
   * newest-first order `derive` assumes, and on the page size for one page of
   * prompts), so the mock applies all four rather than handing back every
   * message in store order. Results are cached per query and source snapshot,
   * keeping the `useSyncExternalStore` snapshot referentially stable. */
  messagesForQuery(query: PluginSessionMessagesQuery): PluginSessionMessagesState {
    const authorTypes = query.authorTypes ?? [];
    const sort = query.sort ?? "desc";
    const key = `${query.sessionId ?? ""}|${sort}|${query.pageSize ?? ""}|${[...authorTypes].join("|")}`;
    const cached = this.queryCache.get(key);
    if (cached && cached.source === this.messagesState) return cached.value;
    const source = this.messagesState;
    const value: PluginSessionMessagesState = {
      ...source,
      messages: source.messages
        .filter((message) => message.sessionId === query.sessionId)
        .filter(
          (message) => authorTypes.length === 0 || authorTypes.includes(message.authorType),
        )
        .sort((left, right) => compareMessages(left, right, sort))
        .slice(0, query.pageSize ?? 20),
    };
    this.queryCache.set(key, { source, value });
    return value;
  }

  /** The turns snapshot for one session, mirroring the facade's per-session
   * read. */
  turnsForSession(sessionId: string | null): PluginSessionTurnsState {
    const key = sessionId ?? "";
    const cached = this.turnsCache.get(key);
    if (cached && cached.source === this.turnsState) return cached.value;
    const source = this.turnsState;
    const value: PluginSessionTurnsState = {
      ...source,
      turns: source.turns.filter((turn) => turn.sessionId === sessionId),
    };
    this.turnsCache.set(key, { source, value });
    return value;
  }

  setMessages(state: PluginSessionMessagesState): void {
    this.messagesState = state;
    this.emit();
  }

  setTurns(state: PluginSessionTurnsState): void {
    this.turnsState = state;
    this.emit();
  }

  setFavorite(messageId: string, favorite: boolean): void {
    if (favorite) this.favorites.add(messageId);
    else this.favorites.delete(messageId);
    this.emit();
  }


  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function makeMessages(
  messages: readonly PluginConversationMessage[],
  overrides: Partial<PluginSessionMessagesState> = {},
): PluginSessionMessagesState {
  const loadMore = () => Promise.resolve(messages.length);
  return {
    messages,
    loading: false,
    hydrated: true,
    loadingMore: false,
    error: null,
    hasMore: false,
    removed: false,
    loadMore,
    retry: () => {},
    ...overrides,
  };
}

function makeTurns(
  turns: readonly PluginConversationTurn[],
  overrides: Partial<PluginSessionTurnsState> = {},
): PluginSessionTurnsState {
  return {
    turns,
    loading: false,
    hydrated: true,
    error: null,
    removed: false,
    retry: () => {},
    ...overrides,
  };
}

export function createTestHost(
  store: TestHostStore,
): { host: PluginHost; store: TestHostStore } {
  const t = (key: string, options?: Record<string, unknown>): string => {
    const catalog: Record<string, string> =
      (CATALOGS as Record<string, Record<string, string>>)[store.locale] ?? (CATALOGS.en as Record<string, string>);
    let value = catalog[key] ?? key;
    const replacements =
      options?.values && typeof options.values === "object" && !Array.isArray(options.values)
        ? (options.values as Record<string, unknown>)
        : {};
    for (const [placeholder, replacement] of Object.entries(replacements)) {
      value = value.split(`{{${placeholder}}}`).join(String(replacement));
    }
    return value;
  };

  // A thin reactive seam over the store: each call subscribes the component
  // to store emissions and reads the current snapshot, mirroring the Host
  // facade's hook reactivity.
  const useStore = <T>(getSnapshot: () => T): T =>
    React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  const host = {
    pluginId: "kandev-plugin-prompt-history",
    React,
    jsx: (React as unknown as { createElement: unknown }).createElement,
    conversation: {
      useSessionMessages: (query: PluginSessionMessagesQuery): PluginSessionMessagesState =>
        useStore(() => store.messagesForQuery(query)),
      useSessionTurns: (
        sessionId: string | null,
        _taskId?: string | null,
      ): PluginSessionTurnsState => useStore(() => store.turnsForSession(sessionId)),
      useMessageFavorite: (_sessionId: string | null, messageId: string): boolean =>
        useStore(() => store.favorites.has(messageId)),
    },
    i18n: {
      get locale() {
        return store.locale;
      },
      t,
      useTranslation: () => ({ locale: store.locale, t }),
    },
    ui: {
      PromptMentionText: ({
        text,
        interactive,
      }: {
        text: string;
        interactive?: boolean;
      }) =>
        React.createElement(
          "span",
          { "data-ph-mention": "true" },
          interactive && text === "@interactive"
            ? React.createElement(
                "button",
                {
                  type: "button",
                  "data-testid": "ph-test-mention",
                  onClick: () => {
                    store.mentionActivations += 1;
                  },
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    store.mentionActivations += 1;
                  },
                },
                text,
              )
            : // The pinned host renders a mention chip as `<button>` only on
              // touch devices; a fine-pointer host (including a touchscreen
              // laptop) renders `<span role="button">`, which the panel's
              // nested-interactive guard must also recognise.
              interactive && text === "@rolebutton"
              ? React.createElement(
                  "span",
                  {
                    role: "button",
                    tabIndex: 0,
                    "data-testid": "ph-test-mention-role",
                    onClick: () => {
                      store.mentionActivations += 1;
                    },
                  },
                  text,
                )
              : text,
        ),
    },
    utils: {
      cn: (...inputs: unknown[]): string => inputs.filter(Boolean).join(" "),
      formatRelativeTime: (_value: string | number | Date): string => "5 minutes ago",
    },
    useResponsiveBreakpoint: () => ({ isMobile: false }),
    theme: "light" as const,
    onThemeChange: (_listener: (theme: "light" | "dark") => void): (() => void) => () => {},
    navigate: (_href: string) => {},
    openModal: (_options: unknown) => ({ close: () => {} }),
    openTaskLinkDialog: (_options: unknown) => ({ close: () => {} }),
    context: {
      current: () => null,
      subscribe: (_listener: unknown) => () => {},
    },
    api: {
      baseUrl: "",
      fetch: (_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)),
      invokeAction: <T>(_key: string) => Promise.resolve(undefined as T),
    },
    store: {
      get: () => undefined,
      set: () => Promise.resolve({ updatedAt: new Date().toISOString() }),
      delete: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      subscribe: () => () => {},
    },
    toast: (message: string) => message,
  } as unknown as PluginHost;

  setHost(host);

  return { host, store };
}

export { makeMessages, makeTurns };
