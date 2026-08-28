import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createChannel, HttpAgent } from "@copilotkit/channels";
import type { ChannelExtension } from "@copilotkit/channels";
import { createChannelA2UI } from "@copilotkit/channels/a2ui";
import { CopilotKitIntelligence, CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

import { createSearchResultCatalog } from "./a2ui-search-catalog.js";

const required = (name: "CHANNEL_CODE" | "INTELLIGENCE_API_KEY"): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const agentUrl = (): string => {
  const url = new URL(process.env.AGENT_URL ?? "http://localhost:8000/");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
};

async function assertAgentHealthy(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL("health", url), {
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    throw new Error(
      `ADK agent is not reachable at ${url}. Start examples/integrations/adk/agent/main.py first.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `ADK agent health check failed at ${new URL("health", url)} (HTTP ${response.status}).`,
    );
  }
}

const createAdkA2UIActionCompatibility = (): ChannelExtension => ({
  prepareAgent(agent) {
    // ag-ui-adk 0.7 treats A2UI's synthetic tool-only action as a continuation
    // with no persisted server call. A trailing user turn starts the response.
    agent.use((input, next) => {
      const action = input.forwardedProps?.a2uiAction as
        | { userAction?: { name?: unknown } }
        | undefined;
      const name = action?.userAction?.name;
      if (typeof name !== "string") return next.run(input);

      return next.run({
        ...input,
        messages: [
          ...input.messages,
          {
            id: randomUUID(),
            role: "user",
            content: `The user performed the A2UI action "${name}". Respond briefly to that action.`,
          },
        ],
      });
    });
  },
});

async function main(): Promise<void> {
  const channelCode = required("CHANNEL_CODE");
  const intelligenceApiKey = required("INTELLIGENCE_API_KEY");
  const url = agentUrl();
  await assertAgentHealthy(url);
  const catalog = createSearchResultCatalog();
  const channel = createChannel({
    name: channelCode,
    identifyUser: "platform",
    agent: (threadId) => {
      const agent = new HttpAgent({ url });
      agent.threadId = threadId;
      return agent;
    },
    extensions: [
      createChannelA2UI({ catalog, minUpdateIntervalMs: 250 }),
      createAdkA2UIActionCompatibility(),
    ],
  });

  channel.onMention(async ({ thread, message }) => {
    await thread.runAgent({ prompt: message.text });
  });

  const intelligence = new CopilotKitIntelligence({
    apiKey: intelligenceApiKey,
  });
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    channels: [channel],
  });
  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
  });

  await listener.channels.ready({ timeoutMs: 30_000 });
  const status = listener.channels.status();
  const detail = status.detail[channelCode];
  if (
    status.overall !== "online" ||
    detail?.transport !== "online" ||
    detail.provider !== "attached"
  ) {
    await listener.channels.stop();
    throw new Error(
      `Managed Channel "${channelCode}" is not ready ` +
        `(overall=${status.overall}, transport=${detail?.transport ?? "unknown"}, ` +
        `provider=${detail?.provider ?? "unknown"})`,
    );
  }

  const server = createServer(listener);
  const port = Number(process.env.PORT ?? 8300);
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      console.log(`[a2ui-poc] received ${signal}, stopping…`);
      const results = await Promise.allSettled([
        listener.channels.stop(),
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
      ]);
      const failed = results.some((result) => result.status === "rejected");
      if (failed) console.error("[a2ui-poc] shutdown did not complete cleanly");
      process.exit(failed ? 1 : 0);
    })();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  console.log(
    `[a2ui-poc] managed Channel "${channelCode}" is online; listener on 127.0.0.1:${port}`,
  );
}

void main().catch((error: unknown) => {
  console.error("[a2ui-poc] startup failed", error);
  process.exit(1);
});
