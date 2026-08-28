import { renderToIR } from "@copilotkit/channels";
import { describe, expect, it } from "vitest";

import {
  createSearchResultCatalog,
  renderSearchResultCard,
} from "./a2ui-search-catalog.js";

describe("SearchResultCard catalog", () => {
  it("advertises the custom component alongside the Channel-safe basics", () => {
    const catalog = createSearchResultCatalog();

    expect(catalog.middlewareSchema.components.MarketSnapshot).toBeDefined();
    expect(catalog.middlewareSchema.components.Button).toBeDefined();
    expect(catalog.id).toBe("copilotkit://channels-market-snapshot/v1");
  });

  it("lowers a grounded market snapshot to a Channel UI table", () => {
    const ir = renderToIR(
      renderSearchResultCard({
        headline: "Live energy market snapshot",
        summary: "Oil benchmarks moved lower in the latest session.",
        markets: [
          {
            name: "Brent crude",
            price: "$79.42/bbl",
            change: "-0.8%",
            sourceName: "Reuters",
            sourceUrl: "https://www.reuters.com/markets/commodities/",
          },
          {
            name: "WTI crude",
            price: "$75.18/bbl",
            change: "-0.6%",
            sourceName: "CME Group",
            sourceUrl: "https://www.cmegroup.com/markets/energy/crude-oil.html",
          },
          {
            name: "RBOB gasoline",
            price: "$2.31/gal",
            change: "+0.2%",
            sourceName: "CME Group",
            sourceUrl:
              "https://www.cmegroup.com/markets/energy/refined-products/rbob-gasoline.html",
          },
        ],
        whyItMatters:
          "Energy prices feed into transportation and consumer costs.",
        searchedAt: "2026-08-28T12:00:00Z",
      }),
    );

    expect(ir.map((node) => node.type)).toEqual(["message"]);
    expect(ir[0]?.props).toMatchObject({
      fallbackText: "Live energy market snapshot",
    });
    const children = ir[0]?.props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(
      (children as Array<{ type: string }>).map((node) => node.type),
    ).toEqual(["header", "section", "table", "divider", "section", "context"]);
    expect(JSON.stringify(ir)).toContain("Brent crude");
    expect(JSON.stringify(ir)).toContain(
      "https://www.reuters.com/markets/commodities/",
    );
    expect(JSON.stringify(ir)).toContain("Why it matters");
  });
});
