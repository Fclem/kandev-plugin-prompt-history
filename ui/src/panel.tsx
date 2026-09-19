/**
 * The Prompt History panel: the production, parity panel registered by this
 * plugin. It lists the active session's user prompts with feature parity to
 * the shipped core panel — user-prompt rows, `#N` ordinals, alias rendering,
 * send time, agent work durations, favorite highlighting, the agent-sent
 * indicator, older-page auto-loading, live reconciliation, transcript
 * navigation, and desktop/mobile placement — through the public Host contracts
 * (`conversation.history` facade, `conversation.openMessage`, `host.ui`,
 * `host.utils`, `host.i18n`), without importing private stores or duplicating
 * host-owned transport.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { PluginTaskPanelProps } from "./host";
import {
  derivePromptHistoryRows,
  formatPromptDuration,
  type PromptHistoryRow,
} from "./derive";
import {
  determinePanelState,
  applyOpenMessageOutcome,
  shouldPaginate,
} from "./panel-state";
import { host } from "./host";

const SENTINEL_TEST_ID = "ph-plugin-sentinel";
const SCROLL_TEST_ID = "ph-plugin-scroll";
/** Minimum-display window for the loading message: after a page settles, keep
 * the message mounted this long so the sentinel's re-arm loop (next page firing
 * right after a positive settle) renders a continuous indicator instead of a
 * per-page flash. */
const LOADING_GRACE_MS = 400;

let nextDescriptionId = 0;

type PanelIconName = "robot" | "clock" | "hourglass" | "chevron-up" | "chevron-down";

function PanelIcon({ className, name }: { className: string; name: PanelIconName }) {
  let content: React.ReactNode;
  switch (name) {
    case "robot":
      content = (
        <>
          <path d="M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
          <path d="M9 11h.01M15 11h.01M9.5 15.5c.658.329 1.491.5 2.5.5s1.842-.171 2.5-.5M9 7 8 3M15 7l1-4" />
        </>
      );
      break;
    case "clock":
      content = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </>
      );
      break;
    case "hourglass":
      content = (
        <path d="M6.5 4h11M6.5 20h11M8 4c0 4.5 1.5 6 4 8-2.5 2-4 3.5-4 8M16 4c0 4.5-1.5 6-4 8 2.5 2 4 3.5 4 8" />
      );
      break;
    case "chevron-up":
      content = <path d="m6 15 6-6 6 6" />;
      break;
    case "chevron-down":
      content = <path d="m6 9 6 6 6-6" />;
      break;
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}

