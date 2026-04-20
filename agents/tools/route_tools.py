from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings

_client = ODataClient(settings)


@tool
def get_route_for_delivery(delivery_doc: str) -> str:
    """Fetch Google Maps route directions for a delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
    data = _client.post("/odata/v4/ewm/getDeliveryRoute", {"deliveryDoc": delivery_doc})
    if not data:
        return f"No route found for {delivery_doc}."
    return (f"Route for {delivery_doc}: {data.get('origin','?')} → {data.get('destination','?')} | "
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
