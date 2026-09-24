"use client";

import type { ReactNode } from "react";
import { ChatHeader } from "@/features/chat/components/ChatHeader";
import { ChatPanel } from "@/features/chat/components/ChatPanel";
import type { ChatMessage } from "@/features/chat/use-chat-turn";
import { ClausePanel } from "@/features/clauses/components/ClausePanel";
import { FieldPanel } from "@/features/documents/components/FieldPanel";
import type { DocumentView, RuleAction } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import type { ActionFailure } from "@/lib/http";
import { TabBar, type TabItem } from "@/shared/ui/TabBar";
import { TabPanel } from "@/shared/ui/TabPanel";
import type { DocumentProgress } from "../workspace-status";

export type AssistantView = "chat" | "details" | "clauses";

export interface ChatControls {
  messages: ChatMessage[];
  busy: boolean;
  failure: ActionFailure | null;
  disabledReason: string | null;
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  onRetry(): void;
  onLanguage(language: ChatLanguage | null): void;
}

interface Props {
  doc: DocumentView;
  inactive: ReadonlySet<string>;
  progress: DocumentProgress;
  tabs: TabItem<AssistantView>[];
  view: AssistantView;
  onView(view: AssistantView): void;
  /** Narrow screens show one region at a time; true while the document is in front. */
  hidden: boolean;
  hasDraft: boolean;
  chat: ChatControls;
  nextStep: ReactNode;
  onRuleAction(ruleId: string, action: RuleAction): Promise<unknown>;
}

/** The assistant side: the conversation, the details and the conditional clauses. */
export function AssistantPane({ doc, inactive, progress, tabs, view, onView, hidden, hasDraft, chat, nextStep, onRuleAction }: Props) {
  return (
    <aside
      aria-label="Assistant and details"
      className={`flex min-h-0 flex-col bg-surface max-lg:absolute max-lg:inset-0 max-lg:transition-[opacity,visibility] max-lg:duration-200 lg:w-[clamp(380px,32vw,480px)] lg:shrink-0 lg:border-r lg:border-line ${hidden ? "max-lg:pointer-events-none max-lg:invisible max-lg:opacity-0" : ""}`}
    >
      <div className="shrink-0 border-b border-line px-2 max-lg:hidden sm:px-3">
        <TabBar<AssistantView> idBase="assistant" label="Assistant views" value={view} onChange={onView} items={tabs} />
      </div>
      <div className="relative min-h-0 flex-1">
        <TabPanel base="assistant" id="chat" active={view === "chat"} className="flex flex-col">
          <ChatPanel
            messages={chat.messages}
            busy={chat.busy}
            error={chat.failure}
            header={<ChatHeader language={doc.analysis === "ai" ? doc.language : null} onLanguage={chat.onLanguage} />}
            disabledReason={chat.disabledReason}
            onSend={chat.onSend}
            onStop={chat.onStop}
            onRetry={chat.onRetry}
            footer={nextStep}
          />
        </TabPanel>
        <TabPanel base="assistant" id="details" active={view === "details"} scroll>
          <FieldPanel documentId={doc.id} fields={doc.fields} inactive={inactive} locked={hasDraft} assistant={doc.analysis === "ai"} />
        </TabPanel>
        {progress.hasClauses && (
          <TabPanel base="assistant" id="clauses" active={view === "clauses"} scroll>
            <ClausePanel
              documentId={doc.id}
              rules={doc.rules}
              fields={doc.fields}
              language={doc.language.effective}
              locked={hasDraft}
              ruleIssues={doc.ruleIssues}
              structureIssues={doc.structureIssues}
              onAction={onRuleAction}
            />
          </TabPanel>
        )}
      </div>
    </aside>
  );
}
