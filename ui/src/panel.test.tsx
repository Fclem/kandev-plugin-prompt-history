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

  it("returns removed as the terminal state", () => {
    const state = determinePanelState(makeMessages([], { removed: true }), "managed");
    expect(state).toEqual({ kind: "removed" });
  });

  it("returns passthrough for a passthrough session kind", () => {
    const state = determinePanelState(makeMessages([]), "passthrough");
    expect(state).toEqual({ kind: "passthrough" });
  });

  it("returns loading for the initial load with no rows", () => {
    const state = determinePanelState(makeMessages([], { loading: true }), "managed");
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
    const target = [...this.targets][0] ?? document.body;
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
  render(<PromptHistoryPanel {...props} />);
  return { store, host, props };
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
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders the empty state when there are no prompts", () => {
    renderPanel(makeMessages([]), makeTurns([]));
    expect(screen.getByText("No prompts yet.")).toBeTruthy();
  });

  it("renders the retry surface on error and re-runs recovery on retry", () => {
    const retry = vi.fn();
    renderPanel(
      makeMessages([], { error: { code: "upstream_failure", message: "x", retryable: true }, retry }),
      makeTurns([]),
    );
    expect(screen.getByText("Error")).toBeTruthy();
    const retryButton = screen.getByTestId("ph-plugin-retry");
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
    // Send time and duration. Both rows share the test host's fixed relative
    // time, so assert on the count rather than a single match.
    expect(screen.getAllByText("5 minutes ago").length).toBe(2);
    expect(screen.getByText("3s")).toBeTruthy();
    expect(screen.getByText("1s")).toBeTruthy();
  });

  it("navigates from a native button with prompt content as its description", () => {
    const single = message({ id: "m", content: "open me", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(makeMessages([single], { hasMore: false }), makeTurns([]));
    const navigate = screen.getByRole("button", { name: "Prompt" });

    expect(navigate.tagName).toBe("BUTTON");
    expect(navigate.getAttribute("aria-describedby")).toBeTruthy();
    act(() => {
      navigate.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(store.openedMessageIds).toEqual(["m"]);
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
    act(() => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("ph-plugin-expanded-box-0").style.maxHeight).toBe("200px");
    act(() => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("ph-plugin-expanded-box-0")).toBeNull();
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

  it("disarms zero-progress pagination until a user gesture retries it", async () => {
    const loadMore = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
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

    await act(async () => {
      screen.getByTestId("ph-plugin-scroll").dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      await Promise.resolve();
    });
    expect(loadMore).toHaveBeenCalledTimes(2);
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

  it("sizes the expand control by the three-context matrix", () => {
    const single = message({ id: "m", content: "hi", createdAt: "2026-01-01T00:00:00Z" });
    const { store } = renderPanel(
      makeMessages([single], { hasMore: false }),
      makeTurns([]),
    );
    revealOverflowToggle("hi");
    // desktop/tablet + fine pointer: compact (24px).
    const expand = screen.getByTestId("ph-plugin-expand-0");
    expect(expand.className).toContain("ph-plugin-expand-compact");
    // desktop/tablet + coarse pointer: large (44px).
    act(() => {
      store.setBreakpoint({ isMobile: false, isFinePointer: false });
    });
    expect(screen.getByTestId("ph-plugin-expand-0").className).not.toContain("ph-plugin-expand-compact");
    // phone-width + fine pointer: large (44px).
    act(() => {
      store.setBreakpoint({ isMobile: true, isFinePointer: true });
    });
    expect(screen.getByTestId("ph-plugin-expand-0").className).not.toContain("ph-plugin-expand-compact");
  });
});
