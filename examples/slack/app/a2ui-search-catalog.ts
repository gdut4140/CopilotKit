import {
  Actions,
  Button,
  Cell,
  Context,
  Divider,
  Header,
  Message,
  Row,
  Section,
  Table,
} from "@copilotkit/channels";
import type { ClickHandler, Renderable } from "@copilotkit/channels";
import { createChannelA2UICatalog } from "@copilotkit/channels/a2ui";
import { z } from "zod";

export interface SearchResultMarket {
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface SearchResultCardProps {
  readonly headline: string;
  readonly summary: string;
  readonly markets: readonly SearchResultMarket[];
  readonly whyItMatters: string;
  readonly searchedAt: string;
}

export function renderSearchResultCard(
  props: SearchResultCardProps,
  onAcknowledge?: ClickHandler,
): Renderable {
  return Message({
    fallbackText: props.headline,
    children: [
      Header({ children: props.headline }),
      Section({ children: props.summary }),
      Table({
        columns: [
          { header: "Market" },
          { header: "Price", align: "right" },
          { header: "Move", align: "right" },
          { header: "Source" },
        ],
        children: props.markets.map((market) =>
          Row({
            children: [
              Cell({ children: market.name }),
              Cell({ children: market.price }),
              Cell({ children: market.change }),
              Cell({
                children: `[${market.sourceName}](${market.sourceUrl})`,
              }),
            ],
          }),
        ),
      }),
      Divider({}),
      Section({
        children: `**Why it matters**\n${props.whyItMatters}`,
      }),
      Context({ children: `Searched ${props.searchedAt}` }),
      Actions({
        children: Button({
          children: "Acknowledge",
          style: "primary",
          onClick: onAcknowledge,
        }),
      }),
    ],
  });
}

export function createSearchResultCatalog() {
  const market = z
    .object({
      name: z
        .string()
        .describe("Short market or contract label shown in the Market column."),
      price: z
        .string()
        .describe(
          "Current grounded price including currency and unit, for example $79.42/bbl.",
        ),
      change: z
        .string()
        .describe(
          "Latest grounded move including sign and percent or absolute unit.",
        ),
      sourceName: z
        .string()
        .describe("Publisher or exchange that supplied this row's price."),
      sourceUrl: z
        .string()
        .url()
        .describe("Canonical absolute URL for this row's source."),
    })
    .strict();

  return createChannelA2UICatalog(
    {
      MarketSnapshot: {
        description:
          "Complete root-capable live market snapshot for exactly three related instruments. Renders a headline, concise summary, sourced market table, why-it-matters analysis, search timestamp, and a built-in Acknowledge action. Supply only grounded values copied from research context.",
        props: z
          .object({
            headline: z
              .string()
              .describe(
                "Short headline describing the combined live market snapshot.",
              ),
            summary: z
              .string()
              .describe(
                "One concise sentence summarizing the three markets' movement.",
              ),
            markets: z
              .array(market)
              .length(3)
              .describe(
                "Exactly three related, grounded market rows; keep each row's source attached to its price.",
              ),
            whyItMatters: z
              .string()
              .describe(
                "Concise explanation of why the combined market movement matters.",
              ),
            searchedAt: z
              .string()
              .describe(
                "UTC ISO 8601 time when the live search was performed.",
              ),
          })
          .strict(),
      },
    },
    {
      MarketSnapshot: ({ props, dispatch }) =>
        renderSearchResultCard(props, (interaction) =>
          dispatch(
            { event: { name: "acknowledge_search_result" } },
            interaction,
          ),
        ),
    },
    {
      catalogId: "copilotkit://channels-market-snapshot/v1",
      includeChannelBasicCatalog: true,
    },
  );
}
