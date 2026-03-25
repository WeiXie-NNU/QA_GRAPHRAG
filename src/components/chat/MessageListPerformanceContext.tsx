import { createContext, useContext } from "react";

export interface MessageListPerformanceContextValue {
  isScrolling: boolean;
  isScrollSeeking: boolean;
}

const MessageListPerformanceContext = createContext<MessageListPerformanceContextValue>({
  isScrolling: false,
  isScrollSeeking: false,
});

export function useMessageListPerformance(): MessageListPerformanceContextValue {
  return useContext(MessageListPerformanceContext);
}

export default MessageListPerformanceContext;
