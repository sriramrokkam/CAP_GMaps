from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings

_client = ODataClient(settings)


@tool
def get_directions(origin: str, destination: str) -> str:
    """Get Google Maps driving directions between two addresses. Returns distance, duration, and route summary."""
    try:
        data = _client.post("/odata/v4/gmaps/getDirections", {"from": origin, "to": destination})
    except Exception as e:
        return f"Could not get directions: {e}. Try list_all_routes() to see previously stored routes."
    if not data:
        return f"No route found from {origin} to {destination}."
    return (f"Route: {data.get('origin', origin)} → {data.get('destination', destination)} | "
            f"Distance: {data.get('distance','?')} | Duration: {data.get('duration','?')}")


@tool
def list_all_routes() -> str:
    """List all stored route directions."""
    data = _client.get("/odata/v4/gmaps/RouteDirections", {"$orderby": "createdAt desc", "$top": "10"})
    routes = data.get("value", [])
    if not routes:
        return "No routes stored."
    lines = [f"- {r.get('origin','?')} → {r.get('destination','?')} | {r.get('distance','?')} | {r.get('duration','?')}" for r in routes]
    return f"{len(routes)} routes:\n" + "\n".join(lines)


@tool
def get_route_steps(route_id: str) -> str:
    """Get turn-by-turn directions for a route. Pass a route UUID from list_all_routes()."""
    data = _client.get(f"/odata/v4/gmaps/RouteDirections({route_id})/steps", {"$orderby": "stepNumber asc"})
    steps = data.get("value", [])
    if not steps:
        return "No steps found."
    lines = [f"{s.get('stepNumber','?')}. {s.get('instruction','?')} ({s.get('distance','?')})" for s in steps]
    return "\n".join(lines)
