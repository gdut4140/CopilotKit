import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import type { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import type { ChannelExtension } from "@copilotkit/channels-core";
import { createA2UIRunBridge } from "./run-bridge.js";
import type { ChannelA2UICatalog } from "./types.js";

type MiddlewareCapableAgent = {
  use?: (middleware: unknown) => void;
};

export interface CreateChannelA2UIOptions {
  readonly catalog: ChannelA2UICatalog;
  readonly injectA2UITool?: boolean | string;
  readonly minUpdateIntervalMs?: number;
  readonly recovery?: A2UIMiddlewareConfig["recovery"];
}

export function createChannelA2UI(
  options: CreateChannelA2UIOptions,
): ChannelExtension {
  const minUpdateIntervalMs = options.minUpdateIntervalMs ?? 800;
  if (minUpdateIntervalMs < 0) {
    throw new Error("minUpdateIntervalMs must be non-negative");
  }
  return {
    prepareAgent(agent) {
      const middlewareAgent = agent as MiddlewareCapableAgent;
      if (typeof middlewareAgent.use !== "function") {
        throw new Error(
          "Channel A2UI requires an AG-UI agent that supports middleware",
        );
      }
      middlewareAgent.use(
        new A2UIMiddleware({
          schema: options.catalog.middlewareSchema,
          defaultCatalogId: options.catalog.id,
          injectA2UITool: options.injectA2UITool ?? true,
          recovery: options.recovery,
        }),
      );
    },
    createRun({ thread }) {
      return createA2UIRunBridge({
        thread,
        catalog: options.catalog,
        minUpdateIntervalMs,
      });
    },
  };
}
