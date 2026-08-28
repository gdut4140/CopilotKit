import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import type { Observable } from "rxjs";
import { createChannel, FakeAdapter } from "@copilotkit/channels-core";
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
});
