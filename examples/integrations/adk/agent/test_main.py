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

        result = stage_search_result(
            tool_context,
            headline="Artemis II update",
            summary="NASA published an update.",
            source_name="NASA",
            source_url="https://www.nasa.gov/example",
            why_it_matters="It advances the mission.",
            searched_at="2026-08-28T12:00:00Z",
        )

        self.assertEqual(result["status"], "success")
        entries = tool_context.state[CONTEXT_STATE_KEY]
        self.assertEqual(entries[0]["value"], "preserved")
        staged = json.loads(entries[-1]["value"])
        self.assertEqual(staged["sourceUrl"], "https://www.nasa.gov/example")
        self.assertEqual(staged["headline"], "Artemis II update")
        self.assertIn('"component": "Button"', SEARCH_CARD_COMPOSITION_GUIDE)
        self.assertIn("acknowledge_search_result", SEARCH_CARD_COMPOSITION_GUIDE)


if __name__ == "__main__":
    unittest.main()
