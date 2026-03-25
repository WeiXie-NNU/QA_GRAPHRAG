import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MessagesProps } from "@copilotkit/react-ui";
import type { Message } from "@copilotkit/shared";
import MessageListPerformanceContext from "./MessageListPerformanceContext";

const LOAD_OLDER_SCROLL_THRESHOLD_PX = 96;
const SCROLL_IDLE_TIMEOUT_MS = 140;

function makeInitialMessages(initial: string | string[] | undefined): Message[] {
  if (!initial) return [];
  if (Array.isArray(initial)) {
    return initial.map((content) => ({ id: content, role: "assistant", content }));
  }
  return [{ id: initial, role: "assistant", content: initial }];
}

function getMessageKey(message: Message, index: number): string {
  const rawId = (message as any)?.id;
  if (rawId != null && rawId !== "") {
    return String(rawId);
  }
  return `message:${index}:${String(message.role)}:${String((message as any)?.content ?? "")}`;
}

function getComparableMessageId(message: Message): string {
  const rawId = (message as any)?.id;
  return rawId == null ? "" : String(rawId);
}

function buildAssistantTurnKey(message: Message, previousUserMessageId: string): string {
  const rawId = getComparableMessageId(message);
  if (rawId.startsWith("assistant:")) {
    return `assistant-turn:${rawId.slice("assistant:".length)}`;
  }

  if (previousUserMessageId) {
    return `assistant-turn:${previousUserMessageId}`;
  }

  if (rawId) {
    return `assistant:${rawId}`;
  }

  return `assistant:${String((message as any)?.content ?? "")}`;
}

function buildMergeRows(groups: Message[][]): Array<{ message: Message; mergeKey: string }> {
  const rows: Array<{ message: Message; mergeKey: string }> = [];

  groups.forEach((group) => {
    let previousUserMessageId = "";

    group.forEach((message, index) => {
      if (!message) {
        return;
      }

      const rawId = getComparableMessageId(message);
      if (message.role === "user") {
        previousUserMessageId = rawId || `user-index:${index}`;
        rows.push({
          message,
          mergeKey: rawId ? `user:${rawId}` : `user:${index}:${String((message as any)?.content ?? "")}`,
        });
        return;
      }

      if (message.role === "assistant") {
        rows.push({
          message,
          mergeKey: buildAssistantTurnKey(message, previousUserMessageId),
        });
        return;
      }

      rows.push({
        message,
        mergeKey: rawId ? `${String(message.role)}:${rawId}` : `${String(message.role)}:${index}`,
      });
    });
  });

  return rows;
}

function mergeMessageGroups(...groups: Message[][]): Message[] {
  const merged: Message[] = [];
  const indexByStableId = new Map<string, number>();
  const rows = buildMergeRows(groups);

  rows.forEach(({ message, mergeKey }) => {
    const existingIndex = indexByStableId.get(mergeKey);
    if (existingIndex != null) {
      merged[existingIndex] = message;
      return;
    }

    indexByStableId.set(mergeKey, merged.length);
    merged.push(message);
  });

  return merged;
}

function hasTextContent(content: unknown): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (typeof part === "string") {
      return part.trim().length > 0;
    }

    if (!part || typeof part !== "object") {
      return false;
    }

    if ((part as any).type === "text") {
      return String((part as any).text ?? "").trim().length > 0;
    }

    return true;
  });
}

function isRenderableMessage(
  message: Message,
  index: number,
  total: number,
  inProgress: boolean
): boolean {
  if (!message) {
    return false;
  }

  if (message.role === "user") {
    return hasTextContent((message as any).content) || Boolean((message as any).image);
  }

  if (message.role !== "assistant") {
    return false;
  }

  if (hasTextContent((message as any).content)) {
    return true;
  }

  if (typeof (message as any).generativeUI === "function") {
    return true;
  }

  if (inProgress && index === total - 1) {
    return true;
  }

  return false;
}

