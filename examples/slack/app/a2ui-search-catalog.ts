import { Field, Fields, Header, Message, Section } from "@copilotkit/channels";
import type { Renderable } from "@copilotkit/channels";
import { createChannelA2UICatalog } from "@copilotkit/channels/a2ui";
import { z } from "zod";

export interface SearchResultCardProps {
  readonly headline: string;
  readonly summary: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly whyItMatters: string;
  readonly searchedAt: string;
}

export function renderSearchResultCard(
  props: SearchResultCardProps,
): Renderable {
  return Message({
    accent: "#2D9CDB",
    fallbackText: `${props.headline} — ${props.sourceName}`,
    children: [
      Header({ children: props.headline }),
      Section({ children: props.summary }),
      Fields({
        children: [
          Field({
            label: "Source",
            children: `[${props.sourceName}](${props.sourceUrl})`,
          }),
          Field({ label: "Searched", children: props.searchedAt }),
        ],
      }),
      Section({
        children: `**Why it matters**\n${props.whyItMatters}`,
      }),
    ],
  });
}

export function createSearchResultCatalog() {
  return createChannelA2UICatalog(
    {
      SearchResultCard: {
        description:
          "One web-search result with its grounded source and significance",
        props: z
          .object({
            headline: z.string(),
            summary: z.string(),
            sourceName: z.string(),
            sourceUrl: z.string().url(),
            whyItMatters: z.string(),
            searchedAt: z.string(),
          })
          .strict(),
      },
    },
    {
      SearchResultCard: ({ props }) => renderSearchResultCard(props),
    },
    {
      catalogId: "copilotkit://channels-slack-search-result/v1",
      includeChannelBasicCatalog: true,
    },
  );
}
