import React from "react";
import {
  useCopilotChatInternal,
  useLangGraphInterrupt,
} from "@copilotkit/react-core";
import { HITLInterruptCard } from "./HITLInterruptCard";

export const HITLInterruptLayer: React.FC = () => {
  const { interrupt } = useCopilotChatInternal();

  useLangGraphInterrupt({
    render: ({ event, resolve }) => (
      <HITLInterruptCard
        eventValue={event?.value}
        resolve={resolve as any}
        summaryMode="floating"
      />
    ),
  });

  if (!interrupt) {
    return null;
  }

  return (
    <div className="copilotKitGlobalInterruptHost" aria-live="polite">
      {interrupt}
    </div>
  );
};

export default HITLInterruptLayer;