type RowProps = {
  row: PromptHistoryRow;
  index: number;
  sessionId: string | null;
  expanded: boolean;
  maxHeight: string;
  onToggle: () => void;
  onNavigate: (messageId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  formatRelativeTime: (value: string | number | Date) => string;
  PromptMentionText: ComponentType<{ text: string; interactive?: boolean }>;
};

function isNestedInteractiveTarget(target: EventTarget | null, currentTarget: Element): boolean {
  const interactiveTarget =
    target instanceof Element
      ? target.closest('button,a,input,select,textarea,[role="button"],[role="link"]')
      : null;
  return interactiveTarget !== null && interactiveTarget !== currentTarget;
}

function PromptHistoryRow({
  row,
  index,
  sessionId,
  expanded,
  maxHeight,
  onToggle,
  onNavigate,
  t,
  formatRelativeTime,
  PromptMentionText,
}: RowProps) {
  const isFavorite = host().conversation.useMessageFavorite(sessionId, row.messageId);
  const textRef = useRef<HTMLSpanElement>(null);
  const descriptionIdRef = useRef<string | null>(null);
  if (descriptionIdRef.current === null) {
    nextDescriptionId += 1;
    descriptionIdRef.current = `ph-plugin-prompt-description-${nextDescriptionId}`;
  }
  const descriptionId = descriptionIdRef.current;
  const [overflow, setOverflow] = useState(false);
  const rowLabel =
    row.promptNumber == null
      ? t("promptHistoryPromptLabelGeneric")
      : t("promptHistoryPromptLabel", { values: { number: row.promptNumber } });
  const updateOverflow = useCallback(() => {
    const text = textRef.current;
    if (text) setOverflow(text.scrollWidth > text.clientWidth);
  }, []);

  useLayoutEffect(updateOverflow);
  useEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(text);
    return () => observer.disconnect();
  }, [updateOverflow]);

  const showToggle = overflow || expanded;

  return (
    <div className="ph-plugin-row" data-testid={`ph-plugin-row-${index}`}>
      <div className="ph-plugin-row-main">
        <div
          className={`ph-plugin-row-bubble markdown-body markdown-body-user${
            isFavorite ? " ph-plugin-favorite" : ""
          }`}
          data-message-id={row.messageId}
          onClick={(event) => {
            if (isNestedInteractiveTarget(event.target, event.currentTarget)) return;
            onNavigate(row.messageId);
          }}
        >
          {row.promptNumber !== null && (
            <span className="ph-plugin-number" aria-hidden="true">
              #{row.promptNumber}
            </span>
          )}
          {row.isAgentPrompt && <PanelIcon className="ph-plugin-agent-icon" name="robot" />}
          <span ref={textRef} className={expanded ? "ph-plugin-hidden" : "ph-plugin-row-text"}>
            <PromptMentionText text={row.content} interactive />
          </span>
          {expanded && (
            <div
              className="ph-plugin-expanded-box"
              data-testid={`ph-plugin-expanded-box-${index}`}
              style={{ maxHeight }}
            >
              <PromptMentionText text={row.content} interactive />
            </div>
          )}
          {showToggle && (
            <button
              type="button"
              className={`ph-plugin-expand${expanded ? " ph-plugin-expand-expanded" : ""}`}
              aria-expanded={expanded}
              aria-label={t(expanded ? "collapsePrompt" : "expandPrompt")}
              aria-describedby={descriptionId}
              data-testid={`ph-plugin-expand-${index}`}
              onClick={onToggle}
            >
              <PanelIcon
                className="ph-plugin-expand-icon"
                name={expanded ? "chevron-up" : "chevron-down"}
              />
            </button>
          )}
        </div>
        <span id={descriptionId} className="ph-plugin-sr-only">
          {row.content}
        </span>
        <button
          type="button"
          className="ph-plugin-navigate"
          aria-label={rowLabel}
          aria-describedby={descriptionId}
          data-testid={`ph-plugin-navigate-${index}`}
          onClick={() => onNavigate(row.messageId)}
        />
      </div>
      <div className="ph-plugin-row-meta">
        <time dateTime={row.sentAt} title={formatRelativeTime(row.sentAt)} className="ph-plugin-row-time">
          <PanelIcon className="ph-plugin-meta-icon" name="clock" />
          {formatRelativeTime(row.sentAt)}
        </time>
        {row.durationSeconds !== null && (
          <span className="ph-plugin-duration" data-testid={`ph-plugin-duration-${index}`}>
            <PanelIcon className="ph-plugin-meta-icon" name="hourglass" />
            {formatPromptDuration(row.durationSeconds, {
              s: t("durationUnitSeconds"),
              m: t("durationUnitMinutes"),
              h: t("durationUnitHours"),
            })}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tracks the panel root's height via ResizeObserver and returns 40% of it as
 * a CSS max-height string (falling back to "40vh") for expanded prompt rows.
 * Every render branch keeps the same root div at the same tree position, so
 * React preserves this observed node while only its inner state changes. */
function usePanelRowMaxHeight(rootRef: React.RefObject<HTMLDivElement | null>): string {
  const [maxHeight, setMaxHeight] = useState<string>("40vh");
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateHeight = () =>
      setMaxHeight(root.clientHeight ? `${Math.round(root.clientHeight * 0.4)}px` : "40vh");
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);
  return maxHeight;
}

/** True when `contentHeight` exceeds the root's scrollable (content-box)
 * height. `rootClientHeight` includes the root's vertical padding, which is
 * not part of the scrollable viewport, so it is subtracted. */
function overflowsPanel(contentHeight: number, rootClientHeight: number, verticalPadding: number): boolean {
  return contentHeight > rootClientHeight - verticalPadding;
}

/** True when the prompt rows overflow the scroller, i.e. the panel actually
 * scrolls. Measured from a dedicated content wrapper (rows + sentinel) against
 * the inner scroller's content box so the loading indicator's own presence
 * never affects the answer. Reconnects after every commit so refs that were
 * null in an empty/loading branch attach when the rows branch mounts. */
function usePanelContentScrollable(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  onGeometryChange: () => void,
): boolean {
  const [isScrollable, setIsScrollable] = useState(false);
  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return false;
    const style = getComputedStyle(scroller);
    const verticalPadding =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return overflowsPanel(content.scrollHeight, scroller.clientHeight, verticalPadding);
  }, [scrollRef, contentRef]);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const update = () => {
      setIsScrollable(measure());
      onGeometryChange();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  });
  return isScrollable;
}

