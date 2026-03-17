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

function mergeMessageGroups(...groups: Message[][]): Message[] {
  const order: string[] = [];
  const latestById = new Map<string, Message>();

  groups.forEach((group) => {
    group.forEach((message, index) => {
      const messageKey = getMessageKey(message, index);
      if (!latestById.has(messageKey)) {
        order.push(messageKey);
      }
      latestById.set(messageKey, message);
    });
  });

  return order
    .map((messageKey) => latestById.get(messageKey))
    .filter((message): message is Message => Boolean(message));
}

type VirtualizedMessagesProps = MessagesProps & {
  perfEnabled?: boolean;
  historyMessages?: Message[];
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  initialMessages?: string | string[];
  interruptElement?: React.ReactNode;
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
  interruptElement,
  onLoadOlderHistory,
  threadKey = "",
}) => {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const deferredLiveMessages = useDeferredValue(liveMessages);
  const initialMessages = useMemo(() => makeInitialMessages(initialContent), [initialContent]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX_BASE);
  const [renderedRange, setRenderedRange] = useState({ startIndex: 0, endIndex: -1 });
  const isAtBottomRef = useRef(true);
  const loadOlderInFlightRef = useRef(false);
  const prevHistoryCountRef = useRef(0);
  const prevTailKeyRef = useRef("");

  const sourceMessages = useMemo(
    () => (inProgress && !isAtBottom ? deferredLiveMessages : liveMessages),
    [deferredLiveMessages, inProgress, isAtBottom, liveMessages]
  );
  const messages = useMemo(
    () => mergeMessageGroups(initialMessages, historyMessages, sourceMessages),
    [historyMessages, initialMessages, sourceMessages]
  );
  const historyCount = historyMessages.length;
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
  const liveCount = sourceMessages.length;

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
    <div className="copilotKitMessages" style={{ position: "relative", height: "100%" }}>
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
        </div>
      )}

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
          Header: hasOlderHistory || isLoadingOlderHistory
            ? () => (
                <div style={{ padding: "0 24px 12px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  {isLoadingOlderHistory ? "加载更早历史中..." : "上滑加载更早历史"}
                </div>
              )
            : undefined,
          Footer: () => (
            <>
              {interruptElement ? <div style={{ padding: "0 24px 12px" }}>{interruptElement}</div> : null}
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
    </div>
  );
};

export default VirtualizedMessages;
