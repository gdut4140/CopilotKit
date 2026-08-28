import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const ready = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const status = vi.fn(() => ({
    overall: "online",
    channels: { "a2ui-demo": "online" },
    detail: {
      "a2ui-demo": {
        status: "online",
        transport: "online",
        provider: "attached",
      },
    },
  }));
  const listener = Object.assign(vi.fn(), {
    channels: { ready, status, stop },
  });
  const server = {
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      callback?.();
    }),
    close: vi.fn((callback?: (error?: Error) => void) => callback?.()),
  };
  const bot = { onMention: vi.fn() };
  const extension = { createRun: vi.fn() };
  const httpAgents: Array<{ threadId: string }> = [];
  return {
    ready,
    stop,
    status,
    listener,
    server,
    bot,
    extension,
    createServer: vi.fn(() => server),
    createChannel: vi.fn((_options: unknown) => bot),
    createSearchResultCatalog: vi.fn(() => ({ id: "catalog" })),
    createChannelA2UI: vi.fn(() => extension),
    createCopilotNodeListener: vi.fn(() => listener),
    runtimeOptions: undefined as unknown,
    CopilotRuntime: vi.fn(function CopilotRuntime(options: unknown) {
      fakes.runtimeOptions = options;
    }),
    CopilotKitIntelligence: vi.fn(function CopilotKitIntelligence() {}),
    httpAgents,
    HttpAgent: vi.fn(function HttpAgent(options: unknown) {
      const agent = { threadId: "", options };
      httpAgents.push(agent);
      return agent;
    }),
  };
});

vi.mock("node:http", () => ({ createServer: fakes.createServer }));
vi.mock("@copilotkit/channels", () => ({
  createChannel: fakes.createChannel,
  HttpAgent: fakes.HttpAgent,
}));
vi.mock("@copilotkit/channels/a2ui", () => ({
  createChannelA2UI: fakes.createChannelA2UI,
}));
vi.mock("@copilotkit/runtime/v2", () => ({
  CopilotRuntime: fakes.CopilotRuntime,
  CopilotKitIntelligence: fakes.CopilotKitIntelligence,
}));
vi.mock("@copilotkit/runtime/v2/node", () => ({
  createCopilotNodeListener: fakes.createCopilotNodeListener,
}));
vi.mock("./a2ui-search-catalog.js", () => ({
  createSearchResultCatalog: fakes.createSearchResultCatalog,
}));

const envKeys = [
  "AGENT_URL",
  "CHANNEL_CODE",
  "INTELLIGENCE_API_KEY",
  "PORT",
] as const;

describe("managed Slack A2UI POC entrypoint", () => {
  const previousEnv = new Map<string, string | undefined>();

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
    vi.unstubAllGlobals();
  });

  it("activates the env-selected Channel with A2UI and an attached provider", async () => {
    for (const key of envKeys) previousEnv.set(key, process.env[key]);
    process.env.CHANNEL_CODE = "a2ui-demo";
    process.env.INTELLIGENCE_API_KEY = "cpk-test";
    process.env.PORT = "8310";
    process.env.AGENT_URL = "http://adk.test:8000/";
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetch);

    let sigterm: (() => void) | undefined;
    vi.spyOn(process, "once").mockImplementation(((event, listener) => {
      if (event === "SIGTERM") sigterm = listener as () => void;
      return process;
    }) as typeof process.once);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never) as typeof process.exit);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./a2ui-managed.js");
    await vi.waitFor(() => expect(fakes.server.listen).toHaveBeenCalledOnce());

    expect(fakes.CopilotKitIntelligence).toHaveBeenCalledWith({
      apiKey: "cpk-test",
    });
    expect(fakes.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "a2ui-demo",
        identifyUser: "platform",
        agent: expect.any(Function),
        extensions: [
          fakes.extension,
          expect.objectContaining({ prepareAgent: expect.any(Function) }),
        ],
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("health", "http://adk.test:8000/"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fakes.createSearchResultCatalog).toHaveBeenCalledOnce();
    expect(fakes.ready).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    expect(fakes.status).toHaveBeenCalledOnce();
    expect(fakes.runtimeOptions).toEqual(
      expect.objectContaining({ channels: [fakes.bot] }),
    );
    expect(fakes.server.listen).toHaveBeenCalledWith(
      8310,
      "127.0.0.1",
      expect.any(Function),
    );

    const channelOptions = fakes.createChannel.mock.calls[0]?.[0] as
      | {
          agent: (threadId: string) => { threadId: string };
          extensions: Array<{
            prepareAgent?: (
              agent: { use: (middleware: unknown) => void },
              context: { threadId: string },
            ) => void;
          }>;
        }
      | undefined;
    const agent = channelOptions?.agent("slack-thread-1");
    expect(fakes.HttpAgent).toHaveBeenCalledWith({
      url: "http://adk.test:8000/",
    });
    expect(agent?.threadId).toBe("slack-thread-1");

    const use = vi.fn();
    channelOptions?.extensions[1]?.prepareAgent?.(
      { use },
      { threadId: "slack-thread-1" },
    );
    const middleware = use.mock.calls[0]?.[0] as
      | ((
          input: {
            forwardedProps: Record<string, unknown>;
            messages: unknown[];
          },
          next: { run: (input: unknown) => unknown },
        ) => unknown)
      | undefined;
    const next = { run: vi.fn(() => "stream") };
    const stream = middleware?.(
      {
        forwardedProps: {
          a2uiAction: {
            userAction: { name: "acknowledge_search_result" },
          },
        },
        messages: [{ id: "synthetic-action-result", role: "tool" }],
      },
      next,
    );
    expect(stream).toBe("stream");
    expect(next.run).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { id: "synthetic-action-result", role: "tool" },
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("acknowledge_search_result"),
          }),
        ],
      }),
    );

    const runAgent = vi.fn(async () => {});
    const mention = fakes.bot.onMention.mock.calls[0]?.[0] as
      | ((input: {
          thread: { runAgent: typeof runAgent };
          message: { text: string };
        }) => Promise<void>)
      | undefined;
    await mention?.({
      thread: { runAgent },
      message: { text: "show the A2UI POC" },
    });
    expect(runAgent).toHaveBeenCalledWith({ prompt: "show the A2UI POC" });

    sigterm?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(fakes.stop).toHaveBeenCalledOnce();
    expect(fakes.server.close).toHaveBeenCalledOnce();
  });
});
