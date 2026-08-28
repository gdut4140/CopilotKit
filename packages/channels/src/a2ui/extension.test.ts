import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import type { Observable } from "rxjs";
import { z } from "zod";
import {
  createChannel,
  FakeAdapter,
  FakeAgent,
  Section,
} from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-core";
import { createChannelA2UICatalog } from "./catalog.js";
import { createChannelA2UI } from "./extension.js";

const DEFAULT_PROBE_COMPONENTS: Array<Record<string, unknown>> = [
  { id: "root", component: "Column", children: ["title"] },
  { id: "title", component: "Text", text: "Deployments", variant: "h2" },
];

class MiddlewareProbeAgent extends AbstractAgent {
  constructor(
    readonly seenInputs: RunAgentInput[] = [],
    readonly components: Array<
      Record<string, unknown>
    > = DEFAULT_PROBE_COMPONENTS,
  ) {
    super({ agentId: "a2ui-probe" });
  }

  override clone(): MiddlewareProbeAgent {
    const clone = new MiddlewareProbeAgent(this.seenInputs, this.components);
    clone.threadId = this.threadId;
    return clone;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.seenInputs.push(input);
    const args = JSON.stringify({
      surfaceId: "deployment",
      components: this.components,
    });
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "render-1",
        toolCallName: "render_a2ui",
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "render-1",
        delta: args,
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "render-1" },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

const findNode = (
  nodes: ChannelNode[],
  type: string,
): ChannelNode | undefined => {
  for (const node of nodes) {
    if (node.type === type) return node;
    const children = node.props.children;
    if (Array.isArray(children)) {
      const nested = findNode(children as ChannelNode[], type);
      if (nested) return nested;
    }
  }
  return undefined;
};

const textSurfaceOperations = (text: string, weight?: number) => [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "deployment",
      catalogId: "copilotkit://progressive/v1",
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "deployment",
      components: [
        { id: "root", component: "Column", children: ["title"] },
        {
          id: "title",
          component: "Text",
          text,
          variant: "h2",
          ...(weight === undefined ? {} : { weight }),
        },
      ],
    },
  },
];

