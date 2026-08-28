"""Shared State feature."""

from __future__ import annotations

import json
from typing import Dict, Optional

from ag_ui_adk import (
    ADKAgent,
    AGUIToolset,
    CONTEXT_STATE_KEY,
    add_adk_fastapi_endpoint,
)
from dotenv import load_dotenv
from fastapi import FastAPI
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext, google_search
from google.adk.tools.agent_tool import AgentTool
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

SEARCH_RESULT_CONTEXT_DESCRIPTION = "Grounded live market snapshot"


class ProverbsState(BaseModel):
    """List of the proverbs being written."""

    proverbs: list[str] = Field(
        default_factory=list,
        description="The list of already written proverbs",
    )


def set_proverbs(tool_context: ToolContext, new_proverbs: list[str]) -> Dict[str, str]:
    """
    Set the list of provers using the provided new list.

    Args:
        "new_proverbs": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The new list of proverbs to maintain",
        }

    Returns:
        Dict indicating success status and message
    """
    try:
        # Put this into a state object just to confirm the shape
        new_state = {"proverbs": new_proverbs}
        tool_context.state["proverbs"] = new_state["proverbs"]
        return {"status": "success", "message": "Proverbs updated successfully"}

    except Exception as e:
        return {"status": "error", "message": f"Error updating proverbs: {str(e)}"}


def get_weather(tool_context: ToolContext, location: str) -> Dict[str, str]:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return {"status": "success", "message": f"The weather in {location} is sunny."}


def stage_search_result(
    tool_context: ToolContext,
    headline: str,
    summary: str,
    markets: list[dict[str, str]],
    why_it_matters: str,
    searched_at: str,
) -> Dict[str, str]:
    """Stage three grounded market rows for interactive rendering."""
    entries = [
        entry
        for entry in list(tool_context.state.get(CONTEXT_STATE_KEY, []))
        if not (
            isinstance(entry, dict)
            and entry.get("description") == SEARCH_RESULT_CONTEXT_DESCRIPTION
        )
    ]
    entries.append(
        {
            "description": SEARCH_RESULT_CONTEXT_DESCRIPTION,
            "value": json.dumps(
                {
                    "headline": headline,
                    "summary": summary,
                    "markets": markets,
                    "whyItMatters": why_it_matters,
                    "searchedAt": searched_at,
                }
            ),
        }
    )
    tool_context.state[CONTEXT_STATE_KEY] = entries
    return {"status": "success", "message": "Search result staged for A2UI"}


def on_before_agent(callback_context: CallbackContext):
    """
    Initialize proverbs state if it doesn't exist.
    """

    if "proverbs" not in callback_context.state:
        # Initialize with default recipe
        default_proverbs = []
        callback_context.state["proverbs"] = default_proverbs

    return None


# --- Define the Callback Function ---
#  modifying the agent's system prompt to incude the current state of the proverbs list
def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inspects/modifies the LLM request or skips the call."""
    agent_name = callback_context.agent_name
    if agent_name == "ProverbsAgent":
        proverbs_json = "No proverbs yet"
        if (
            "proverbs" in callback_context.state
            and callback_context.state["proverbs"] is not None
        ):
            try:
                proverbs_json = json.dumps(callback_context.state["proverbs"], indent=2)
            except Exception as e:
                proverbs_json = f"Error serializing proverbs: {str(e)}"
        # --- Modification Example ---
        # Add a prefix to the system instruction
        original_instruction = llm_request.config.system_instruction or types.Content(
            role="system", parts=[]
        )
        prefix = f"""You are a helpful assistant for maintaining a list of proverbs.
        This is the current state of the list of proverbs: {proverbs_json}
        When you modify the list of proverbs (wether to add, remove, or modify one or more proverbs), use the set_proverbs tool to update the list."""
        # Ensure system_instruction is Content and parts list exists
        if not isinstance(original_instruction, types.Content):
            # Handle case where it might be a string (though config expects Content)
            original_instruction = types.Content(
                role="system", parts=[types.Part(text=str(original_instruction))]
            )
        if not original_instruction.parts:
            original_instruction.parts = [types.Part(text="")]

        # Modify the text of the first part
        if original_instruction.parts and len(original_instruction.parts) > 0:
            modified_text = prefix + (original_instruction.parts[0].text or "")
            original_instruction.parts[0].text = modified_text
        llm_request.config.system_instruction = original_instruction

    return None


# --- Define the Callback Function ---
def simple_after_model_modifier(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Stop the consecutive tool calling of the agent"""
    agent_name = callback_context.agent_name
    # --- Inspection ---
    if agent_name == "ProverbsAgent":
        if llm_response.content and llm_response.content.parts:
            # Assuming simple text response for this example
            if (
                llm_response.content.role == "model"
                and llm_response.content.parts[0].text
            ):
                callback_context._invocation_context.end_invocation = True

        elif llm_response.error_message:
            return None
        else:
            return None  # Nothing to modify
    return None


