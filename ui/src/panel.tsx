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
  PromptMentionText: ComponentType<{ text: string }>;
  isFinePointer: boolean;
  isMobile: boolean;
};

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
  isFinePointer,
  isMobile,
}: RowProps) {
  const isFavorite = host().conversation.useMessageFavorite(sessionId, row.messageId);
  const rowLabel =
    row.promptNumber == null
      ? t("promptHistoryPromptLabelGeneric")
      : t("promptHistoryPromptLabel", { number: row.promptNumber });
  const compactExpand = isFinePointer && !isMobile;
  return (
    <div className={`ph-plugin-row${isFavorite ? " ph-plugin-favorite" : ""}`} data-testid={`ph-plugin-row-${index}`}>
      <div className="ph-plugin-row-bubble" data-message-id={row.messageId}>
        {row.promptNumber !== null && (
          <span className="ph-plugin-number" aria-hidden="true">
            #{row.promptNumber}
          </span>
        )}
        {row.isAgentPrompt && (
          <span className="ph-plugin-agent" aria-hidden="true">
            {"\u{1F916}"}
          </span>
        )}
        <span className={expanded ? "ph-plugin-hidden" : "ph-plugin-row-text"}>
          <PromptMentionText text={row.content} />
        </span>
        {expanded && (
          <div
            className="ph-plugin-expanded-box"
            data-testid={`ph-plugin-expanded-box-${index}`}
            style={{ maxHeight }}
          >
            <PromptMentionText text={row.content} />
          </div>
        )}
        <button
          type="button"
          className={`ph-plugin-expand${compactExpand ? " ph-plugin-expand-compact" : ""}`}
          aria-expanded={expanded}
          aria-label={t(expanded ? "collapsePrompt" : "expandPrompt")}
          data-testid={`ph-plugin-expand-${index}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? "−" : "+"}
        </button>
      </div>
      <div className="ph-plugin-row-meta">
        <time dateTime={row.sentAt} title={formatRelativeTime(row.sentAt)} className="ph-plugin-row-time">
          {formatRelativeTime(row.sentAt)}
        </time>
        {row.durationSeconds !== null && (
          <span className="ph-plugin-duration" data-testid={`ph-plugin-duration-${index}`}>
            {formatPromptDuration(row.durationSeconds, {
              s: t("durationUnitSeconds"),
              m: t("durationUnitMinutes"),
              h: t("durationUnitHours"),
            })}
          </span>
        )}
      </div>
      <button
        type="button"
        className="ph-plugin-navigate"
        aria-label={rowLabel}
        data-testid={`ph-plugin-navigate-${index}`}
        onClick={() => onNavigate(row.messageId)}
      />
    </div>
  );
}

/** Tracks the panel root's height via ResizeObserver and returns 40% of it as
 * a CSS max-height string (falling back to "40vh") for expanded prompt rows. */
function usePanelRowMaxHeight(rootRef: React.RefObject<HTMLDivElement | null>): string {
  const [maxHeight, setMaxHeight] = useState<string>("40vh");
  useEffect(() => {
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
 * never affects the answer. */
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
    setIsScrollable(measure());
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      setIsScrollable(measure());
      onGeometryChange();
    });
    observer.observe(scroller);
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

/** The older-prompt auto-load sentinel: fires `loadMore` when the sentinel
 * intersects, re-arms while intersecting, and does not re-issue a load already
 * in flight. */
function usePanelOlderPromptSentinel(opts: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  lifecycleKey: number;
  shouldPaginate: boolean;
  messagesLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => Promise<number>;
}): { sentinelRef: (node: HTMLDivElement | null) => void; recheck: () => void } {
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => setSentinelEl(node), []);
  const stateRef = useRef(opts);
  stateRef.current = opts;
  const [recheckTick, setRecheckTick] = useState(0);
  const recheck = useCallback(() => setRecheckTick((tick) => tick + 1), []);

  useEffect(() => {
    const scroller = opts.scrollRef.current;
    if (!scroller || !sentinelEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const current = stateRef.current;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!current.shouldPaginate || current.messagesLoading || current.isLoadingMore) return;
        void current.loadMore();
      },
      { root: scroller, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [sentinelEl, opts.scrollRef, recheckTick, opts.lifecycleKey]);

  return { sentinelRef, recheck };
}

/** The prompt-history panel component. */
export function PromptHistoryPanel(props: PluginTaskPanelProps) {
  const { sessionId, taskId, sessionKind, conversation } = props;
  const h = host();
  const t = h.i18n.useTranslation().t;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const breakpoint = h.useResponsiveBreakpoint() as unknown as {
    isMobile: boolean;
    isFinePointer: boolean;
  };

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

  const { sentinelRef, recheck: recheckSentinel } = usePanelOlderPromptSentinel({
    scrollRef,
    lifecycleKey: messagesState.messages.length,
    shouldPaginate: shouldAutoLoad,
    messagesLoading: messagesState.loading,
    isLoadingMore: messagesState.loadingMore,
    loadMore: messagesState.loadMore,
  });
  const isScrollable = usePanelContentScrollable(scrollRef, contentRef, recheckSentinel);

  const onNavigate = useCallback(
    (messageId: string) => {
      const outcome = conversation.openMessage(messageId);
      applyOpenMessageOutcome(state, outcome);
    },
    [conversation, state],
  );

  if (state.kind === "passthrough") {
    return (
      <div className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-empty">
          {t("promptHistoryEmpty")}
        </div>
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-loading">
          {t("loading")}
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-error">
          {t("error")}
          <button
            type="button"
            className="ph-plugin-retry"
            data-testid="ph-plugin-retry"
            onClick={() => messagesState.retry()}
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div className="ph-plugin-panel" data-testid="ph-plugin-panel">
        <div role="status" aria-live="polite" className="ph-plugin-empty">
          {t("promptHistoryEmpty")}
        </div>
      </div>
    );
  }

  // `rows` (and `removed`, which keeps committed rows visible with pagination
  // stopped): the row list plus the pagination sentinel.
  return (
    <div className="ph-plugin-panel" data-testid="ph-plugin-panel">
      <div className="ph-plugin-scroller" data-testid={SCROLL_TEST_ID} ref={scrollRef}>
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
              PromptMentionText={h.ui.PromptMentionText as ComponentType<{ text: string }>}
              isFinePointer={breakpoint.isFinePointer}
              isMobile={breakpoint.isMobile}
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