/** Minimum-display grace for the loading message: once a load starts, keep the
 * message mounted for LOADING_GRACE_MS after the request settles so the
 * sentinel's re-arm loop renders a continuous indicator instead of a per-page
 * flash. Bound to the session that produced it; a session switch drops the
 * previous session's grace but carries over an already in-flight load. */
function useLoadingGrace(sessionId: string | null, isLoadingMore: boolean): boolean {
  const [grace, setGrace] = useState<{ sessionId: string | null; show: boolean }>({
    sessionId,
    show: false,
  });
  useEffect(() => {
    if (grace.sessionId !== sessionId) {
      setGrace({ sessionId, show: isLoadingMore });
      return;
    }
    if (isLoadingMore) {
      setGrace({ sessionId, show: true });
      return;
    }
    const timer = window.setTimeout(() => setGrace({ sessionId, show: false }), LOADING_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [sessionId, isLoadingMore, grace.sessionId]);
  return grace.sessionId === sessionId && grace.show;
}

/** Auto-loads older prompts while the sentinel is visible. Positive loads
 * re-arm immediately and preserve a user's bottom-pinned position. A
 * current-generation rejected or zero-progress load disarms until sentinel
 * exit or user gesture; a stale generation's outcome cannot govern the
 * replacement view, so it hands off one eligible load to the current view. */
function usePanelOlderPromptSentinel(opts: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  lifecycleKey: string | null;
  shouldPaginate: boolean;
  messagesLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => Promise<number>;
}): {
  sentinelRef: (node: HTMLDivElement | null) => void;
  onUserGesture: () => void;
  recheck: () => void;
  restorePinnedPosition: () => void;
} {
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const sentinelNodeRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observerGenerationRef = useRef(-1);
  const intersectingRef = useRef(false);
  const disarmedRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const pinnedRef = useRef(false);
  const loadMoreRef = useRef(opts.loadMore);
  const attachedScrollerRef = useRef<HTMLDivElement | null>(null);
  const lifecycleRef = useRef(opts.lifecycleKey);
  const loadingRef = useRef(opts.messagesLoading);
  const generationRef = useRef(0);
  const pendingBottomPinRef = useRef<{ generation: number; scrollHeight: number } | null>(null);
  const bottomPinFrameRef = useRef<number | null>(null);
  const stateRef = useRef({
    shouldPaginate: opts.shouldPaginate,
    messagesLoading: opts.messagesLoading,
    isLoadingMore: opts.isLoadingMore,
  });
  useLayoutEffect(() => {
    const lifecycleChanged = lifecycleRef.current !== opts.lifecycleKey;
    const rebindStarted = !loadingRef.current && opts.messagesLoading;
    lifecycleRef.current = opts.lifecycleKey;
    loadingRef.current = opts.messagesLoading;
    loadMoreRef.current = opts.loadMore;
    stateRef.current = {
      shouldPaginate: opts.shouldPaginate,
      messagesLoading: opts.messagesLoading,
      isLoadingMore: opts.isLoadingMore,
    };
    if (lifecycleChanged || rebindStarted) {
      generationRef.current += 1;
      intersectingRef.current = false;
      disarmedRef.current = false;
      pinnedRef.current = false;
      pendingBottomPinRef.current = null;
      if (bottomPinFrameRef.current !== null) {
        window.cancelAnimationFrame(bottomPinFrameRef.current);
        bottomPinFrameRef.current = null;
      }
    }
  }, [
    opts.lifecycleKey,
    opts.messagesLoading,
    opts.isLoadingMore,
    opts.shouldPaginate,
    opts.loadMore,
  ]);

  const refreshPinned = useCallback(() => {
    const scroller = opts.scrollRef.current;
    const pinned = Boolean(
      scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24,
    );
    pinnedRef.current = pinned;
    if (!pinned) pendingBottomPinRef.current = null;
  }, [opts.scrollRef]);

  const restorePinnedPosition = useCallback(() => {
    const pending = pendingBottomPinRef.current;
    if (!pending) return;
    if (pending.generation !== generationRef.current) {
      pendingBottomPinRef.current = null;
      return;
    }
    const scroller = opts.scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    if (
      scroller.scrollHeight !== pending.scrollHeight ||
      !stateRef.current.shouldPaginate ||
      sentinelNodeRef.current === null
    ) {
      pendingBottomPinRef.current = null;
    }
  }, [opts.scrollRef]);

  const schedulePinnedPositionRestore = useCallback(() => {
    if (bottomPinFrameRef.current !== null) return;
    const generation = generationRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (bottomPinFrameRef.current === frame) bottomPinFrameRef.current = null;
      if (generation !== generationRef.current) return;
      restorePinnedPosition();
    });
    bottomPinFrameRef.current = frame;
  }, [restorePinnedPosition]);

  useLayoutEffect(restorePinnedPosition);

  useEffect(() => {
    const previousScroller = attachedScrollerRef.current;
    const scroller = opts.scrollRef.current;
    if (previousScroller === scroller) return;
    previousScroller?.removeEventListener("scroll", refreshPinned);
    attachedScrollerRef.current = scroller;
    if (!scroller) return;
    refreshPinned();
    scroller.addEventListener("scroll", refreshPinned, { passive: true });
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachedScrollerRef.current?.removeEventListener("scroll", refreshPinned);
      attachedScrollerRef.current = null;
      if (bottomPinFrameRef.current !== null) {
        window.cancelAnimationFrame(bottomPinFrameRef.current);
        bottomPinFrameRef.current = null;
      }
    };
  }, [refreshPinned]);

  const isCurrentGeometryEligible = useCallback(() => {
    const scroller = opts.scrollRef.current;
    const sentinel = sentinelNodeRef.current;
    if (!scroller || !sentinel || scroller.clientHeight === 0) return false;
    const rootRect = scroller.getBoundingClientRect();
    const sentinelRect = sentinel.getBoundingClientRect();
    return sentinelRect.bottom >= rootRect.top && sentinelRect.top <= rootRect.bottom + 200;
  }, [opts.scrollRef]);

  const fireLoad = useCallback(async (): Promise<void> => {
    const node = sentinelNodeRef.current;
    const observer = observerRef.current;
    const state = stateRef.current;
    if (
      !node ||
      !observer ||
      requestInFlightRef.current ||
      observerGenerationRef.current !== generationRef.current ||
      !state.shouldPaginate ||
      state.messagesLoading ||
      state.isLoadingMore ||
      !isCurrentGeometryEligible()
    ) {
      return;
    }
    const generation = generationRef.current;

    refreshPinned();
    const preserveBottom = pinnedRef.current;
    const scrollHeightBeforeLoad = opts.scrollRef.current?.scrollHeight ?? 0;
    requestInFlightRef.current = true;
    observer.unobserve(node);
    let count = 0;
    let rejected = false;
    try {
      count = await loadMoreRef.current();
    } catch {
      rejected = true;
    } finally {
      requestInFlightRef.current = false;
    }

    if (generation !== generationRef.current) {
      const currentState = stateRef.current;
      if (
        mountedRef.current &&
        observerRef.current &&
        sentinelNodeRef.current &&
        currentState.shouldPaginate &&
        !currentState.messagesLoading &&
        !currentState.isLoadingMore &&
        isCurrentGeometryEligible()
      ) {
        void fireLoad();
      }
      return;
    }

    if (mountedRef.current && count > 0 && !rejected && preserveBottom && pinnedRef.current) {
      pendingBottomPinRef.current = {
        generation,
        scrollHeight: scrollHeightBeforeLoad,
      };
      restorePinnedPosition();
      if (pendingBottomPinRef.current) schedulePinnedPositionRestore();
    }

    if (!mountedRef.current || observerRef.current !== observer) return;
    if (sentinelNodeRef.current !== node) return;
    if (count > 0 && !rejected) {
      disarmedRef.current = false;
    } else {
      disarmedRef.current = true;
    }
    observer.observe(node);
  }, [
    opts.scrollRef,
    refreshPinned,
    isCurrentGeometryEligible,
    restorePinnedPosition,
    schedulePinnedPositionRestore,
  ]);

  useEffect(() => {
    const root = opts.scrollRef.current;
    if (!root || !sentinelEl) return;
    const observerGeneration = generationRef.current;
    const observer = new IntersectionObserver(
      (entries, callbackObserver) => {
        const entry = entries[0];
        if (
          !entry ||
          callbackObserver !== observerRef.current ||
          entry.target !== sentinelNodeRef.current ||
          observerGeneration !== generationRef.current
        ) {
          return;
        }
        intersectingRef.current = entry.isIntersecting;
        if (disarmedRef.current) {
          if (!entry.isIntersecting) disarmedRef.current = false;
          return;
        }
        const state = stateRef.current;
        if (
          !entry.isIntersecting ||
          !state.shouldPaginate ||
          state.messagesLoading ||
          state.isLoadingMore
        ) {
          return;
        }
        void fireLoad();
      },
      { root, rootMargin: "0px 0px 200px 0px" },
    );
    observerGenerationRef.current = observerGeneration;
    observerRef.current = observer;
    observer.observe(sentinelEl);
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) {
        observerRef.current = null;
        intersectingRef.current = false;
        observerGenerationRef.current = -1;
      }
    };
  }, [sentinelEl, opts.scrollRef, opts.lifecycleKey, opts.messagesLoading, fireLoad]);

  useEffect(() => {
    if (
      intersectingRef.current &&
      !disarmedRef.current &&
      opts.shouldPaginate &&
      !opts.messagesLoading
    ) {
      void fireLoad();
    }
  }, [opts.shouldPaginate, opts.messagesLoading, opts.isLoadingMore, fireLoad]);

  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    sentinelNodeRef.current = node;
    setSentinelEl(node);
  }, []);
  const onUserGesture = useCallback(() => {
    const state = stateRef.current;
    if (
      !disarmedRef.current ||
      !intersectingRef.current ||
      !state.shouldPaginate ||
      state.messagesLoading ||
      state.isLoadingMore
    ) {
      return;
    }
    void fireLoad();
  }, [fireLoad]);
  const recheck = useCallback(() => {
    const state = stateRef.current;
    if (
      disarmedRef.current ||
      !state.shouldPaginate ||
      state.messagesLoading ||
      state.isLoadingMore ||
      requestInFlightRef.current ||
      !isCurrentGeometryEligible()
    ) {
      return;
    }
    void fireLoad();
  }, [fireLoad, isCurrentGeometryEligible]);


  return { sentinelRef, onUserGesture, recheck, restorePinnedPosition };
}

