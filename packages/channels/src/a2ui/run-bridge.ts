import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import {
  Context,
  Message,
  Section,
  stableStringify,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  ChannelRunExtension,
  InteractionContext,
  Thread,
} from "@copilotkit/channels-core";
import { A2UIActivityDocument } from "./activity-document.js";
import {
  A2UIIncompleteSurfaceError,
  A2UIUnsupportedComponentError,
  lowerSurface,
} from "./lower-surface.js";
import { A2UIMessageUpdater } from "./message-updater.js";
import type { ChannelA2UICatalog } from "./types.js";

const buildingMessage = () =>
  Message({
    fallbackText: "Building interface…",
    children: Context({ children: "Building interface…" }),
  });

const unsupportedMessage = () =>
  Message({
    fallbackText: "This interactive interface is unavailable in this channel.",
    children: Section({
      children: "This interactive interface can’t be displayed here.",
    }),
  });

const presentSurface = (ir: ChannelNode[]): ChannelNode =>
  ir.length === 1 && ir[0]?.type === "message"
    ? ir[0]
    : Message({ fallbackText: "Interactive interface", children: ir });

class A2UIActivitySession {
  private readonly document = new A2UIActivityDocument();
  private readonly updater: A2UIMessageUpdater;
  private started?: Promise<void>;
  private hasValidSurface = false;
  private fallbackOffered = false;
  private interactionThread?: InteractionContext["thread"];

  constructor(
    private readonly messageId: string,
    private readonly thread: Thread,
    private readonly catalog: ChannelA2UICatalog,
    minUpdateIntervalMs: number,
  ) {
    this.updater = new A2UIMessageUpdater(thread, minUpdateIntervalMs);
  }

  async replace(content: Record<string, unknown>): Promise<void> {
    this.document.replace(content);
    await this.renderLatest();
  }

  async patch(patch: unknown[]): Promise<void> {
    this.document.patch(patch);
    await this.renderLatest();
  }

  async finish(): Promise<void> {
    if (!this.started) return;
    if (!this.hasValidSurface && !this.fallbackOffered) {
      this.offerFallback("final");
    }
    await this.updater.finish();
  }

  private ensureStarted(): Promise<void> {
    this.started ??= this.updater.start(buildingMessage());
    return this.started;
  }

  private async renderLatest(): Promise<void> {
    await this.ensureStarted();
    const operations = this.document.operations;
    if (!operations) return;
    try {
      const catalogIds = operations.flatMap((operation) => {
        const create = operation.createSurface;
        return typeof create === "object" &&
          create !== null &&
          typeof (create as { catalogId?: unknown }).catalogId === "string"
          ? [(create as { catalogId: string }).catalogId]
          : [];
      });
      const unsupportedCatalog = catalogIds.find(
        (id) => id !== this.catalog.id,
      );
      if (unsupportedCatalog) {
        throw new Error("unsupported_catalog");
      }
      const processor = new MessageProcessor(
        [this.catalog.processorCatalog],
        async (action) => {
          const thread = this.interactionThread ?? this.thread;
          await thread.runAgent({
            forwardedProps: { a2uiAction: { userAction: action } },
          });
        },
      );
      processor.processMessages([...operations] as unknown as A2uiMessage[]);
      const surfaces = [...processor.model.surfacesMap.values()];
      if (surfaces.length !== 1 || !surfaces[0]) {
        throw new A2UIIncompleteSurfaceError();
      }
      const ir = lowerSurface(surfaces[0], {
        dispatchAction: (interaction, dispatch) =>
          this.dispatchFromInteraction(interaction, dispatch),
      });
      this.updater.offer(presentSurface(ir), stableStringify(ir));
      this.hasValidSurface = true;
    } catch (error) {
      if (error instanceof A2UIIncompleteSurfaceError) return;
      const code =
        error instanceof A2UIUnsupportedComponentError
          ? `unsupported_component:${error.componentName}`
          : error instanceof Error && error.message === "unsupported_catalog"
            ? "unsupported_catalog"
            : "processing_failed";
      console.warn(`[channels/a2ui] ${this.messageId}: ${code}`);
      if (!this.hasValidSurface) this.offerFallback(code);
    }
  }

  private dispatchFromInteraction(
    interaction: InteractionContext,
    dispatch: () => Promise<void>,
  ): Promise<void> {
    const previous = this.interactionThread;
    this.interactionThread = interaction.thread;
    try {
      return dispatch();
    } finally {
      this.interactionThread = previous;
    }
  }

  private offerFallback(code: string): void {
    this.fallbackOffered = true;
    this.updater.offer(unsupportedMessage(), `fallback:${code}`);
  }
}

export function createA2UIRunBridge(options: {
  thread: Thread;
  catalog: ChannelA2UICatalog;
  minUpdateIntervalMs: number;
}): ChannelRunExtension {
  const sessions = new Map<string, A2UIActivitySession>();
  const getSession = (messageId: string): A2UIActivitySession => {
    let session = sessions.get(messageId);
    if (!session) {
      session = new A2UIActivitySession(
        messageId,
        options.thread,
        options.catalog,
        options.minUpdateIntervalMs,
      );
      sessions.set(messageId, session);
    }
    return session;
  };
  return {
    subscriber: {
      async onActivitySnapshotEvent({ event }) {
        if (event.activityType !== "a2ui-surface") return;
        await getSession(event.messageId).replace(event.content);
      },
      async onActivityDeltaEvent({ event }) {
        if (event.activityType !== "a2ui-surface") return;
        try {
          await getSession(event.messageId).patch(event.patch);
        } catch {
          console.warn(
            `[channels/a2ui] ${event.messageId}: invalid_activity_patch`,
          );
        }
      },
    },
    async finish() {
      await Promise.all(
        [...sessions.values()].map((session) => session.finish()),
      );
    },
  };
}
