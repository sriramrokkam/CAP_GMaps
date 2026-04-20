from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.route_tools import get_directions, list_all_routes, get_route_steps
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the RouteAgent. You provide Google Maps route information.
You can get driving directions between two addresses, list stored routes, and show turn-by-turn steps.
You are read-only — you cannot modify any data. Show distances, durations, and directions clearly.""")


def build_route_agent():
    return create_react_agent(
        get_llm(),
        tools=[get_directions, list_all_routes, get_route_steps],
        prompt=SYSTEM,
    )