describe("createChannelA2UI", () => {
  it("observes building and painted activity from middleware attached after cloning", async () => {
    const adapter = new FakeAdapter();
    const agent = new MiddlewareProbeAgent();
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        catalogId: "copilotkit://channels-mvp/v1",
        includeChannelBasicCatalog: true,
      },
    );
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent,
      extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await adapter.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "show deployments",
      platform: "fake",
    });

    expect(adapter.posted).toHaveLength(1);
    expect(adapter.updated.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(adapter.posted[0])).toContain("Building interface");
    expect(JSON.stringify(adapter.updated.at(-1)?.ir)).toContain("Deployments");
    expect(JSON.stringify(adapter.updated)).not.toContain("can’t be displayed");
    expect(agent.seenInputs[0]?.tools?.map((tool) => tool.name)).toContain(
      "render_a2ui",
    );
    expect(
      agent.seenInputs[0]?.context?.some(
        (entry) =>
          entry.description ===
          "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.",
      ),
    ).toBe(true);
  });

  it("fails preparation with an actionable error for a non-middleware agent", () => {
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const extension = createChannelA2UI({ catalog });

    expect(() =>
      extension.prepareAgent?.({} as never, { threadId: "c1" }),
    ).toThrow("Channel A2UI requires an AG-UI agent that supports middleware");
  });

  it("injects a custom catalog and forwards the exact Button action", async () => {
    const components = [
      {
        id: "root",
        component: "Column",
        children: ["title", "api", "web", "worker", "retry"],
      },
      {
        id: "title",
        component: "Text",
        text: "Deployment status",
        variant: "h2",
      },
      {
        id: "api",
        component: "ServiceStatus",
        service: "api",
        status: "healthy",
      },
      {
        id: "web",
        component: "ServiceStatus",
        service: "web",
        status: "failed",
      },
      {
        id: "worker",
        component: "ServiceStatus",
        service: "worker",
        status: "healthy",
      },
      { id: "retry-label", component: "Text", text: "Retry failures" },
      {
        id: "retry",
        component: "Button",
        child: "retry-label",
        variant: "primary",
        action: {
          event: {
            name: "retry_failures",
            context: { services: ["web"] },
          },
        },
      },
    ];
    const catalog = createChannelA2UICatalog(
      {
        ServiceStatus: {
          description: "Deployment status for one named service",
          props: z
            .object({
              service: z.string(),
              status: z.enum(["healthy", "failed"]),
            })
            .strict(),
        },
      },
      {
        ServiceStatus: ({ props }) =>
          Section({
            children: `${props.status === "healthy" ? "✓" : "✗"} ${props.service}: ${props.status}`,
          }),
      },
      {
        catalogId: "copilotkit://deployment-status/v1",
        includeChannelBasicCatalog: true,
      },
    );
    const adapter = new FakeAdapter();
    const agent = new MiddlewareProbeAgent([], components);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent,
      extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });
    await channel.ɵruntime.start();
    await adapter.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "show deployments",
      platform: "fake",
    });

    expect(
      agent.seenInputs[0]?.context
        ?.map((entry) => String(entry.value))
        .join("\n"),
    ).toContain("ServiceStatus");
    expect(JSON.stringify(adapter.updated.at(-1)?.ir)).toContain("web: failed");

    const button = findNode(adapter.updated.at(-1)!.ir, "button")!;
    expect(button.key).toBe("deployment:retry:retry_failures");
    const actionId = (button.props.onClick as { id: string }).id;
    await adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "c1",
      replyTarget: {},
      value: undefined,
    });
    await vi.waitFor(() => expect(agent.seenInputs).toHaveLength(2));

    expect(agent.seenInputs[1]?.forwardedProps?.a2uiAction).toEqual({
      userAction: {
        name: "retry_failures",
        surfaceId: "deployment",
        sourceComponentId: "retry",
        context: { services: ["web"] },
        timestamp: expect.any(String),
      },
    });
  });

  it("posts once and applies ordered progressive surface updates", async () => {
    const adapter = new FakeAdapter();
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        catalogId: "copilotkit://progressive/v1",
        includeChannelBasicCatalog: true,
      },
    );
    const agent = new FakeAgent([
      async (subscriber) => {
        await subscriber.onActivitySnapshotEvent?.({
          event: {
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId: "activity-1",
            activityType: "a2ui-surface",
            content: { a2ui_operations: textSurfaceOperations("Checking") },
            replace: true,
          },
        } as never);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await subscriber.onActivitySnapshotEvent?.({
          event: {
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId: "activity-1",
            activityType: "a2ui-surface",
            content: {
              a2ui_operations: textSurfaceOperations("Ready", 700),
            },
            replace: true,
          },
        } as never);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await subscriber.onActivitySnapshotEvent?.({
          event: {
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId: "activity-1",
            activityType: "a2ui-surface",
            content: { a2ui_operations: textSurfaceOperations("Ready") },
            replace: true,
          },
        } as never);
      },
    ]);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent,
      extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });
    await channel.ɵruntime.start();
    await adapter.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "status",
      platform: "fake",
    });

    expect(adapter.posted).toHaveLength(1);
    expect(adapter.updated).toHaveLength(2);
    expect(JSON.stringify(adapter.updated[0]?.ir)).toContain("Checking");
    expect(JSON.stringify(adapter.updated[1]?.ir)).toContain("Ready");
  });

  it("renders a visible fallback for an unsupported component", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const adapter = new FakeAdapter();
      const catalog = createChannelA2UICatalog(
        {},
        {},
        {
          catalogId: "copilotkit://unsupported/v1",
          includeChannelBasicCatalog: true,
        },
      );
      const agent = new FakeAgent([
        async (subscriber) => {
          await subscriber.onActivitySnapshotEvent?.({
            event: {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: "unsupported-1",
              activityType: "a2ui-surface",
              content: {
                a2ui_operations: [
                  {
                    version: "v0.9",
                    createSurface: {
                      surfaceId: "unsupported",
                      catalogId: catalog.id,
                    },
                  },
                  {
                    version: "v0.9",
                    updateComponents: {
                      surfaceId: "unsupported",
                      components: [
                        { id: "root", component: "Tabs", tabItems: [] },
                      ],
                    },
                  },
                ],
              },
              replace: true,
            },
          } as never);
        },
      ]);
      const channel = createChannel({
        identifyUser: "platform",
        adapters: [adapter],
        agent,
        extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
      });
      channel.onMention(async ({ thread }) => {
        await thread.runAgent();
      });
      await channel.ɵruntime.start();
      await adapter.getSink().onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "tabs",
        platform: "fake",
      });

      expect(JSON.stringify(adapter.updated.at(-1)?.ir)).toContain(
        "can’t be displayed",
      );
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("unsupported_component:Tabs"),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("renders a visible fallback for an unknown catalog", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const adapter = new FakeAdapter();
      const catalog = createChannelA2UICatalog(
        {},
        {},
        {
          catalogId: "copilotkit://known/v1",
          includeChannelBasicCatalog: true,
        },
      );
      const agent = new FakeAgent([
        async (subscriber) => {
          await subscriber.onActivitySnapshotEvent?.({
            event: {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: "unknown-catalog-1",
              activityType: "a2ui-surface",
              content: {
                a2ui_operations: [
                  {
                    version: "v0.9",
                    createSurface: {
                      surfaceId: "unknown-catalog",
                      catalogId: "copilotkit://unknown/v1",
                    },
                  },
                  {
                    version: "v0.9",
                    updateComponents: {
                      surfaceId: "unknown-catalog",
                      components: [
                        {
                          id: "root",
                          component: "Column",
                          children: ["title"],
                        },
                        { id: "title", component: "Text", text: "Hidden" },
                      ],
                    },
                  },
                ],
              },
              replace: true,
            },
          } as never);
        },
      ]);
      const channel = createChannel({
        identifyUser: "platform",
        adapters: [adapter],
        agent,
        extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
      });
      channel.onMention(async ({ thread }) => {
        await thread.runAgent();
      });
      await channel.ɵruntime.start();
      await adapter.getSink().onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "unknown catalog",
        platform: "fake",
      });

      expect(JSON.stringify(adapter.updated.at(-1)?.ir)).toContain(
        "can’t be displayed",
      );
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("unsupported_catalog"),
      );
      expect(JSON.stringify(adapter.updated.at(-1)?.ir)).not.toContain(
        "Hidden",
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("retains the last good surface after an invalid activity patch", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const adapter = new FakeAdapter();
      const catalog = createChannelA2UICatalog(
        {},
        {},
        {
          catalogId: "copilotkit://progressive/v1",
          includeChannelBasicCatalog: true,
        },
      );
      const agent = new FakeAgent([
        async (subscriber) => {
          await subscriber.onActivitySnapshotEvent?.({
            event: {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: "activity-1",
              activityType: "a2ui-surface",
              content: {
                a2ui_operations: textSurfaceOperations("Last good"),
              },
              replace: true,
            },
          } as never);
          await subscriber.onActivityDeltaEvent?.({
            event: {
              type: EventType.ACTIVITY_DELTA,
              messageId: "activity-1",
              activityType: "a2ui-surface",
              patch: [
                {
                  op: "replace",
                  path: "/missing",
                  value: "secret-should-not-log",
                },
              ],
            },
          } as never);
        },
      ]);
      const channel = createChannel({
        identifyUser: "platform",
        adapters: [adapter],
        agent,
        extensions: [createChannelA2UI({ catalog, minUpdateIntervalMs: 0 })],
      });
      channel.onMention(async ({ thread }) => {
        await thread.runAgent();
      });
      await channel.ɵruntime.start();
      await adapter.getSink().onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "status",
        platform: "fake",
      });

      expect(adapter.updated).toHaveLength(1);
      expect(JSON.stringify(adapter.updated[0]?.ir)).toContain("Last good");
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("invalid_activity_patch"),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "secret-should-not-log",
      );
    } finally {
      warning.mockRestore();
    }
  });
});
