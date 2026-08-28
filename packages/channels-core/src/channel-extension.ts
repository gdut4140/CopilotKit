import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type { Thread } from "./thread.js";

export interface ChannelAgentPreparationContext {
  readonly threadId: string;
}

export interface ChannelRunExtensionContext {
  readonly thread: Thread;
  readonly platform: string;
}

export interface ChannelRunExtension {
  readonly subscriber: AgentSubscriber;
  finish?(): void | Promise<void>;
}

export interface ChannelExtension {
  prepareAgent?(
    agent: AbstractAgent,
    context: ChannelAgentPreparationContext,
  ): void;
  createRun?(
    context: ChannelRunExtensionContext,
  ): ChannelRunExtension | undefined;
}
