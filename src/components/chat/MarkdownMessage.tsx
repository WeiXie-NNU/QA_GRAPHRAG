import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

const MarkdownMessage = memo(({ content, className }: MarkdownMessageProps) => (
  <div className={className}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
));

MarkdownMessage.displayName = "MarkdownMessage";

export default MarkdownMessage;
