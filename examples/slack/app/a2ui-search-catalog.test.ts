import { renderToIR } from "@copilotkit/channels";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels";
import { describe, expect, it, vi } from "vitest";

import {
  createSearchResultCatalog,
  renderSearchResultCard,
} from "./a2ui-search-catalog.js";

const marketSnapshotProps = {
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
  whyItMatters: "Energy prices feed into transportation and consumer costs.",
  searchedAt: "2026-08-28T12:00:00Z",
};

describe("SearchResultCard catalog", () => {
  it("fully describes the semantic component alongside Channel-safe basics", () => {
    const catalog = createSearchResultCatalog();
    const snapshot = catalog.middlewareSchema.components.MarketSnapshot;

    expect(snapshot).toMatchObject({
      description: expect.stringContaining("Acknowledge action"),
    });
    expect(JSON.stringify(snapshot)).toContain("Current grounded price");
    expect(JSON.stringify(snapshot)).toContain("Exactly three related");
    expect(JSON.stringify(snapshot)).toContain("UTC ISO 8601");
    expect(catalog.middlewareSchema.components.Button).toBeDefined();
    expect(catalog.id).toBe("copilotkit://channels-market-snapshot/v1");
  });

  it("lowers a grounded market snapshot to a complete Channel UI card", () => {
    const ir = renderToIR(renderSearchResultCard(marketSnapshotProps));

    expect(ir.map((node) => node.type)).toEqual(["message"]);
    expect(ir[0]?.props).toMatchObject({
      fallbackText: "Live energy market snapshot",
    });
    const children = ir[0]?.props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(
      (children as Array<{ type: string }>).map((node) => node.type),
    ).toEqual([
      "header",
      "section",
      "table",
      "divider",
      "section",
      "context",
      "actions",
    ]);
    expect(JSON.stringify(ir)).toContain("Brent crude");
    expect(JSON.stringify(ir)).toContain(
      "https://www.reuters.com/markets/commodities/",
    );
    expect(JSON.stringify(ir)).toContain("Why it matters");
    expect(JSON.stringify(ir)).toContain("Acknowledge");
  });

  it("owns the acknowledge action instead of asking the model to compose it", async () => {
    const catalog = createSearchResultCatalog();
    const implementation =
      catalog.processorCatalog.components.get("MarketSnapshot");
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const rawProps = marketSnapshotProps as unknown as Record<string, unknown>;

    expect(implementation).toBeDefined();
    const ir = renderToIR(
      implementation!.lower(rawProps, {
        componentId: "snapshot",
        surfaceId: "surface",
        rawProps,
        children: () => [],
        dispatch,
      }),
    );
    const messageChildren = ir[0]?.props.children as ChannelNode[];
    const actions = messageChildren.find((node) => node.type === "actions");
    const button = (actions?.props.children as ChannelNode[] | undefined)?.find(
      (node) => node.type === "button",
    );
    const interaction = {} as InteractionContext;

    expect(button).toBeDefined();
    await (
      button!.props.onClick as (
        context: InteractionContext,
      ) => void | Promise<void>
    )(interaction);
    expect(dispatch).toHaveBeenCalledWith(
      { event: { name: "acknowledge_search_result" } },
      interaction,
    );
  });
});
