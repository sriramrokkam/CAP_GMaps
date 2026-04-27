import os
import httpx
from dotenv import load_dotenv
from langchain_core.tools import tool
from tools.odata_client import ODataClient, build_filter
from config import settings

load_dotenv()

_client = ODataClient(settings)


@tool
def get_directions(origin: str, destination: str) -> str:
    """Get Google Maps driving directions between two addresses. Returns distance, duration, and route summary."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        return "GOOGLE_MAPS_API_KEY not set. Try list_routes() to see stored routes."
    try:
        resp = httpx.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            params={"origin": origin, "destination": destination, "key": api_key},
            timeout=15,
        )
        data = resp.json()
        if data.get("status") != "OK":
            return f"Google Maps error: {data.get('status')} — {data.get('error_message', 'unknown')}"
        leg = data["routes"][0]["legs"][0]
        return (f"Route: {leg['start_address']} → {leg['end_address']} | "
                f"Distance: {leg['distance']['text']} | Duration: {leg['duration']['text']}")
    except Exception as e:
        return f"Could not get directions: {e}. Try list_routes() to see stored routes."


@tool
def list_routes(origin: str = "", destination: str = "", top: int = 10) -> str:
    """List stored route directions from the CAP database with optional filters.
    - origin: partial match on origin address (e.g. 'New York')
    - destination: partial match on destination address (e.g. 'Atlanta')
    - top: max results (default 10)"""
    try:
        f = build_filter(contains={"origin": origin or None, "destination": destination or None})
        params = {"$orderby": "createdAt desc", "$top": str(top)}
        if f:
            params["$filter"] = f
        data = _client.get("/odata/v4/gmaps/RouteDirections", params)
        routes = data.get("value", [])
        if not routes:
            return "No routes match the given filters."
        lines = [f"- ID: {r.get('ID', '?')} | {r.get('origin', '?')} → {r.get('destination', '?')} | {r.get('distance', '?')} | {r.get('duration', '?')}" for r in routes]
        return f"{len(routes)} routes:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not list routes: {e}"


@tool
def get_route_steps(route_id: str) -> str:
    """Get turn-by-turn directions for a route. Pass a route UUID from list_routes()."""
    try:
        data = _client.get(f"/odata/v4/gmaps/RouteDirections({route_id})/steps", {"$orderby": "stepNumber asc"})
    except Exception as e:
        return f"Could not get steps: {e}"
    steps = data.get("value", [])
    if not steps:
        return "No steps found."
    lines = [f"{s.get('stepNumber','?')}. {s.get('instruction','?')} ({s.get('distance','?')})" for s in steps]
    return "\n".join(lines)


@tool
def get_last_known_location(assignment_id: str) -> str:
    """Get the last known GPS coordinates for a driver assignment.
    Use list_assignments() from the driver agent to find an assignment UUID.
    Returns lat/lng suitable for passing to maps_search_places or maps_get_directions."""
    try:
        data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get location: {e}"
    lat = data.get("Latitude", "?")
    lng = data.get("Longitude", "?")
    speed = data.get("Speed", "?")
    updated = data.get("LastGpsAt", "?")
    return f"Lat: {lat}, Lng: {lng} | Speed: {speed} m/s | Updated: {updated} | Coords for maps: {lat},{lng}"