function filterRenderableMessages(messages: Message[], inProgress: boolean): Message[] {
  return messages.filter((message, index) =>
    isRenderableMessage(message, index, messages.length, inProgress)
  );
}

type VirtualizedMessagesProps = MessagesProps & {
  perfEnabled?: boolean;
  historyMessages?: Message[];
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  initialMessages?: string | string[];
  onLoadOlderHistory?: () => void | Promise<void>;
  threadKey?: string;
};

interface RenderedMessageRowProps {
  AssistantMessage: MessagesProps["AssistantMessage"];
  ImageRenderer: MessagesProps["ImageRenderer"];
  RenderMessage: NonNullable<MessagesProps["RenderMessage"]>;
  UserMessage: MessagesProps["UserMessage"];
  index: number;
  inProgress: boolean;
  markdownTagRenderers: MessagesProps["markdownTagRenderers"];
  message: Message;
  messageFeedback: MessagesProps["messageFeedback"];
  messageKey: string;
  messages: Message[];
  onCopy: MessagesProps["onCopy"];
  onRegenerate: MessagesProps["onRegenerate"];
  onThumbsDown: MessagesProps["onThumbsDown"];
  onThumbsUp: MessagesProps["onThumbsUp"];
}

interface MessageRowData {
  message: Message;
  messageKey: string;
  relativeIndex: number;
}

