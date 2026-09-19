import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PromptHistoryPanel } from "./panel";
import {
  determinePanelState,
  applyOpenMessageOutcome,
  shouldPaginate,
  type PanelState,
} from "./panel-state";
import { derivePromptHistoryRows, type PromptHistoryRow } from "./derive";
import { TestHostStore, createTestHost, makeMessages, makeTurns } from "./test-host";
import { CATALOGS } from "./strings";
import type {
  PluginConversationMessage,
  PluginSessionMessagesState,
  PluginSessionTurnsState,
  PluginTaskPanelProps,
} from "./host";

// ── Pure panel-state seam ────────────────────────────────────────────────────

describe("determinePanelState", () => {
  const rows = () =>
    makeMessages([
      {
        id: "m",
        taskId: "t",
        sessionId: "s",
        authorType: "user",
        type: "message",
        content: "hi",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);

  it("keeps committed rows for terminal removal and renders zero rows as empty", () => {
    expect(determinePanelState(makeMessages([], { removed: true }), "managed")).toEqual({
      kind: "empty",
    });
    expect(determinePanelState(makeMessages(rows().messages, { removed: true }), "managed")).toEqual({
      kind: "removed",
    });
  });

  it("returns passthrough for a passthrough session kind", () => {
    const state = determinePanelState(makeMessages([]), "passthrough");
    expect(state).toEqual({ kind: "passthrough" });
  });

  it("keeps passthrough unconditional when the session is also removed", () => {
    expect(
      determinePanelState(makeMessages([], { removed: true }), "passthrough"),
    ).toEqual({ kind: "passthrough" });
    expect(
      determinePanelState(makeMessages(rows().messages, { removed: true }), "passthrough"),
    ).toEqual({ kind: "passthrough" });
  });

  it("returns loading for the initial load with no rows", () => {
    const state = determinePanelState(makeMessages([], { loading: true }), "managed");
    expect(state).toEqual({ kind: "loading" });
  });

  it("returns loading for the pinned host's initial unhydrated snapshot", () => {
    const state = determinePanelState(makeMessages([], { hydrated: false }), "managed");
    expect(state).toEqual({ kind: "loading" });
  });

  it("returns error only when no rows are committed", () => {
    const withError = determinePanelState(
      makeMessages([], { error: { code: "upstream_failure", message: "x", retryable: true } }),
      "managed",
    );
    expect(withError).toEqual({ kind: "error" });
    const committed = determinePanelState(
      makeMessages(rows().messages, { error: { code: "upstream_failure", message: "x", retryable: true } }),
      "managed",
    );
    expect(committed.kind).toBe("rows");
  });

  it("returns empty when there are no rows and no hasMore", () => {
    const state = determinePanelState(makeMessages([]), "managed");
    expect(state).toEqual({ kind: "empty" });
  });

  it("stays paginatable when a zero-rows page still has hasMore", () => {
    const state = determinePanelState(makeMessages([], { hasMore: true }), "managed");
    expect(state.kind).toBe("rows");
    if (state.kind === "rows") expect(state.loadingMore).toBe(false);
  });

  it("returns rows with loadingMore while hasMore", () => {
    const state = determinePanelState(
      makeMessages(rows().messages, { hasMore: true, loadingMore: true }),
      "managed",
    );
    expect(state).toEqual({ kind: "rows", loadingMore: true });
  });
});

describe("applyOpenMessageOutcome", () => {
  it("consumes unavailable without error surfacing", () => {
    const state: PanelState = { kind: "rows", loadingMore: false };
    expect(applyOpenMessageOutcome(state, { status: "unavailable" })).toEqual(state);
    expect(applyOpenMessageOutcome(state, { status: "accepted" })).toEqual(state);
  });
});

describe("shouldPaginate", () => {
  it("stops paging when the first prompt (#1) is rendered", () => {
    const withOne: PromptHistoryRow[] = [
      {
        messageId: "m1",
        content: "a",
        sentAt: "2026-01-01T00:00:00Z",
        durationSeconds: null,
        isAgentPrompt: false,
        promptNumber: 1,
      },
    ];
    expect(shouldPaginate(withOne, true)).toBe(false);
  });

  it("pages while hasMore and no rendered entry has promptNumber 1", () => {
    const withoutOne: PromptHistoryRow[] = [
      {
        messageId: "m2",
        content: "a",
        sentAt: "2026-01-01T00:00:00Z",
        durationSeconds: null,
        isAgentPrompt: false,
        promptNumber: 2,
      },
    ];
    expect(shouldPaginate(withoutOne, true)).toBe(true);
    expect(shouldPaginate(withoutOne, false)).toBe(false);
  });
});

// ── Rendered component suite ────────────────────────────────────────────────

function message(overrides: Partial<PluginConversationMessage>): PluginConversationMessage {
  return {
    id: "m",
    taskId: "t",
    sessionId: "s",
    authorType: "user",
    type: "message",
    content: "hi",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

class MockResizeObserver {
  readonly callback: ResizeObserverCallback;
  private targets = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(): void {
    this.targets.clear();
  }
  disconnect(): void {
    this.targets.clear();
  }
  /** Fire the callback for every observed target. */
  flush(): void {
    for (const target of [...this.targets]) {
      this.callback([{ target } as ResizeObserverEntry], this);
    }
  }
}

class MockIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: number[];
  readonly targets = new Set<Element>();
  observeCalls = 0;
  lastTarget: Element | null = null;
  static instances: MockIntersectionObserver[] = [];
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.thresholds = [];
    MockIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
    this.lastTarget = target;
    this.observeCalls += 1;
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Simulate the sentinel entering or leaving the observer root. */
  fire(isIntersecting = true): void {
    const target = [...this.targets][0] ?? this.lastTarget ?? document.body;
    this.callback(
      [{ isIntersecting, target } as unknown as IntersectionObserverEntry],
      this,
    );
  }
}

let resizeObservers: MockResizeObserver[] = [];

beforeEach(() => {
  resizeObservers = [];
  MockIntersectionObserver.instances = [];
  vi.stubGlobal(
    "ResizeObserver",
    class extends MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        resizeObservers.push(this);
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        super(callback, options);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(
  messagesState: PluginSessionMessagesState,
  turnsState: PluginSessionTurnsState,
  overrides: Partial<PluginTaskPanelProps> = {},
) {
  const store = new TestHostStore(messagesState, turnsState);
  const { host } = createTestHost(store);
  const props: PluginTaskPanelProps = {
    taskId: "t",
    sessionId: "s",
    sessionKind: "managed",
    presentation: "desktop",
    panelId: "prompt-history",
    conversation: {
      openMessage: (messageId: string) => {
        store.openedMessageIds.push(messageId);
        return store.openMessageResult;
      },
      history: host.conversation,
    },
    ...overrides,
  };
  const rendered = render(<PromptHistoryPanel {...props} />);
  const scroller = screen.queryByTestId("ph-plugin-scroll");
  if (scroller) {
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
  }
  return { store, host, props, rerender: rendered.rerender };
}

/** A minimal element rect for the pagination geometry gate, which reads only
 * `top` and `bottom`. */
function rect(top: number, bottom: number): DOMRect {
  return { top, bottom } as unknown as DOMRect;
}

function revealOverflowToggle(textContent: string): void {
  const mention = [...document.querySelectorAll("[data-ph-mention]")].find(
    (node) => node.textContent === textContent,
  );
  const text = mention?.parentElement;
  if (!(text instanceof HTMLSpanElement)) {
    throw new Error("expected prompt mention wrapper");
  }
  Object.defineProperty(text, "scrollWidth", { configurable: true, value: 200 });
  Object.defineProperty(text, "clientWidth", { configurable: true, value: 100 });
  act(() => {
    for (const observer of resizeObservers) observer.flush();
  });
}

describe("PromptHistoryPanel", () => {
  it("renders the initial loading state", () => {
    renderPanel(makeMessages([], { loading: true }), makeTurns([]));
    const loading = screen.getByText("Loading...");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.getAttribute("aria-live")).toBe("polite");
  });

  it("attaches scroll measurement when loading transitions to rows", () => {
    const row = message({ id: "m", content: "page", promptIndex: 2 });
    const { store } = renderPanel(
      makeMessages([], { loading: true }),
      makeTurns([]),
    );

    act(() => {
      store.setMessages(
        makeMessages([row], { hasMore: true, loadingMore: true }),
      );
    });
    const scroller = screen.getByTestId("ph-plugin-scroll");
    const rows = scroller.querySelector(".ph-plugin-rows");
    if (!(rows instanceof HTMLDivElement)) throw new Error("expected rows wrapper");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 200 });

    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });

    expect(screen.getByTestId("ph-plugin-loading-older-floating")).toBeTruthy();
  });

  it("tracks expanded-row height after loading transitions to rows", () => {
    const row = message({ id: "m", content: "long prompt", promptIndex: 2 });
    const { store } = renderPanel(
      makeMessages([], { loading: true }),
      makeTurns([]),
    );
    const initialRoot = screen.getByTestId("ph-plugin-panel");
    Object.defineProperty(initialRoot, "clientHeight", { configurable: true, value: 100 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
      store.setMessages(makeMessages([row]));
    });

    const rowsRoot = screen.getByTestId("ph-plugin-panel");
    Object.defineProperty(rowsRoot, "clientHeight", { configurable: true, value: 500 });
    revealOverflowToggle("long prompt");
    act(() => {
      screen.getByTestId("ph-plugin-expand-0").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(screen.getByTestId("ph-plugin-expanded-box-0").style.maxHeight).toBe("200px");
  });

  it("renders no duration before the turns hydrate", () => {
    const single = message({
      id: "m",
      content: "prompt",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "turn",
    });
    renderPanel(
      makeMessages([single]),
      makeTurns(
        [
          {
            id: "turn",
            taskId: "t",
            sessionId: "s",
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:03Z",
            updatedAt: "2026-01-01T00:00:03Z",
          },
        ],
        { hydrated: false },
      ),
    );

    expect(screen.queryByTestId("ph-plugin-duration-0")).toBeNull();
  });

  it("renders no sentinel on an exhausted page that lacks the first prompt", () => {
    renderPanel(
      makeMessages(
        [
          message({
            id: "m",
            content: "prompt",
            createdAt: "2026-01-01T00:00:05Z",
            promptIndex: 5,
          }),
        ],
        { hasMore: false },
      ),
      makeTurns([]),
    );

    expect(screen.queryByTestId("ph-plugin-sentinel")).toBeNull();
  });

  it("stops paginating once the first prompt is rendered", async () => {
    const loadMore = vi.fn().mockResolvedValue(1);
    renderPanel(
      makeMessages(
        [
          message({
            id: "m",
            content: "prompt",
            createdAt: "2026-01-01T00:00:05Z",
            promptIndex: 1,
          }),
        ],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    expect(screen.queryByTestId("ph-plugin-sentinel")).toBeNull();

    const scroller = screen.getByTestId("ph-plugin-scroll");
    await act(async () => {
      scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      await Promise.resolve();
    });

    expect(loadMore).not.toHaveBeenCalled();
  });

  it("renders the panel's copy from the active locale's catalog", () => {
    const { store, props, rerender } = renderPanel(
      makeMessages([], { loading: true }),
      makeTurns([]),
    );
    act(() => {
      store.locale = "pt-pt";
      rerender(<PromptHistoryPanel {...props} />);
    });
    expect(screen.getByText(CATALOGS["pt-pt"].loading)).toBeTruthy();

    act(() => {
      store.setMessages(
        makeMessages([], {
          error: { code: "upstream_failure", message: "x", retryable: true },
        }),
      );
    });
    expect(screen.getByText(CATALOGS["pt-pt"].error)).toBeTruthy();
    expect(screen.getByTestId("ph-plugin-retry").textContent).toBe(CATALOGS["pt-pt"].retry);

    act(() => {
      store.setMessages(
        makeMessages([message({ id: "m", content: "prompt", promptIndex: 2 })], {
          hasMore: true,
        }),
      );
    });
    expect(screen.getByTestId("ph-plugin-scroll").getAttribute("aria-label")).toBe(
      CATALOGS["pt-pt"].panelTitle,
    );
  });

  it("renders the empty state when there are no prompts", () => {
    renderPanel(makeMessages([]), makeTurns([]));
    const empty = screen.getByText("No prompts yet.");
    expect(empty.getAttribute("role")).toBe("status");
    expect(empty.getAttribute("aria-live")).toBe("polite");
  });

  it("hides rows and controls for passthrough sessions", () => {
    const single = message({ id: "m", content: "hidden prompt", createdAt: "2026-01-01T00:00:00Z" });
    renderPanel(
      makeMessages([single], { loading: true, hasMore: true }),
      makeTurns([]),
      { sessionKind: "passthrough" },
    );

    const passthrough = screen.getByText("No prompts yet.");
    expect(passthrough.getAttribute("role")).toBe("status");
    expect(passthrough.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector('[data-message-id="m"]')).toBeNull();
    expect(screen.queryByTestId("ph-plugin-sentinel")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the retry surface on error and re-runs recovery on retry", () => {
    const retry = vi.fn();
    renderPanel(
      makeMessages([], { error: { code: "upstream_failure", message: "x", retryable: true }, retry }),
      makeTurns([]),
    );
    const error = screen.getByText("Error");
    expect(error.getAttribute("role")).toBe("status");
    expect(error.getAttribute("aria-live")).toBe("polite");
    const retryButton = screen.getByTestId("ph-plugin-retry");
    expect(retryButton.textContent).toBe("Retry");
    act(() => {
      retryButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(retry).toHaveBeenCalled();
  });

  it("renders user-prompt rows with ordinals, agent flags, send time, and durations", () => {
    const newest = message({
      id: "newest",
      content: "newest prompt",
      createdAt: "2026-01-01T00:00:02Z",
      turnId: "tn",
      promptIndex: 2,
      senderTaskId: "other",
    });
    const older = message({
      id: "older",
      content: "older prompt",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "to",
      promptIndex: 1,
    });
    renderPanel(
      makeMessages([newest, older], { hasMore: false }),
      makeTurns([
        {
          id: "tn",
          taskId: "t",
          sessionId: "s",
          startedAt: "2026-01-01T00:00:02Z",
          completedAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:05Z",
        },
        {
          id: "to",
          taskId: "t",
          sessionId: "s",
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:00:01Z",
          updatedAt: "2026-01-01T00:00:01Z",
        },
      ]),
    );
    // Newest-first page order is preserved.
    expect(document.querySelector('[data-message-id="newest"]')?.textContent).toContain("newest prompt");
    expect(document.querySelector('[data-message-id="older"]')?.textContent).toContain("older prompt");
    // Ordinal and agent-sent flag.
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    // The ordinal is decorative: the row label already says "Prompt N".
    expect(screen.getByText("#2").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("ph-plugin-navigate-0").getAttribute("aria-label")).toBe("Prompt 2");
    // Only the agent-sent row carries the glyph.
    expect(document.querySelector('[data-message-id="newest"] .ph-plugin-agent-icon')).toBeTruthy();
    expect(document.querySelector('[data-message-id="older"] .ph-plugin-agent-icon')).toBeNull();
    // Send time and duration. Both rows share the test host's fixed relative
    // time, so assert on the count rather than a single match.
    expect(screen.getAllByText("5 minutes ago").length).toBe(2);
    expect(screen.getByText("3s")).toBeTruthy();
    expect(screen.getByText("1s")).toBeTruthy();
  });

  it("adds a duration when a live turn completes", () => {
    const single = message({
      id: "m",
      content: "live prompt",
      createdAt: "2026-01-01T00:00:00Z",
      turnId: "turn",
    });
    const { store } = renderPanel(
      makeMessages([single]),
      makeTurns([
        {
          id: "turn",
          taskId: "t",
          sessionId: "s",
          startedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    expect(screen.queryByText("3s")).toBeNull();
    expect(screen.queryByTestId("ph-plugin-duration-0")).toBeNull();

    act(() => {
      store.setTurns(
        makeTurns([
          {
            id: "turn",
            taskId: "t",
            sessionId: "s",
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:03Z",
            updatedAt: "2026-01-01T00:00:03Z",
          },
        ]),
      );
    });

    expect(screen.getByText("3s")).toBeTruthy();
  });

  it("renders a 0s duration for a sub-second completed turn", () => {
    const single = message({ id: "m", content: "quick prompt", turnId: "turn" });
    renderPanel(
      makeMessages([single]),
      makeTurns([
        {
          id: "turn",
          taskId: "t",
          sessionId: "s",
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );

    expect(screen.getByTestId("ph-plugin-duration-0").textContent).toContain("0s");
  });

  it("keeps a zero-prompt page with more to load paginatable", () => {
    renderPanel(makeMessages([], { hasMore: true }), makeTurns([]));

    expect(screen.getByTestId("ph-plugin-sentinel")).toBeTruthy();
    expect(screen.queryByText("No prompts yet.")).toBeNull();
  });

  it("falls back to a 40vh cap when the panel has no measurable height", () => {
    const single = message({ id: "m", content: "long prompt", promptIndex: 2 });
    renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));
    Object.defineProperty(screen.getByTestId("ph-plugin-panel"), "clientHeight", {
      configurable: true,
      value: 0,
    });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    revealOverflowToggle("long prompt");
    act(() => {
      screen.getByTestId("ph-plugin-expand-0").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(screen.getByTestId("ph-plugin-expanded-box-0").style.maxHeight).toBe("40vh");
  });

  it("keeps expansion attached to its message across a live prepend", () => {
    const older = message({
      id: "older",
      content: "older prompt",
      createdAt: "2026-01-01T00:00:00Z",
      promptIndex: 2,
    });
    const { store } = renderPanel(makeMessages([older], { hasMore: false }), makeTurns([]));
    revealOverflowToggle("older prompt");
    act(() => {
      screen.getByTestId("ph-plugin-expand-0").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(screen.getByTestId("ph-plugin-expanded-box-0").textContent).toContain("older prompt");

    act(() => {
      store.setMessages(
        makeMessages(
          [
            message({
              id: "newer",
              content: "newer prompt",
              createdAt: "2026-01-01T00:00:05Z",
              promptIndex: 3,
            }),
            older,
          ],
          { hasMore: false },
        ),
      );
    });

    // Expansion is keyed by message id, so the box follows its own row to index
    // 1 and nothing expands at index 0.
    expect(screen.queryByTestId("ph-plugin-expanded-box-0")).toBeNull();
    expect(screen.getByTestId("ph-plugin-expanded-box-1").textContent).toContain("older prompt");
  });

  it("renders no ordinal or duration for a row that has neither", () => {
    const bare = message({ id: "bare", content: "no metadata" });
    renderPanel(makeMessages([bare], { hasMore: false }), makeTurns([]));
    const bubble = document.querySelector('[data-message-id="bare"]');
    expect(bubble?.querySelector(".ph-plugin-number")).toBeNull();
    expect(screen.queryByTestId("ph-plugin-duration-0")).toBeNull();
  });

  it("does not list agent-authored messages", () => {
    const userRow = message({
      id: "u",
      content: "user prompt",
      createdAt: "2026-01-01T00:00:02Z",
      promptIndex: 2,
    });
    const agentRow = message({
      id: "a",
      content: "agent prompt",
      createdAt: "2026-01-01T00:00:00Z",
      authorType: "agent",
      promptIndex: 1,
    });
    renderPanel(makeMessages([userRow, agentRow], { hasMore: false }), makeTurns([]));

    expect(document.querySelector('[data-message-id="u"]')).toBeTruthy();
    expect(document.querySelector('[data-message-id="a"]')).toBeNull();
  });

  it("navigates from a native button with prompt content as its description", () => {
    const single = message({ id: "m", content: "open me", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));
    const navigate = screen.getByRole("button", { name: "Prompt" });

    expect(navigate.tagName).toBe("BUTTON");
    const descriptionId = navigate.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe("open me");
    act(() => {
      navigate.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(store.openedMessageIds).toEqual(["m"]);
  });

  it("lets interactive prompt mentions handle pointer and keyboard activation", () => {
    const single = message({
      id: "m",
      content: "@interactive",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const { store } = renderPanel(makeMessages([single]), makeTurns([]));

    act(() => {
      screen.getByTestId("ph-test-mention").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(store.mentionActivations).toBe(1);
    expect(store.openedMessageIds).toEqual([]);

    const mention = screen.getByTestId("ph-test-mention");
    act(() => {
      mention.focus();
      mention.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.activeElement).toBe(mention);
    expect(store.mentionActivations).toBe(2);
    expect(store.openedMessageIds).toEqual([]);

    revealOverflowToggle("@interactive");
    act(() => {
      screen.getByTestId("ph-plugin-expand-0").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const expandedMention = screen
      .getByTestId("ph-plugin-expanded-box-0")
      .querySelector('[data-testid="ph-test-mention"]');
    if (!(expandedMention instanceof HTMLButtonElement)) {
      throw new Error("expected interactive expanded mention");
    }
    act(() => {
      expandedMention.focus();
      expandedMention.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(store.mentionActivations).toBe(3);
    expect(store.openedMessageIds).toEqual([]);

    act(() => {
      document.querySelector('[data-message-id="m"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(store.openedMessageIds).toEqual(["m"]);
  });

  it("does not retry disarmed pagination from nested touch controls", async () => {
    const row = message({
      id: "m",
      content: "@interactive",
      promptIndex: 2,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const loadMore = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    renderPanel(
      makeMessages([row], { hasMore: true, loadMore }),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    revealOverflowToggle("@interactive");
    const nestedControls = [
      screen.getByTestId("ph-test-mention"),
      screen.getByTestId("ph-plugin-expand-0"),
      screen.getByTestId("ph-plugin-navigate-0"),
    ];
    for (const control of nestedControls) {
      act(() => {
        control.dispatchEvent(new Event("touchstart", { bubbles: true }));
      });
    }
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps the current rows when navigation reports an unavailable target", () => {
    const single = message({ id: "m", content: "stay here", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(makeMessages([single]), makeTurns([]));
    store.openMessageResult = { status: "unavailable" };

    act(() => {
      screen.getByRole("button", { name: "Prompt" }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(store.openedMessageIds).toEqual(["m"]);
    expect(document.querySelector('[data-message-id="m"]')?.textContent).toContain("stay here");
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("only offers expansion for overflowing text and collapses it again", () => {
    const single = message({ id: "m", content: "a long prompt", createdAt: "2026-01-01T00:00:00Z" });
    renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));
    Object.defineProperty(screen.getByTestId("ph-plugin-panel"), "clientHeight", {
      configurable: true,
      value: 500,
    });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    expect(screen.queryByTestId("ph-plugin-expand-0")).toBeNull();

    revealOverflowToggle("a long prompt");
    const expand = screen.getByTestId("ph-plugin-expand-0");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.getAttribute("aria-label")).toBe("Expand prompt");
    act(() => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(expand.getAttribute("aria-label")).toBe("Collapse prompt");
    expect(screen.getByTestId("ph-plugin-expanded-box-0").style.maxHeight).toBe("200px");

    // While expanded the truncated span is display:none, so a real browser
    // measures it as 0 wide; the control must survive that or the row can
    // never be collapsed again.
    const text = document.querySelector("[data-ph-mention]")?.parentElement;
    if (!(text instanceof HTMLSpanElement)) throw new Error("expected prompt mention wrapper");
    Object.defineProperty(text, "scrollWidth", { configurable: true, value: 0 });
    Object.defineProperty(text, "clientWidth", { configurable: true, value: 0 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });

    const stillExpandable = screen.getByTestId("ph-plugin-expand-0");
    expect(stillExpandable.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      stillExpandable.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.queryByTestId("ph-plugin-expanded-box-0")).toBeNull();
  });

  it("does not auto-load older prompts while the host is loading", async () => {
    const loadMore = vi.fn().mockResolvedValue(1);
    renderPanel(
      makeMessages([message({ id: "m", content: "page", promptIndex: 2 })], {
        hasMore: true,
        loading: true,
        loadMore,
      }),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(loadMore).not.toHaveBeenCalled();
  });

  it("does not retry disarmed pagination from nested row controls", async () => {
    const row = message({ id: "m", content: "page", promptIndex: 2 });
    const loadMore = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    renderPanel(makeMessages([row], { hasMore: true, loadMore }), makeTurns([]));
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByTestId("ph-plugin-navigate-0").dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      );
    });

    expect(loadMore).toHaveBeenCalledTimes(1);

    // A click on a row control is not a scroll-intent retry either.
    act(() => {
      screen.getByTestId("ph-plugin-navigate-0").dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
      document.querySelector('[data-message-id="m"]')?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(loadMore).toHaveBeenCalledTimes(1);

    // The scroller itself still is.
    await act(async () => {
      screen.getByTestId("ph-plugin-scroll").dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it("renders the newest prompt first regardless of the seeded order", () => {
    const newer = message({
      id: "newer",
      content: "second prompt",
      createdAt: "2026-01-01T00:00:05Z",
      promptIndex: 2,
    });
    const older = message({
      id: "older",
      content: "first prompt",
      createdAt: "2026-01-01T00:00:00Z",
      promptIndex: 1,
    });
    // Seeded oldest-first: the query's `desc` sort, not the array order,
    // decides the rendering order.
    renderPanel(makeMessages([older, newer], { hasMore: false }), makeTurns([]));

    const rendered = [...document.querySelectorAll("[data-message-id]")].map((bubble) =>
      bubble.getAttribute("data-message-id"),
    );
    expect(rendered).toEqual(["newer", "older"]);
  });

  it("reports the prompt's send time rather than its update time", () => {
    const single = message({
      id: "m",
      content: "edited prompt",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-02-02T00:00:00Z",
    });
    renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));

    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it("names the focusable scroll region", () => {
    renderPanel(
      makeMessages([message({ id: "m", content: "page", promptIndex: 2 })], { hasMore: true }),
      makeTurns([]),
    );

    const scroller = screen.getByTestId("ph-plugin-scroll");
    expect(scroller.getAttribute("aria-label")).toBe("Prompt History");
    expect(scroller.tabIndex).toBe(0);
  });

  it("lists only the prompts of the panel's own session", () => {
    const mine = message({
      id: "mine",
      sessionId: "s",
      content: "my prompt",
      createdAt: "2026-01-01T00:00:00Z",
      promptIndex: 2,
    });
    const other = message({
      id: "other",
      sessionId: "other",
      content: "their prompt",
      createdAt: "2026-01-01T00:00:05Z",
      promptIndex: 3,
    });
    renderPanel(makeMessages([mine, other], { hasMore: false }), makeTurns([]));

    expect(document.querySelector('[data-message-id="mine"]')).toBeTruthy();
    expect(document.querySelector('[data-message-id="other"]')).toBeNull();
  });

  it("describes each row's navigate control with that row's own prompt", () => {
    const newer = message({
      id: "newer",
      content: "second prompt",
      createdAt: "2026-01-01T00:00:05Z",
      promptIndex: 2,
    });
    const older = message({
      id: "older",
      content: "first prompt",
      createdAt: "2026-01-01T00:00:00Z",
      promptIndex: 1,
    });
    renderPanel(makeMessages([older, newer], { hasMore: false }), makeTurns([]));

    for (const [index, content] of ["second prompt", "first prompt"].entries()) {
      const navigate = screen.getByTestId(`ph-plugin-navigate-${index}`);
      const descriptionId = navigate.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(content);
    }
  });

  it("labels minute and hour durations from the catalog", () => {
    const single = message({ id: "m", content: "long prompt", turnId: "turn" });
    renderPanel(
      makeMessages([single]),
      makeTurns([
        {
          id: "turn",
          taskId: "t",
          sessionId: "s",
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T01:01:05Z",
          updatedAt: "2026-01-01T01:01:05Z",
        },
      ]),
    );

    expect(screen.getByTestId("ph-plugin-duration-0").textContent).toContain("1h 1m 5s");
  });

  it("renders one page of twenty prompts", () => {
    const seeded = Array.from({ length: 25 }, (_value, index) =>
      message({
        id: `p${index + 2}`,
        content: `prompt ${index + 2}`,
        createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
        promptIndex: index + 2,
      }),
    );
    renderPanel(makeMessages(seeded, { hasMore: true }), makeTurns([]));

    expect(document.querySelectorAll("[data-message-id]")).toHaveLength(20);
    // The newest page: the oldest seeded prompt is beyond it.
    expect(document.querySelector('[data-message-id="p26"]')).toBeTruthy();
    expect(document.querySelector('[data-message-id="p2"]')).toBeNull();
  });

  it("highlights favorited prompt bubbles via the host favorite state", () => {
    const single = message({ id: "m", content: "hi", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));
    const bubble = document.querySelector('[data-message-id="m"]');
    expect(bubble?.className).not.toContain("ph-plugin-favorite");
    act(() => {
      store.setFavorite("m", true);
    });
    expect(document.querySelector('[data-message-id="m"]')?.className).toContain("ph-plugin-favorite");
  });

  it("re-measures overflow when live prompt content changes", () => {
    const short = message({ id: "m", content: "short", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(makeMessages([short], { hasMore: false }), makeTurns([]));
    const text = document.querySelector("[data-ph-mention]")?.parentElement;
    if (!(text instanceof HTMLSpanElement)) throw new Error("expected prompt mention wrapper");
    Object.defineProperty(text, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(text, "scrollWidth", {
      configurable: true,
      get: () => (text.textContent?.length ?? 0) * 10,
    });
    expect(screen.queryByTestId("ph-plugin-expand-0")).toBeNull();

    act(() => {
      store.setMessages(
        makeMessages(
          [message({ id: "m", content: "this prompt is now much longer", createdAt: short.createdAt })],
          { hasMore: false },
        ),
      );
    });

    expect(screen.getByTestId("ph-plugin-expand-0")).toBeTruthy();
  });

  it("re-arms positive pagination and keeps a bottom-pinned user at the new bottom", async () => {
    let scrollHeight = 200;
    const loadMore = vi.fn(async () => {
      scrollHeight += 100;
      return 1;
    });
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100, writable: true });
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(300);
    expect(observer.observeCalls).toBeGreaterThan(1);

    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(2);
    expect(scroller.scrollTop).toBe(400);
  });

  it("does not restore the bottom after the user scrolls away during a page load", async () => {
    let resolveLoad: ((count: number) => void) | undefined;
    let scrollHeight = 200;
    const loadMore = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100, writable: true });
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    act(() => {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
    });
    scrollHeight = 300;
    await act(async () => {
      resolveLoad?.(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(scroller.scrollTop).toBe(0);
  });

  it("keeps a bottom-pinned user at the bottom when the final page removes the sentinel", async () => {
    let scrollHeight = 200;
    let store: TestHostStore | undefined;
    const finalMessages = Array.from({ length: 21 }, (_, index) =>
      message({
        id: `m-${index}`,
        content: `prompt ${index}`,
        promptIndex: 21 - index,
        createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
      }),
    );
    const loadMore = vi.fn().mockResolvedValue(20);
    ({ store } = renderPanel(
      makeMessages([message({ id: "m", content: "page", promptIndex: 22 })], {
        hasMore: true,
        loadMore,
      }),
      makeTurns([]),
    ));
    const scroller = screen.getByTestId("ph-plugin-scroll");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100, writable: true });
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ph-plugin-sentinel")).toBeTruthy();

    act(() => {
      scrollHeight = 2200;
      store?.setMessages(makeMessages(finalMessages, { hasMore: false, loadMore }));
    });

    expect(screen.queryByTestId("ph-plugin-sentinel")).toBeNull();
    expect(scroller.scrollTop).toBe(2200);
  });

  it("does not load while the sentinel sits outside the preload band", async () => {
    const loadMore = vi.fn().mockResolvedValue(1);
    renderPanel(
      makeMessages([message({ id: "m", content: "page", promptIndex: 2 })], {
        hasMore: true,
        loadMore,
      }),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    const sentinel = screen.getByTestId("ph-plugin-sentinel");
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    // 800px below a 100px-tall scroller: far outside the preload band.
    scroller.getBoundingClientRect = () => rect(0, 100);
    sentinel.getBoundingClientRect = () => rect(900, 920);
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).not.toHaveBeenCalled();

    // Inside the band, the same trigger loads.
    sentinel.getBoundingClientRect = () => rect(90, 110);
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("configures the sentinel's preload band below the scroller", () => {
    renderPanel(
      makeMessages([message({ id: "m", content: "page", promptIndex: 2 })], { hasMore: true }),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    expect(observer.rootMargin).toBe("0px 0px 200px 0px");
    expect(observer.options.root).toBe(screen.getByTestId("ph-plugin-scroll"));
  });

  it("does not load from stale hidden geometry and rechecks when the panel is restored", async () => {
    const loadMore = vi.fn().mockResolvedValue(1);
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 0 });
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    observer.fire();
    expect(loadMore).not.toHaveBeenCalled();

    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    // Restored just below the fold but inside the 200px preload band, the
    // recheck must still preload.
    scroller.getBoundingClientRect = () => rect(0, 100);
    screen.getByTestId("ph-plugin-sentinel").getBoundingClientRect = () => rect(250, 270);
    await act(async () => {
      for (const resizeObserver of resizeObservers) resizeObserver.flush();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("drops a queued geometry recheck when the active session changes", async () => {
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (_frame: number) => {});

    const loadA = vi.fn().mockResolvedValue(1);
    const loadB = vi.fn().mockResolvedValue(1);
    const { store, props, rerender } = renderPanel(
      makeMessages(
        [message({ id: "a", sessionId: "a", content: "session a", promptIndex: 2 })],
        { hasMore: true, loadMore: loadA },
      ),
      makeTurns([]),
      { sessionId: "a" },
    );
    const frameA = frames.get(1);
    if (!frameA) throw new Error("expected session A recheck frame");

    act(() => {
      store.setMessages(
        makeMessages(
          [message({ id: "b", sessionId: "b", content: "session b", promptIndex: 2 })],
          { hasMore: true, loadMore: loadB },
        ),
      );
      rerender(<PromptHistoryPanel {...props} sessionId="b" />);
    });

    await act(async () => {
      frameA(0);
      await Promise.resolve();
    });
    expect(loadA).not.toHaveBeenCalled();
    expect(loadB).not.toHaveBeenCalled();

    const frameB = frames.get(nextFrame);
    if (!frameB || frameB === frameA) throw new Error("expected session B recheck frame");
    await act(async () => {
      frameB(0);
      await Promise.resolve();
    });
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("does not issue pagination while an external older-page load is active", async () => {
    const loadMore = vi.fn().mockResolvedValue(1);
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadingMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(loadMore).not.toHaveBeenCalled();
  });

  it("retries disarmed pagination through keyboard and scrollbar gestures", async () => {
    const loadMore = vi.fn().mockResolvedValue(0);
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    const scroller = screen.getByTestId("ph-plugin-scroll");
    expect(scroller.tabIndex).toBe(0);
    // Every key the scroller declares is a retry gesture; each zero-progress
    // page leaves the pagination disarmed, so each press retries exactly once.
    const keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
    for (const [index, key] of keys.entries()) {
      await act(async () => {
        scroller.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        await Promise.resolve();
      });
      expect(loadMore).toHaveBeenCalledTimes(index + 2);
    }

    // A key outside the declared set is not a retry gesture.
    await act(async () => {
      scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(keys.length + 1);

    await act(async () => {
      scroller.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(keys.length + 2);

    // A pen tap has no touch fallback either, so it retries like a mouse
    // click; only touch defers to its own handler.
    await act(async () => {
      const penDown = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(penDown, "pointerType", { value: "pen" });
      scroller.dispatchEvent(penDown);
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(keys.length + 3);
  });

  it("issues one older-page load per touch tap on the scroller", async () => {
    const loadMore = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    // A touch tap reaches the scroller as `pointerdown` with `pointerType`
    // "touch" followed by `touchstart`; the pair is one retry gesture, so a
    // zero-progress page must not be retried twice for a single tap.
    const scroller = screen.getByTestId("ph-plugin-scroll");
    await act(async () => {
      const pointerDown = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
      scroller.dispatchEvent(pointerDown);
      await Promise.resolve();
    });
    await act(async () => {
      scroller.dispatchEvent(new Event("touchstart", { bubbles: true }));
      await Promise.resolve();
    });

    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it("keeps reactive zero-progress pagination disarmed after loading settles", async () => {
    const row = message({ id: "m", content: "page", promptIndex: 2 });
    let store: TestHostStore | undefined;
    const loadMore = vi.fn(async () => {
      store?.setMessages(
        makeMessages([row], { hasMore: true, loadingMore: true, loadMore }),
      );
      await Promise.resolve();
      store?.setMessages(
        makeMessages([row], { hasMore: true, loadingMore: false, loadMore }),
      );
      return 0;
    });
    ({ store } = renderPanel(
      makeMessages([row], { hasMore: true, loadMore }),
      makeTurns([]),
    ));
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("re-arms pagination when the disarmed sentinel leaves and re-enters", async () => {
    const loadMore = vi.fn().mockResolvedValue(0);
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadMore },
      ),
      makeTurns([]),
    );
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("expected pagination observer");

    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    // Still intersecting while disarmed: the zero-progress page is not retried.
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);

    // An observed exit clears the disarm, so the next re-entry loads again.
    act(() => {
      observer.fire(false);
    });
    await act(async () => {
      observer.fire();
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it("re-arms the sentinel after each settled page", async () => {
    // The panel forces a fresh observation after every settle (`unobserve`
    // before the load, `observe` after), because IntersectionObserver only
    // notifies on an intersection-state change: a bottom-pinned panel whose
    // sentinel never leaves the band would otherwise stop after one page.
    // MockIntersectionObserver cannot see that, so this case installs a
    // spec-faithful observer and keeps the frame-driven recheck off the clock.
    class SpecIntersectionObserver {
      private readonly callback: IntersectionObserverCallback;
      private readonly targets = new Set<Element>();
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element): void {
        if (this.targets.has(target)) return;
        this.targets.add(target);
        queueMicrotask(() => {
          if (!this.targets.has(target)) return;
          this.callback(
            [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        });
      }
      unobserve(target: Element): void {
        this.targets.delete(target);
      }
      disconnect(): void {
        this.targets.clear();
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.useFakeTimers();
    try {
      vi.stubGlobal("IntersectionObserver", SpecIntersectionObserver);
      const loadMore = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0);
      renderPanel(
        makeMessages(
          [message({ id: "m", content: "page", promptIndex: 5 })],
          { hasMore: true, loadMore },
        ),
        makeTurns([]),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // The initial observation, then the forced re-arm of the settled page.
      expect(loadMore).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry disarmed pagination from a role-based or link mention", async () => {
    const markers: readonly (readonly [string, string])[] = [
      ["@rolebutton", "ph-test-mention-role"],
      ["@link", "ph-test-mention-link"],
      ["@rolelink", "ph-test-mention-role-link"],
    ];
    for (const [content, testId] of markers) {
      const loadMore = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      renderPanel(
        makeMessages(
          [
            message({
              id: "m",
              content,
              promptIndex: 2,
              createdAt: "2026-01-01T00:00:00Z",
            }),
          ],
          { hasMore: true, loadMore },
        ),
        makeTurns([]),
      );
      const observer = MockIntersectionObserver.instances.at(-1);
      if (!observer) throw new Error("expected pagination observer");
      await act(async () => {
        observer.fire();
        await Promise.resolve();
      });
      expect(loadMore).toHaveBeenCalledTimes(1);

      act(() => {
        screen.getByTestId(testId).dispatchEvent(new Event("touchstart", { bubbles: true }));
      });
      expect(loadMore).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("resets a zero-progress disarm when the active session changes", async () => {
    const loadA = vi.fn().mockResolvedValue(0);
    const loadB = vi.fn().mockResolvedValue(1);
    const { store, props, rerender } = renderPanel(
      makeMessages(
        [message({ id: "a", sessionId: "a", content: "session a", promptIndex: 2 })],
        { hasMore: true, loadMore: loadA },
      ),
      makeTurns([]),
      { sessionId: "a" },
    );
    const observerA = MockIntersectionObserver.instances.at(-1);
    if (!observerA) throw new Error("expected session A observer");
    await act(async () => {
      observerA.fire();
      await Promise.resolve();
    });
    expect(loadA).toHaveBeenCalledTimes(1);

    act(() => {
      store.setMessages(
        makeMessages(
          [message({ id: "b", sessionId: "b", content: "session b", promptIndex: 2 })],
          { hasMore: true, loadMore: loadB },
        ),
      );
      rerender(<PromptHistoryPanel {...props} sessionId="b" />);
    });
    const observerB = MockIntersectionObserver.instances.at(-1);
    if (!observerB || observerB === observerA) throw new Error("expected session B observer");
    await act(async () => {
      observerB.fire();
      await Promise.resolve();
    });
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("ignores an older session pagination result after switching sessions", async () => {
    let resolveA: ((count: number) => void) | undefined;
    const loadA = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveA = resolve;
        }),
    );
    const loadB = vi.fn().mockResolvedValue(1);
    const { store, props, rerender } = renderPanel(
      makeMessages(
        [message({ id: "a", sessionId: "a", content: "session a", promptIndex: 2 })],
        { hasMore: true, loadMore: loadA },
      ),
      makeTurns([]),
      { sessionId: "a" },
    );
    const observerA = MockIntersectionObserver.instances.at(-1);
    if (!observerA) throw new Error("expected session A observer");
    await act(async () => {
      observerA.fire();
      await Promise.resolve();
    });

    act(() => {
      store.setMessages(
        makeMessages(
          [message({ id: "b", sessionId: "b", content: "session b", promptIndex: 2 })],
          { hasMore: true, loadMore: loadB },
        ),
      );
      rerender(<PromptHistoryPanel {...props} sessionId="b" />);
    });
    const observerB = MockIntersectionObserver.instances.at(-1);
    if (!observerB || observerB === observerA) throw new Error("expected session B observer");
    await act(async () => {
      resolveA?.(0);
      await Promise.resolve();
      observerB.fire();
      await Promise.resolve();
    });
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("ignores queued intersection callbacks from a replaced session observer", async () => {
    const loadA = vi.fn().mockResolvedValue(1);
    const loadB = vi.fn().mockResolvedValue(1);
    const { store, props, rerender } = renderPanel(
      makeMessages(
        [message({ id: "a", sessionId: "a", content: "session a", promptIndex: 2 })],
        { hasMore: true, loadMore: loadA },
      ),
      makeTurns([]),
      { sessionId: "a" },
    );
    const observerA = MockIntersectionObserver.instances.at(-1);
    if (!observerA) throw new Error("expected session A observer");

    act(() => {
      store.setMessages(
        makeMessages(
          [message({ id: "b", sessionId: "b", content: "session b", promptIndex: 2 })],
          { hasMore: true, loadMore: loadB },
        ),
      );
      rerender(<PromptHistoryPanel {...props} sessionId="b" />);
    });
    const observerB = MockIntersectionObserver.instances.at(-1);
    if (!observerB || observerB === observerA) throw new Error("expected session B observer");

    await act(async () => {
      observerA.fire();
      await Promise.resolve();
    });
    expect(loadA).not.toHaveBeenCalled();
    expect(loadB).not.toHaveBeenCalled();

    await act(async () => {
      observerB.fire();
      await Promise.resolve();
    });
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("replays eligible pagination after an in-flight same-session host rebind", async () => {
    let resolveStale: ((count: number) => void) | undefined;
    const staleLoad = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveStale = resolve;
        }),
    );
    const currentLoad = vi.fn().mockResolvedValue(1);
    const row = message({ id: "m", content: "same session", promptIndex: 2 });
    const { store } = renderPanel(
      makeMessages([row], { hasMore: true, loadMore: staleLoad }),
      makeTurns([]),
    );
    const staleObserver = MockIntersectionObserver.instances.at(-1);
    if (!staleObserver) throw new Error("expected stale observer");
    await act(async () => {
      staleObserver.fire();
      await Promise.resolve();
    });

    act(() => {
      store.setMessages(
        makeMessages([row], { hasMore: true, loading: true, loadMore: currentLoad }),
      );
    });
    act(() => {
      store.setMessages(makeMessages([row], { hasMore: true, loadMore: currentLoad }));
    });
    const currentObserver = MockIntersectionObserver.instances.at(-1);
    if (!currentObserver || currentObserver === staleObserver) {
      throw new Error("expected rebound observer");
    }

    await act(async () => {
      currentObserver.fire();
      await Promise.resolve();
    });
    expect(currentLoad).not.toHaveBeenCalled();

    await act(async () => {
      resolveStale?.(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(currentLoad).toHaveBeenCalledTimes(1);
  });

  it("replays a stale rejection once and disarms on a current-generation rejection", async () => {
    let rejectStale: ((reason?: unknown) => void) | undefined;
    const staleLoad = vi.fn(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectStale = reject;
        }),
    );
    const currentLoad = vi
      .fn()
      .mockRejectedValueOnce(new Error("current request failed"))
      .mockResolvedValueOnce(1);
    const row = message({ id: "m", content: "same session", promptIndex: 2 });
    const { store } = renderPanel(
      makeMessages([row], { hasMore: true, loadMore: staleLoad }),
      makeTurns([]),
    );
    const staleObserver = MockIntersectionObserver.instances.at(-1);
    if (!staleObserver) throw new Error("expected stale observer");
    await act(async () => {
      staleObserver.fire();
      await Promise.resolve();
    });

    act(() => {
      store.setMessages(
        makeMessages([row], { hasMore: true, loading: true, loadMore: currentLoad }),
      );
    });
    act(() => {
      store.setMessages(makeMessages([row], { hasMore: true, loadMore: currentLoad }));
    });
    const currentObserver = MockIntersectionObserver.instances.at(-1);
    if (!currentObserver || currentObserver === staleObserver) {
      throw new Error("expected rebound observer");
    }
    await act(async () => {
      currentObserver.fire();
      await Promise.resolve();
    });

    await act(async () => {
      rejectStale?.(new Error("stale request failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(currentLoad).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      currentObserver.fire();
      await Promise.resolve();
    });
    expect(currentLoad).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByTestId("ph-plugin-scroll").dispatchEvent(
        new WheelEvent("wheel", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(currentLoad).toHaveBeenCalledTimes(2);
  });

  it("measures row scrollability without the inline loading indicator", () => {
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadingMore: true },
      ),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    const rows = scroller.querySelector(".ph-plugin-rows");
    if (!(rows instanceof HTMLDivElement)) throw new Error("expected rows wrapper");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 80 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    expect(screen.getByTestId("ph-plugin-loading-older").parentElement).toBe(scroller);
    expect(rows.contains(screen.getByTestId("ph-plugin-loading-older"))).toBe(false);

    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 120 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    expect(screen.getByTestId("ph-plugin-loading-older-floating")).toBeTruthy();
  });

  it("subtracts the scroller padding when measuring scrollability", () => {
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadingMore: true },
      ),
      makeTurns([]),
    );
    const scroller = screen.getByTestId("ph-plugin-scroll");
    const rows = scroller.querySelector(".ph-plugin-rows");
    if (!(rows instanceof HTMLDivElement)) throw new Error("expected rows wrapper");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    scroller.style.paddingTop = "10px";
    scroller.style.paddingBottom = "10px";

    // 90px of content exceeds the 80px content box, so the panel scrolls.
    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 90 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    expect(screen.getByTestId("ph-plugin-loading-older-floating")).toBeTruthy();

    // 80px fits that content box exactly, so it does not.
    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 80 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });
    expect(screen.getByTestId("ph-plugin-loading-older").parentElement).toBe(scroller);
  });

  it("stops rendering the older-page indicator once the session is terminal", () => {
    const single = message({ id: "m", content: "page", promptIndex: 2 });
    renderPanel(
      makeMessages([single], { hasMore: false, loadingMore: true, removed: true }),
      makeTurns([]),
    );

    // The committed row still renders; the unresolvable load does not.
    expect(document.querySelector('[data-message-id="m"]')).toBeTruthy();
    expect(screen.queryByTestId("ph-plugin-loading-older")).toBeNull();
    expect(screen.queryByTestId("ph-plugin-loading-older-floating")).toBeNull();
  });

  it("reports the older-page indicator as a polite live status region", () => {
    renderPanel(
      makeMessages(
        [message({ id: "m", content: "page", promptIndex: 2 })],
        { hasMore: true, loadingMore: true },
      ),
      makeTurns([]),
    );
    const inline = screen.getByTestId("ph-plugin-loading-older");
    expect(inline.getAttribute("role")).toBe("status");
    expect(inline.getAttribute("aria-live")).toBe("polite");
    expect(inline.textContent).toBe(CATALOGS.en.loadingOlderMessages);

    const scroller = screen.getByTestId("ph-plugin-scroll");
    const rows = scroller.querySelector(".ph-plugin-rows");
    if (!(rows instanceof HTMLDivElement)) throw new Error("expected rows wrapper");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(rows, "scrollHeight", { configurable: true, value: 120 });
    act(() => {
      for (const observer of resizeObservers) observer.flush();
    });

    const floating = screen.getByTestId("ph-plugin-loading-older-floating");
    expect(floating.getAttribute("role")).toBe("status");
    expect(floating.getAttribute("aria-live")).toBe("polite");
    expect(floating.textContent).toBe(CATALOGS.en.loadingOlderMessages);
  });

  it("holds the older-page indicator through the loading grace window", async () => {
    const row = message({ id: "m", content: "page", promptIndex: 2 });
    const { store } = renderPanel(
      makeMessages([row], { hasMore: true, loadingMore: true }),
      makeTurns([]),
    );
    expect(screen.getByTestId("ph-plugin-loading-older")).toBeTruthy();

    // The page settles with more still to load: without the grace window the
    // chained re-arm flashes the indicator off and straight back on.
    act(() => {
      store.setMessages(makeMessages([row], { hasMore: true, loadingMore: false }));
    });
    expect(screen.getByTestId("ph-plugin-loading-older")).toBeTruthy();

    // LOADING_GRACE_MS is 400; real timers keep the observer and rAF mocks
    // untouched.
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
    });
    expect(screen.queryByTestId("ph-plugin-loading-older")).toBeNull();
    expect(screen.queryByTestId("ph-plugin-loading-older-floating")).toBeNull();
  });

  it("keeps committed rows visible on terminal removal with pagination stopped", () => {
    const single = message({ id: "m", content: "hi", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(
      makeMessages([single], { hasMore: true }),
      makeTurns([]),
    );
    expect(screen.getByTestId("ph-plugin-sentinel")).toBeTruthy();
    act(() => {
      store.setMessages(makeMessages([single], { hasMore: true, removed: true }));
    });
    // Committed rows stay visible.
    expect(document.querySelector('[data-message-id="m"]')?.textContent).toContain("hi");
    // Pagination stops: the sentinel is gone.
    expect(screen.queryByTestId("ph-plugin-sentinel")).toBeNull();
  });

  it("renders the empty state when terminal removal has no committed rows", () => {
    renderPanel(makeMessages([], { removed: true }), makeTurns([]));
    expect(screen.getByText("No prompts yet.")).toBeTruthy();
    expect(screen.queryByTestId("ph-plugin-scroll")).toBeNull();
  });

  it("renders loading for the pinned host's unhydrated initial snapshot", () => {
    renderPanel(makeMessages([], { hydrated: false }), makeTurns([]));
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("No prompts yet.")).toBeNull();
  });
});
