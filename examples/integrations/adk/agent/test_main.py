import json
import unittest
from types import SimpleNamespace

from ag_ui_adk import AGUIToolset, CONTEXT_STATE_KEY
from google.adk.tools.agent_tool import AgentTool

from main import (
    SEARCH_CARD_COMPOSITION_GUIDE,
    proverbs_agent,
    search_agent,
    stage_search_result,
)


class AgentTopologyTest(unittest.TestCase):
    def test_main_agent_delegates_search_and_accepts_client_tools(self):
        delegated = [
            tool for tool in proverbs_agent.tools if isinstance(tool, AgentTool)
        ]

        self.assertEqual(len(delegated), 1)
        self.assertIs(delegated[0].agent, search_agent)
        self.assertTrue(
            any(isinstance(tool, AGUIToolset) for tool in proverbs_agent.tools)
        )
        self.assertIn(stage_search_result, proverbs_agent.tools)

    def test_search_agent_owns_google_search(self):
        self.assertEqual(search_agent.name, "SearchAgent")
        self.assertEqual(len(search_agent.tools), 1)

    def test_search_result_is_staged_for_the_a2ui_subagent(self):
        tool_context = SimpleNamespace(
            state={
                CONTEXT_STATE_KEY: [
                    {"description": "existing context", "value": "preserved"}
                ]
            }
        )

        try:
            result = stage_search_result(
                tool_context,
                headline="Live energy market snapshot",
                summary="Oil benchmarks moved lower.",
                markets=[
                    {
                        "name": "Brent crude",
                        "price": "$79.42/bbl",
                        "change": "-0.8%",
                        "sourceName": "Reuters",
                        "sourceUrl": "https://www.reuters.com/markets/commodities/",
                    },
                    {
                        "name": "WTI crude",
                        "price": "$75.18/bbl",
                        "change": "-0.6%",
                        "sourceName": "CME Group",
                        "sourceUrl": "https://www.cmegroup.com/markets/energy/crude-oil.html",
                    },
                    {
                        "name": "RBOB gasoline",
                        "price": "$2.31/gal",
                        "change": "+0.2%",
                        "sourceName": "CME Group",
                        "sourceUrl": "https://www.cmegroup.com/markets/energy/refined-products/rbob-gasoline.html",
                    },
                ],
                why_it_matters="Energy prices affect transportation costs.",
                searched_at="2026-08-28T12:00:00Z",
            )
        except TypeError as error:
            self.fail(f"stage_search_result lacks the market snapshot API: {error}")

        self.assertEqual(result["status"], "success")
        entries = tool_context.state[CONTEXT_STATE_KEY]
        self.assertEqual(entries[0]["value"], "preserved")
        staged = json.loads(entries[-1]["value"])
        self.assertEqual(staged["headline"], "Live energy market snapshot")
        self.assertEqual(len(staged["markets"]), 3)
        self.assertEqual(staged["markets"][0]["name"], "Brent crude")
        self.assertEqual(
            staged["markets"][0]["sourceUrl"],
            "https://www.reuters.com/markets/commodities/",
        )
        self.assertIn('"component": "MarketSnapshot"', SEARCH_CARD_COMPOSITION_GUIDE)
        self.assertIn('"component": "Button"', SEARCH_CARD_COMPOSITION_GUIDE)
        self.assertIn("acknowledge_search_result", SEARCH_CARD_COMPOSITION_GUIDE)


if __name__ == "__main__":
    unittest.main()