const RenderedMessageRow = memo((props: RenderedMessageRowProps) => {
  const {
    AssistantMessage,
    ImageRenderer,
    RenderMessage,
    UserMessage,
    index,
    inProgress,
    markdownTagRenderers,
    message,
    messageFeedback,
    messages,
    onCopy,
    onRegenerate,
    onThumbsDown,
    onThumbsUp,
  } = props;
  const isCurrentMessage = index === messages.length - 1;

  return (
    <div style={{ display: "flow-root" }}>
      <RenderMessage
        message={message}
        messages={messages}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        ImageRenderer={ImageRenderer}
        onRegenerate={onRegenerate}
        onCopy={onCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        messageFeedback={messageFeedback}
        markdownTagRenderers={markdownTagRenderers}
      />
    </div>
  );
}, (prev, next) => {
  const prevMessage = prev.message as any;
  const nextMessage = next.message as any;

  return (
    prev.messageKey === next.messageKey &&
    prev.index === next.index &&
    prev.inProgress === next.inProgress &&
    prev.messages.length === next.messages.length &&
    prevMessage?.content === nextMessage?.content &&
    prevMessage?.toolCalls === nextMessage?.toolCalls &&
    prev.messageFeedback === next.messageFeedback &&
    prev.AssistantMessage === next.AssistantMessage &&
    prev.UserMessage === next.UserMessage &&
    prev.ImageRenderer === next.ImageRenderer &&
    prev.RenderMessage === next.RenderMessage &&
    prev.onRegenerate === next.onRegenerate &&
    prev.onCopy === next.onCopy &&
    prev.onThumbsUp === next.onThumbsUp &&
    prev.onThumbsDown === next.onThumbsDown &&
    prev.markdownTagRenderers === next.markdownTagRenderers
  );
});
RenderedMessageRow.displayName = "RenderedMessageRow";

const ScrollPlaceholder: React.FC = () => (
  <div
    aria-hidden="true"
    style={{
      padding: "0 24px 24px",
      display: "flow-root",
    }}
  >
    <div
      style={{
        height: 96,
        borderRadius: 16,
        background: "linear-gradient(90deg, rgba(226,232,240,0.55) 0%, rgba(241,245,249,0.9) 50%, rgba(226,232,240,0.55) 100%)",
      }}
    />
  </div>
);

export const VirtualizedMessages: React.FC<VirtualizedMessagesProps> = ({
  messages: liveMessages,
  inProgress,
  children,
  RenderMessage,
  AssistantMessage,
  UserMessage,
  ErrorMessage,
  ImageRenderer,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  messageFeedback,
  markdownTagRenderers,
  chatError,
  perfEnabled = false,
  historyMessages = [],
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  initialMessages: initialContent,
  onLoadOlderHistory,
  threadKey = "",
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const deferredLiveMessages = useDeferredValue(liveMessages);
  const initialMessages = useMemo(
    () => filterRenderableMessages(makeInitialMessages(initialContent), false),
    [initialContent]
  );
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  const isAtBottomRef = useRef(true);
  const loadOlderInFlightRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const prependAnchorRef = useRef<number | null>(null);
  const prevHistoryCountRef = useRef(0);
  const prevTailKeyRef = useRef("");

  const sourceMessages = useMemo(
    () => (inProgress && !isAtBottom ? deferredLiveMessages : liveMessages),
    [deferredLiveMessages, inProgress, isAtBottom, liveMessages]
  );
  const renderableHistoryMessages = useMemo(
    () => filterRenderableMessages(historyMessages, false),
    [historyMessages]
  );
  const renderableSourceMessages = useMemo(
    () => filterRenderableMessages(sourceMessages, inProgress),
    [inProgress, sourceMessages]
  );
  const messages = useMemo(
    () => mergeMessageGroups(initialMessages, renderableHistoryMessages, renderableSourceMessages),
    [initialMessages, renderableHistoryMessages, renderableSourceMessages]
  );
  const historyCount = renderableHistoryMessages.length;
  const messageRows = useMemo<MessageRowData[]>(
    () =>
      messages.map((message, index) => ({
        message,
        messageKey: getMessageKey(message, index),
        relativeIndex: index,
      })),
    [messages]
  );
  const tailKey = messageRows[messageRows.length - 1]?.messageKey ?? "";
  const renderedCount = messageRows.length;
  const savedCount = 0;
  const liveCount = renderableSourceMessages.length;

  const clearScrollIdleTimer = useCallback(() => {
    if (scrollIdleTimerRef.current != null) {
      window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    prevHistoryCountRef.current = historyCount;
    prevTailKeyRef.current = "";
    loadOlderInFlightRef.current = false;
    prependAnchorRef.current = null;
    setIsAtBottom(true);
    clearScrollIdleTimer();
  }, [clearScrollIdleTimer, threadKey]);

  useEffect(() => () => {
    clearScrollIdleTimer();
  }, [clearScrollIdleTimer]);

  useEffect(() => {
    if (historyCount <= prevHistoryCountRef.current) {
      prevHistoryCountRef.current = historyCount;
      return;
    }

    prevHistoryCountRef.current = historyCount;
    requestAnimationFrame(() => {
      const node = scrollerRef.current;
      const anchor = prependAnchorRef.current;
      if (node && anchor != null) {
        node.scrollTop = Math.max(0, node.scrollHeight - anchor);
      }
      prependAnchorRef.current = null;
    });
  }, [historyCount]);

  useEffect(() => {
    if (!isLoadingOlderHistory) {
      loadOlderInFlightRef.current = false;
    }
  }, [isLoadingOlderHistory]);

  useEffect(() => {
    if (!tailKey || tailKey === prevTailKeyRef.current) {
      return;
    }

    const shouldStickToBottom =
      isAtBottomRef.current ||
      prevTailKeyRef.current === "" ||
      inProgress;
    prevTailKeyRef.current = tailKey;

    if (shouldStickToBottom) {
      requestAnimationFrame(() => {
        const node = scrollerRef.current;
        if (node) {
          node.scrollTop = node.scrollHeight;
        }
      });
    }
  }, [inProgress, tailKey]);

  const triggerLoadOlder = useCallback(() => {
    if (!hasOlderHistory || isLoadingOlderHistory || loadOlderInFlightRef.current || !onLoadOlderHistory) {
      return;
    }

    const node = scrollerRef.current;
    if (node) {
      prependAnchorRef.current = node.scrollHeight - node.scrollTop;
    }

    loadOlderInFlightRef.current = true;
    void Promise.resolve(onLoadOlderHistory()).finally(() => {
      if (!isLoadingOlderHistory) {
        loadOlderInFlightRef.current = false;
      }
    });
  }, [hasOlderHistory, isLoadingOlderHistory, onLoadOlderHistory]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const atBottom = node.scrollHeight - node.clientHeight - node.scrollTop <= 80;

    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }

    setIsScrolling(true);
    clearScrollIdleTimer();
    scrollIdleTimerRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      scrollIdleTimerRef.current = null;
    }, SCROLL_IDLE_TIMEOUT_MS);

    if (node.scrollTop <= LOAD_OLDER_SCROLL_THRESHOLD_PX) {
      triggerLoadOlder();
    }
  }, [clearScrollIdleTimer, triggerLoadOlder]);

  const hasAnyRenderedContent =
    messageRows.length > 0 || chatError || children || hasOlderHistory || isLoadingOlderHistory;

  return (
    <MessageListPerformanceContext.Provider value={{ isScrolling, isScrollSeeking: false }}>
      <div
        className="copilotKitMessagesShell"
        style={{ position: "relative", height: "100%", minHeight: 0, overflowAnchor: "none" }}
      >
        {perfEnabled ? (
          <div
            style={{
              position: "sticky",
              top: 12,
              zIndex: 30,
              marginLeft: "auto",
              marginRight: 16,
              marginBottom: 8,
              padding: "8px 12px",
              width: "fit-content",
              borderRadius: 12,
              background: "rgba(15, 23, 42, 0.82)",
              color: "#e2e8f0",
              fontSize: 12,
              lineHeight: 1.5,
              backdropFilter: "blur(10px)",
              pointerEvents: "none",
            }}
          >
            <div>thread: {threadKey || "n/a"}</div>
            <div>messages: {renderedCount}/{messages.length}</div>
            <div>history: {historyCount}</div>
            <div>live: {liveCount}</div>
            <div>saved: {savedCount}</div>
            <div>older: {hasOlderHistory ? (isLoadingOlderHistory ? "loading" : "ready") : "done"}</div>
            <div>atBottom: {isAtBottom ? "yes" : "no"}</div>
            <div>stream: {inProgress ? "on" : "off"}</div>
          </div>
        ) : null}

        <div
          ref={scrollerRef}
          className="copilotKitMessages copilotKitMessagesScroller"
          style={{ overflowAnchor: "none" }}
          onScroll={handleScroll}
        >
          <div className="copilotKitMessagesContainer copilotKitMessagesList" style={{ paddingBottom: 12 }}>
            {hasOlderHistory || isLoadingOlderHistory ? (
              <div style={{ padding: "0 24px 12px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                {isLoadingOlderHistory ? "加载更早历史中..." : "上滑加载更早历史"}
              </div>
            ) : null}

            {!hasAnyRenderedContent ? (
              <>
                <ScrollPlaceholder />
                <ScrollPlaceholder />
              </>
            ) : null}

            {messageRows.map((row) => (
              <RenderedMessageRow
                key={row.messageKey}
                AssistantMessage={AssistantMessage}
                ImageRenderer={ImageRenderer}
                RenderMessage={RenderMessage}
                UserMessage={UserMessage}
                index={row.relativeIndex}
                inProgress={inProgress}
                markdownTagRenderers={markdownTagRenderers}
                message={row.message}
                messageFeedback={messageFeedback}
                messageKey={row.messageKey}
                messages={messages}
                onCopy={onCopy}
                onRegenerate={onRegenerate}
                onThumbsDown={onThumbsDown}
                onThumbsUp={onThumbsUp}
              />
            ))}

            {chatError && ErrorMessage ? (
              <div style={{ padding: "0 24px 12px" }}>
                <ErrorMessage error={chatError} />
              </div>
            ) : null}
            {children ? <div style={{ padding: "0 24px 12px" }}>{children}</div> : null}
            <div style={{ height: 8 }} />
          </div>
        </div>
      </div>
    </MessageListPerformanceContext.Provider>
  );
};

export default VirtualizedMessages;