search_agent = LlmAgent(
    name="SearchAgent",
    model="gemini-3.7-flash",
    description="Searches the live web for a grounded three-market snapshot.",
    instruction="""
        Use Google Search for the user's current market-data request. Return a
        concise headline and summary plus exactly three closely related market
        rows. Each row must have a display name, current price including units,
        latest percentage or absolute change, source publisher, and canonical
        absolute source URL. Also return why the combined movement matters and
        the current UTC search time in ISO 8601 format. Never invent a price,
        change, source, URL, or timestamp.
    """,
    tools=[google_search],
)


proverbs_agent = LlmAgent(
    name="ProverbsAgent",
    model="gemini-3.7-flash",
    instruction="""
        When a user asks you to do anything regarding proverbs, you MUST use the set_proverbs tool.

        IMPORTANT RULES ABOUT PROVERBS AND THE SET_PROVERBS TOOL:
        1. Always use the set_proverbs tool for any proverbs-related requests
        2. Always pass the COMPLETE LIST of proverbs to the set_proverbs tool. If the list had 5 proverbs and you removed one, you must pass the complete list of 4 remaining proverbs.
        3. You can use existing proverbs if one is relevant to the user's request, but you can also create new proverbs as required.
        4. Be creative and helpful in generating complete, practical proverbs
        5. After using the tool, provide a brief summary of what you create, removed, or changed        7.

        Examples of when to use the set_proverbs tool:
        - "Add a proverb about soap" → Use tool with an array containing the existing list of proverbs with the new proverb about soap at the end.
        - "Remove the first proverb" → Use tool with an array containing the all of the existing proverbs except the first one"
        - "Change any proverbs about cats to mention that they have 18 lives" → If no proverbs mention cats, do not use the tool. If one or more proverbs do mention cats, change them to mention cats having 18 lives, and use the tool with an array of all of the proverbs, including ones that were changed and ones that did not require changes.

        Do your best to ensure proverbs plausibly make sense.


        IMPORTANT RULES ABOUT WEATHER AND THE GET_WEATHER TOOL:
        1. Only call the get_weather tool if the user asks you for the weather in a given location.
        2. If the user does not specify a location, you can use the location "Everywhere ever in the whole wide world"

        Examples of when to use the get_weather tool:
        - "What's the weather today in Tokyo?" → Use the tool with the location "Tokyo"
        - "Whats the weather right now" → Use the location "Everywhere ever in the whole wide world"
        - Is it raining in London? → Use the tool with the location "London"


        IMPORTANT RULES ABOUT LIVE MARKET RESEARCH AND A2UI:
        1. For a current market-data request, delegate to SearchAgent.
        2. Copy SearchAgent's snapshot fields and all three market rows exactly
           into stage_search_result.
        3. Only after staging succeeds, present the result with the available
           interactive UI tool exactly once.
        4. Do not substitute a prose-only answer for the structured snapshot.
           After rendering, any prose must be a single short sentence.
        5. When the user action "acknowledge_search_result" is received, briefly
           confirm it without searching again or rendering another card.
        """,
    tools=[
        set_proverbs,
        get_weather,
        AgentTool(agent=search_agent),
        stage_search_result,
        AGUIToolset(),
    ],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)

# Create ADK middleware agent instance
adk_proverbs_agent = ADKAgent(
    adk_agent=proverbs_agent,
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

# Create FastAPI app
app = FastAPI(title="ADK Middleware Proverbs Agent")

# Add the ADK endpoint
add_adk_fastapi_endpoint(app, adk_proverbs_agent, path="/")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import os

    import uvicorn

    if not os.getenv("GOOGLE_API_KEY"):
        print("⚠️  Warning: GOOGLE_API_KEY environment variable not set!")
        print("   Set it with: export GOOGLE_API_KEY='your-key-here'")
        print("   Get a key from: https://makersuite.google.com/app/apikey")
        print()

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
