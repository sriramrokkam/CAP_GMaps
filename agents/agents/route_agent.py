from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.route_tools import (
    get_directions,
    list_all_routes,
    get_route_steps,
    get_last_known_location,
)
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the RouteAgent. You provide Google Maps route information.

Standard capabilities:
- Get driving directions between two addresses
- List stored routes from the database
- Show turn-by-turn steps for a stored route
- Get a driver's last known GPS coordinates from the database

Google Maps MCP capabilities (when available):
- Search for places near a location (fuel stations, warehouses, rest stops, etc.)
- Get real-time directions from coordinates
- Geocode addresses to coordinates and vice versa

Typical workflow for location-based queries:
1. Use get_last_known_location(assignment_id) to get the driver's current coordinates
2. Pass those coordinates to maps_search_places or maps_get_directions

You are read-only — you cannot modify any data. Show distances, durations, and directions clearly.""")


def build_route_agent(mcp_tools: list | None = None):
    tools = [
        get_directions,
        list_all_routes,
        get_route_steps,
        get_last_known_location,
    ] + (mcp_tools or [])
    return create_react_agent(get_llm(), tools=tools, prompt=SYSTEM)
