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
import { Virtuoso, type ScrollSeekConfiguration, type VirtuosoHandle } from "react-virtuoso";

const OVERSCAN_PX = 480;
const FIRST_ITEM_INDEX_BASE = 100000;

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

const MessagesScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={["copilotKitMessages", "copilotKitMessagesScroller", className]
        .filter(Boolean)
        .join(" ")}
    />
  )
);
MessagesScroller.displayName = "MessagesScroller";

const MessagesList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={["copilotKitMessagesContainer", "copilotKitMessagesList", className]
        .filter(Boolean)
        .join(" ")}
    />
  )
);
MessagesList.displayName = "MessagesList";

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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const deferredLiveMessages = useDeferredValue(liveMessages);
  const initialMessages = useMemo(
    () => filterRenderableMessages(makeInitialMessages(initialContent), false),
    [initialContent]
  );
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX_BASE);
  const [renderedRange, setRenderedRange] = useState({ startIndex: 0, endIndex: -1 });
  const [shellHeight, setShellHeight] = useState(0);
  const isAtBottomRef = useRef(true);
  const loadOlderInFlightRef = useRef(false);
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
  const renderedCount =
    renderedRange.endIndex >= renderedRange.startIndex
      ? renderedRange.endIndex - renderedRange.startIndex + 1
      : 0;
  const savedCount = Math.max(0, messages.length - renderedCount);
  const liveCount = renderableSourceMessages.length;
  const canRenderVirtuoso = shellHeight > 0;

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    prevHistoryCountRef.current = historyCount;
    prevTailKeyRef.current = "";
    loadOlderInFlightRef.current = false;
    setRenderedRange({ startIndex: 0, endIndex: -1 });
    setIsAtBottom(true);
    setFirstItemIndex(FIRST_ITEM_INDEX_BASE);
    setShellHeight(0);
  }, [threadKey]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }

    const updateShellHeight = () => {
      setShellHeight((prev) => {
        const next = node.clientHeight;
        return prev === next ? prev : next;
      });
    };

    updateShellHeight();

    if (typeof ResizeObserver !== "function") {
      const timer = window.setTimeout(updateShellHeight, 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new ResizeObserver(() => {
      updateShellHeight();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [threadKey]);

  useEffect(() => {
    if (historyCount <= prevHistoryCountRef.current) {
      prevHistoryCountRef.current = historyCount;
      return;
    }

    const prependedCount = historyCount - prevHistoryCountRef.current;
    prevHistoryCountRef.current = historyCount;
    setFirstItemIndex((prev) => Math.max(prependedCount + 1, prev - prependedCount));
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
        virtuosoRef.current?.scrollToIndex({
          index: messageRows.length - 1,
          align: "end",
          behavior: "auto",
        });
      });
    }
  }, [inProgress, messageRows.length, tailKey]);

  const triggerLoadOlder = useCallback(() => {
    if (!hasOlderHistory || isLoadingOlderHistory || loadOlderInFlightRef.current || !onLoadOlderHistory) {
      return;
    }
    loadOlderInFlightRef.current = true;
    void Promise.resolve(onLoadOlderHistory()).finally(() => {
      if (!isLoadingOlderHistory) {
        loadOlderInFlightRef.current = false;
      }
    });
  }, [hasOlderHistory, isLoadingOlderHistory, onLoadOlderHistory]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    if (isAtBottomRef.current === atBottom) {
      return;
    }
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const handleRangeChanged = useCallback(
    ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
      setRenderedRange((prev) => {
        if (prev.startIndex === startIndex && prev.endIndex === endIndex) {
          return prev;
        }
        return { startIndex, endIndex };
      });
    },
    []
  );

  const scrollSeekConfiguration = useMemo<ScrollSeekConfiguration>(
    () => ({
      enter: (velocity) => Math.abs(velocity) > 450,
      exit: (velocity) => Math.abs(velocity) < 120,
      change: (_velocity, range) => {
        setRenderedRange((prev) => {
          if (prev.startIndex === range.startIndex && prev.endIndex === range.endIndex) {
            return prev;
          }
          return range;
        });
      },
    }),
    []
  );

  return (
    <div
      ref={shellRef}
      className="copilotKitMessagesShell"
      style={{ position: "relative", height: "100%", minHeight: 0 }}
    >
      {perfEnabled && (
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
          <div>height: {shellHeight}px</div>
        </div>
      )}

      {canRenderVirtuoso ? (
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: "100%" }}
          data={messageRows}
          firstItemIndex={firstItemIndex}
          overscan={OVERSCAN_PX}
          atBottomThreshold={80}
          startReached={triggerLoadOlder}
          atBottomStateChange={handleAtBottomStateChange}
          rangeChanged={handleRangeChanged}
          followOutput={false}
          scrollSeekConfiguration={scrollSeekConfiguration}
          computeItemKey={(_, row) => row.messageKey}
          itemContent={(_, row) => (
            <RenderedMessageRow
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
          )}
          components={{
            Scroller: MessagesScroller,
            List: MessagesList,
            Header: hasOlderHistory || isLoadingOlderHistory
              ? () => (
                  <div style={{ padding: "0 24px 12px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                    {isLoadingOlderHistory ? "加载更早历史中..." : "上滑加载更早历史"}
                  </div>
                )
              : undefined,
            Footer: () => (
              <>
                {chatError && ErrorMessage ? (
                  <div style={{ padding: "0 24px 12px" }}>
                    <ErrorMessage error={chatError} />
                  </div>
                ) : null}
                {children ? <div style={{ padding: "0 24px 12px" }}>{children}</div> : null}
                <div style={{ height: 8 }} />
              </>
            ),
            ScrollSeekPlaceholder: ScrollPlaceholder,
          }}
        />
      ) : (
        <div className="copilotKitMessages copilotKitMessagesScroller">
          <div className="copilotKitMessagesList">
            {hasOlderHistory || isLoadingOlderHistory ? (
              <div style={{ padding: "0 24px 12px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                {isLoadingOlderHistory ? "加载更早历史中..." : "上滑加载更早历史"}
              </div>
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
      )}
    </div>
  );
};

export default VirtualizedMessages;
