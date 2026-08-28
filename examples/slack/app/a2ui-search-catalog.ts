import {
  Cell,
  Context,
  Divider,
  Header,
  Message,
  Row,
  Section,
  Table,
} from "@copilotkit/channels";
import type { Renderable } from "@copilotkit/channels";
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
    ],
  });
}

export function createSearchResultCatalog() {
  const market = z
    .object({
      name: z.string(),
      price: z.string(),
      change: z.string(),
      sourceName: z.string(),
      sourceUrl: z.string().url(),
    })
    .strict();

  return createChannelA2UICatalog(
    {
      MarketSnapshot: {
        description:
          "Three live market values with grounded sources and significance",
        props: z
          .object({
            headline: z.string(),
            summary: z.string(),
            markets: z.array(market).length(3),
            whyItMatters: z.string(),
            searchedAt: z.string(),
          })
          .strict(),
      },
    },
    {
      MarketSnapshot: ({ props }) => renderSearchResultCard(props),
    },
    {
      catalogId: "copilotkit://channels-market-snapshot/v1",
      includeChannelBasicCatalog: true,
    },
  );
}
