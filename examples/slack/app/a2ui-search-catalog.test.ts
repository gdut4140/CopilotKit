import { renderToIR } from "@copilotkit/channels";
import { describe, expect, it } from "vitest";

import {
  createSearchResultCatalog,
  renderSearchResultCard,
} from "./a2ui-search-catalog.js";

describe("SearchResultCard catalog", () => {
  it("advertises the custom component alongside the Channel-safe basics", () => {
    const catalog = createSearchResultCatalog();

    expect(catalog.middlewareSchema.components.SearchResultCard).toBeDefined();
    expect(catalog.middlewareSchema.components.Button).toBeDefined();
    expect(catalog.id).toBe("copilotkit://channels-slack-search-result/v1");
  });

  it("lowers one sourced result to native Channel IR blocks", () => {
    const ir = renderToIR(
      renderSearchResultCard({
        headline: "Artemis II completes a launch milestone",
        summary: "NASA reported a new readiness milestone for Artemis II.",
        sourceName: "NASA",
        sourceUrl: "https://www.nasa.gov/example",
        whyItMatters: "The milestone reduces schedule risk for the mission.",
        searchedAt: "2026-08-28T12:00:00Z",
      }),
    );

    expect(ir.map((node) => node.type)).toEqual([
      "header",
      "section",
      "fields",
      "section",
    ]);
    expect(JSON.stringify(ir)).toContain("https://www.nasa.gov/example");
    expect(JSON.stringify(ir)).toContain("Why it matters");
  });
});
