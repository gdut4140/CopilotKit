import { describe, expect, it } from "vitest";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import {
  BASIC_FUNCTIONS,
  ColumnApi,
  TextApi,
} from "@a2ui/web_core/v0_9/basic_catalog";

describe("A2UI MessageProcessor Node compatibility", () => {
  it("creates and reads a v0.9 surface without browser globals", () => {
    const catalog = new Catalog<ComponentApi>(
      "copilotkit://channels-node-probe/v1",
      [ColumnApi, TextApi],
      BASIC_FUNCTIONS,
    );
    const processor = new MessageProcessor([catalog]);

    processor.processMessages([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "deployment",
          catalogId: catalog.id,
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "deployment",
          components: [
            { id: "root", component: "Column", children: ["title"] },
            { id: "title", component: "Text", text: "Ready" },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface("deployment");
    expect("document" in globalThis).toBe(false);
    expect(surface?.componentsModel.get("root")?.type).toBe("Column");
    expect(surface?.componentsModel.get("title")?.properties).toMatchObject({
      text: "Ready",
    });
  });
});
