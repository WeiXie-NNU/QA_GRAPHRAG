import type { Message } from "@copilotkit/shared";
import type {
  ImageRendererProps,
  RenderMessageProps,
  UserMessageProps,
} from "@copilotkit/react-ui";

function getUserTextContent(content: UserMessageProps["message"] extends { content?: infer T } ? T : never): string | undefined {
  if (typeof content === "undefined") {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return (
    content
      .map((part: any) => (part?.type === "text" ? part.text : undefined))
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .trim() || undefined
  );
}

export const DefaultImageRenderer = ({ content, image }: ImageRendererProps) => (
  <div className="copilotKitImageRendering">
    <img
      className="copilotKitImageRenderingImage"
      src={`data:image/${image.format};base64,${image.bytes}`}
      alt={content || "uploaded image"}
    />
    {content ? <div className="copilotKitImageRenderingContent">{content}</div> : null}
  </div>
);

export const DefaultUserMessage = ({ message, ImageRenderer }: UserMessageProps) => {
  const imageMessage = message as Message & { image?: ImageRendererProps["image"] };
  if (imageMessage?.image) {
    const content = getUserTextContent(message?.content as any);
    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        <ImageRenderer image={imageMessage.image} content={content} />
      </div>
    );
  }

  return (
    <div className="copilotKitMessage copilotKitUserMessage">
      {getUserTextContent(message?.content as any)}
    </div>
  );
};

export function DefaultRenderMessage({
  UserMessage,
  AssistantMessage,
  ImageRenderer,
  ...props
}: RenderMessageProps) {
  const {
    message,
    messages,
    inProgress,
    index,
    isCurrentMessage,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    messageFeedback,
    markdownTagRenderers,
  } = props;
  const UserRenderer = UserMessage ?? DefaultUserMessage;
  const AssistantRenderer = AssistantMessage as React.ComponentType<any> | undefined;
  const ImageRendererComponent = ImageRenderer ?? DefaultImageRenderer;

  if (message.role === "user") {
    return (
      <UserRenderer
        key={index}
        rawData={message}
        data-message-role="user"
        message={message as any}
        ImageRenderer={ImageRendererComponent}
      />
    );
  }

  if (message.role === "assistant" && AssistantRenderer) {
    return (
      <AssistantRenderer
        key={index}
        data-message-role="assistant"
        subComponent={message.generativeUI?.()}
        rawData={message}
        message={message as any}
        messages={messages}
        isLoading={inProgress && isCurrentMessage && !message.content}
        isGenerating={inProgress && isCurrentMessage && !!message.content}
        isCurrentMessage={isCurrentMessage}
        onRegenerate={() => onRegenerate?.(message.id)}
        onCopy={onCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        feedback={messageFeedback?.[message.id] || null}
        markdownTagRenderers={markdownTagRenderers}
        ImageRenderer={ImageRendererComponent}
      />
    );
  }

  return null;
}
