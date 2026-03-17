import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ChatComposerProps {
  disabled?: boolean;
  inProgress?: boolean;
  onSend: (message: string) => Promise<void> | void;
  onStop?: () => void;
  placeholder?: string;
}

function autoResize(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

export const ChatComposer = memo(({
  disabled = false,
  inProgress = false,
  onSend,
  onStop,
  placeholder = "询问任何问题",
}: ChatComposerProps) => {
  const [value, setValue] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    autoResize(textareaRef.current);
  }, [value]);

  const submit = useCallback(async () => {
    const next = value.trim();
    if (!next || disabled || inProgress) {
      return;
    }

    setValue("");
    await onSend(next);
  }, [disabled, inProgress, onSend, value]);

  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || isComposing || event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      await submit();
    },
    [isComposing, submit]
  );

  const canSend = useMemo(() => !disabled && !inProgress && value.trim().length > 0, [disabled, inProgress, value]);

  const handleContainerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.tagName === "TEXTAREA") {
      return;
    }
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="copilotKitInputContainer">
      <div className="copilotKitInput" onClick={handleContainerClick}>
        <textarea
          id="chat-composer-input"
          ref={textareaRef}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          autoFocus={false}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={handleKeyDown}
        />
        <div className="copilotKitInputControls">
          {inProgress ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
              className="copilotKitInputControlButton"
              data-copilotkit-in-progress="true"
              data-test-id="copilot-chat-request-in-progress"
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>■</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void submit();
              }}
              aria-label="发送消息"
              title="发送消息"
              disabled={!canSend}
              className="copilotKitInputControlButton"
              data-copilotkit-in-progress="false"
              data-test-id="copilot-chat-ready"
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>↑</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

ChatComposer.displayName = "ChatComposer";

export default ChatComposer;