/** The prompt-history panel component. */
export function PromptHistoryPanel(props: PluginTaskPanelProps) {
  const { sessionId, taskId, sessionKind, conversation } = props;
  const h = host();
  const t = h.i18n.useTranslation().t;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const messagesState = conversation.history.useSessionMessages({
    sessionId,
    taskId,
    authorTypes: ["user"],
    sort: "desc",
    pageSize: 20,
  });
  const turnsState = conversation.history.useSessionTurns(sessionId, taskId);
  const turnsHydrated = turnsState.hydrated;

  const rows = useMemo(
    () => derivePromptHistoryRows(messagesState.messages, turnsState.turns, turnsHydrated),
    [messagesState.messages, turnsState.turns, turnsHydrated],
  );
  const state = determinePanelState(messagesState, sessionKind);
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxHeight = usePanelRowMaxHeight(rootRef);

  const shouldAutoLoad = state.kind === "rows" && shouldPaginate(rows, messagesState.hasMore);
  const showLoadingGrace = useLoadingGrace(sessionId, messagesState.loadingMore);
  const showLoading = shouldAutoLoad && (messagesState.loadingMore || showLoadingGrace);

  const { sentinelRef, onUserGesture, recheck, restorePinnedPosition } =
    usePanelOlderPromptSentinel({
      scrollRef,
      lifecycleKey: sessionId,
      shouldPaginate: shouldAutoLoad,
      messagesLoading: messagesState.loading,
      isLoadingMore: messagesState.loadingMore,
      loadMore: messagesState.loadMore,
    });
  const recheckFrameRef = useRef<number | null>(null);
  const recheckIdentityRef = useRef(0);
  useLayoutEffect(() => {
    recheckIdentityRef.current += 1;
    if (recheckFrameRef.current !== null) {
      window.cancelAnimationFrame(recheckFrameRef.current);
      recheckFrameRef.current = null;
    }
  }, [sessionId, messagesState.loading, messagesState.loadingMore, messagesState.messages]);
  const scheduleRecheck = useCallback(() => {
    if (recheckFrameRef.current !== null) return;
    const identity = recheckIdentityRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (recheckFrameRef.current === frame) recheckFrameRef.current = null;
      if (recheckIdentityRef.current !== identity) return;
      recheck();
    });
    recheckFrameRef.current = frame;
  }, [recheck]);
  useEffect(
    () => () => {
      if (recheckFrameRef.current !== null) {
        window.cancelAnimationFrame(recheckFrameRef.current);
        recheckFrameRef.current = null;
      }
    },
    [scheduleRecheck],
  );
  useEffect(scheduleRecheck, [
    scheduleRecheck,
    sessionId,
    messagesState.loading,
    messagesState.loadingMore,
    messagesState.messages,
    shouldAutoLoad,
  ]);
  const onGeometryChange = useCallback(() => {
    restorePinnedPosition();
    scheduleRecheck();
  }, [restorePinnedPosition, scheduleRecheck]);
  const isScrollable = usePanelContentScrollable(scrollRef, contentRef, onGeometryChange);

  const onNavigate = useCallback(
    (messageId: string) => {
      const outcome = conversation.openMessage(messageId);
      applyOpenMessageOutcome(state, outcome);
    },
    [conversation, state],
  );

  const onScrollerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "PageUp":
        case "PageDown":
        case "Home":
        case "End":
        case " ":
          onUserGesture();
      }
    },
    [onUserGesture],
  );
  const onScrollerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // A touch tap reaches the scroller as `pointerdown` (pointerType
      // "touch") and then `touchstart`; the touch handler below already owns
      // that gesture, so handling it here would retry one tap twice once the
      // first page settles. Mouse and pen clicks have no touch fallback and
      // stay handled here.
      if (event.pointerType === "touch") return;
      if (event.target === event.currentTarget) onUserGesture();
    },
    [onUserGesture],
  );
  const onScrollerTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (isNestedInteractiveTarget(event.target, event.currentTarget)) return;
      onUserGesture();
    },
    [onUserGesture],
  );

  if (state.kind === "passthrough") {
    return (
      <div ref={rootRef} className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-empty">
          {t("promptHistoryEmpty")}
        </div>
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div ref={rootRef} className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-loading">
          {t("loading")}
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div ref={rootRef} className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-error">
          {t("error")}
          {/* The facade's retry() no-ops unless the error is retryable
              (unauthenticated / invalid_query are not), so offering the
              control there would be a dead button. */}
          {messagesState.error?.retryable && (
            <button
              type="button"
              className="ph-plugin-retry"
              data-testid="ph-plugin-retry"
              onClick={() => messagesState.retry()}
            >
              {t("retry")}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div ref={rootRef} className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-empty">
          {t("promptHistoryEmpty")}
        </div>
      </div>
    );
  }

  // `rows` (and `removed`, which keeps committed rows visible with pagination
  // stopped): the row list plus the pagination sentinel.
  return (
    <div ref={rootRef} className="ph-plugin-panel" data-testid="ph-plugin-panel">
      <div
        className="ph-plugin-scroller"
        aria-label={t("panelTitle")}
        tabIndex={shouldAutoLoad ? 0 : undefined}
        data-testid={SCROLL_TEST_ID}
        ref={scrollRef}
        onKeyDown={shouldAutoLoad ? onScrollerKeyDown : undefined}
        onPointerDown={shouldAutoLoad ? onScrollerPointerDown : undefined}
        onWheel={shouldAutoLoad ? onUserGesture : undefined}
        onTouchStart={shouldAutoLoad ? onScrollerTouchStart : undefined}
      >
        <div className="ph-plugin-rows" ref={contentRef}>
          {rows.map((row, index) => (
            <PromptHistoryRow
              key={row.messageId}
              row={row}
              index={index}
              sessionId={sessionId}
              expanded={expanded === row.messageId}
              maxHeight={maxHeight}
              onToggle={() => setExpanded(expanded === row.messageId ? null : row.messageId)}
              onNavigate={onNavigate}
              t={t}
              formatRelativeTime={h.utils.formatRelativeTime}
              PromptMentionText={
                h.ui.PromptMentionText as ComponentType<{ text: string; interactive?: boolean }>
              }
            />
          ))}
          {shouldAutoLoad && (
            <div
              ref={sentinelRef}
              className="ph-plugin-sentinel"
              data-testid={SENTINEL_TEST_ID}
              aria-hidden="true"
            />
          )}
        </div>
        {showLoading && !isScrollable && (
          <div
            role="status"
            aria-live="polite"
            className="ph-plugin-loading-older"
            data-testid="ph-plugin-loading-older"
          >
            {t("loadingOlderMessages")}
          </div>
        )}
      </div>
      {showLoading && isScrollable && (
        <div
          role="status"
          aria-live="polite"
          className="ph-plugin-loading-older-floating"
          data-testid="ph-plugin-loading-older-floating"
        >
          {t("loadingOlderMessages")}
        </div>
      )}
    </div>
  );
}

