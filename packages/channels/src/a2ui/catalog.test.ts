import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Section } from "@copilotkit/channels-core";
import { createChannelA2UICatalog } from "./catalog.js";

describe("createChannelA2UICatalog", () => {
  it("keeps executable lowerers local and emits one inline middleware schema", () => {
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
          Section({ children: `${props.service}: ${props.status}` }),
      },
      {
        catalogId: "copilotkit://channels-mvp/v1",
      },
    );

    expect(catalog.id).toBe("copilotkit://channels-mvp/v1");
    expect(catalog.processorCatalog.components.has("ServiceStatus")).toBe(true);
    expect(catalog.processorCatalog.components.has("Text")).toBe(false);
    expect(catalog.middlewareSchema.catalogId).toBe(catalog.id);
    expect(catalog.middlewareSchema.components.ServiceStatus).toMatchObject({
      description: "Deployment status for one named service",
    });
    expect(JSON.stringify(catalog.middlewareSchema)).not.toContain("lower");
  });
});
