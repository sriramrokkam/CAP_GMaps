# RouteAgent Google Maps MCP Integration — Design Spec

**Date:** 2026-04-27
**Scope:** Add Google Maps MCP server tools to RouteAgent only. No changes to CAP backend, OData API, or other agents.

---

## Goal

When a user invokes the RouteAgent, it can:
1. Read the driver's last known GPS coordinates from the CAP database (new tool)
2. Use those coordinates to find nearby places (fuel stations, warehouses, rest stops) via Google Maps MCP
3. Get directions from the driver's current location to any destination via Google Maps MCP

The existing 3 route tools (`get_directions`, `list_all_routes`, `get_route_steps`) are unchanged.

---

## Architecture

```
RouteAgent (route_agent.py)
  Existing tools (unchanged):
    - get_directions(origin, destination)       ← direct httpx to Google Maps REST
    - list_all_routes()                         ← CAP OData
    - get_route_steps(route_id)                 ← CAP OData

  New tools:
    - get_last_known_location(assignment_id)    ← CAP OData /tracking/latestGps
    - maps_directions(...)                      ← Google Maps MCP server
    - maps_find_place(...)                      ← Google Maps MCP server
    - maps_nearby_search(...)                   ← Google Maps MCP server
    - maps_geocode(...)                         ← Google Maps MCP server
```

---

## Components

### 1. `agents/mcp_client.py` (new file)

Manages the Google Maps MCP server subprocess and exposes loaded tools.

- Uses `langchain-mcp-adapters` `MultiServerMCPClient` to spawn `npx @googlemaps/mcp-server` as a subprocess
- Because `MultiServerMCPClient` is async, tools are loaded once at app startup inside `lifespan` and stored in a module-level variable `_mcp_tools: list`
- Exposes `get_mcp_tools() -> list` for route_agent.py to consume
- Passes `GOOGLE_MAPS_API_KEY` as env var to the subprocess

```python
# Public interface
async def load_mcp_tools() -> list   # called once in lifespan
def get_mcp_tools() -> list          # called by build_route_agent()
```

### 2. `agents/tools/route_tools.py` (one addition)

Add `get_last_known_location(assignment_id: str) -> str` as a `@tool`:
- Calls existing OData endpoint: `GET /odata/v4/tracking/latestGps(assignmentId={id})`
- Returns formatted string: `"Lat: 12.971, Lng: 77.594, Speed: 8.3 m/s, Updated: 2026-04-27T10:30:00Z"`
- Same pattern as `get_live_location` in driver_tools.py (reuses `_client`)
- Error handling: returns string error message, never raises

### 3. `agents/agents/route_agent.py` (modified)

`build_route_agent()` becomes a regular function that accepts optional pre-loaded MCP tools:

```python
def build_route_agent(mcp_tools: list | None = None):
    tools = [get_directions, list_all_routes, get_route_steps,
             get_last_known_location] + (mcp_tools or [])
    return create_react_agent(get_llm(), tools=tools, prompt=SYSTEM)
```

Updated SYSTEM prompt mentions the new capabilities.

### 4. `agents/main.py` (lifespan addition)

In `lifespan`, after scheduler setup:
```python
from mcp_client import load_mcp_tools
from agents.route_agent import build_route_agent

mcp_tools = await load_mcp_tools()   # async — OK inside asynccontextmanager
_route_agent = build_route_agent(mcp_tools)
```

The supervisor's `run_route` function uses `_route_agent` instead of building it inline.

### 5. `agents/supervisor.py` (minor wiring)

`run_route` currently calls `build_route_agent()` inline on every request. Change to accept a pre-built agent instance stored at module level, set during app startup.

### 6. `agents/package.json` (new file)

```json
{
  "dependencies": {
    "@googlemaps/mcp-server": "latest"
  }
}
```

CF Python buildpack detects `package.json` and runs `npm install` automatically, making `npx @googlemaps/mcp-server` available at runtime.

### 7. `agents/requirements.txt` (one addition)

```
langchain-mcp-adapters>=0.1
```

### 8. `agents/cf_set_env.sh` (no change needed)

`GOOGLE_MAPS_API_KEY` is already set by this script.

---

## Data Flow — "Find fuel stations near the driver"

```
User: "Find fuel stations near driver assignment abc-123"
  │
  ▼
RouteAgent
  1. get_last_known_location("abc-123")
     → GET /odata/v4/tracking/latestGps(assignmentId=abc-123)
     ← "Lat: 12.971, Lng: 77.594, ..."

  2. maps_nearby_search(location="12.971,77.594", keyword="fuel station", radius=2000)
     → MCP server → Google Maps Places API
     ← list of 5 nearby fuel stations with names, addresses, distances

  3. Agent composes response with station names + distances
```

---

## MCP Fallback Behaviour

If `load_mcp_tools()` fails (Node.js not available, API key missing, network error):
- Log the error
- Return empty list `[]`
- RouteAgent starts with only its 4 standard tools
- App startup does NOT fail — MCP tools are additive

---

## CF Deployment Notes

- CF Python buildpack v1.8+ auto-detects `package.json` and runs `npm install`
- `node_modules/` is excluded via `.cfignore` (already has `node_modules/` pattern — add it)
- `npx` runs the MCP server as a subprocess at request time (spawned once in lifespan)
- No new CF app, no new BTP service

---

## Testing

- `tests/test_mcp_client.py`: mock subprocess, verify `get_mcp_tools()` returns list of tools; verify graceful fallback on failure
- `tests/test_route_tools.py`: add test for `get_last_known_location` with mocked OData response
- `tests/test_graph_structure.py`: verify route_agent graph still has `tools` node with extended tool list

---

## Files Changed Summary

| File | Change |
|---|---|
| `mcp_client.py` | New — MCP subprocess manager |
| `tools/route_tools.py` | +1 tool: `get_last_known_location` |
| `agents/route_agent.py` | Accept pre-loaded MCP tools, update SYSTEM prompt |
| `agents/supervisor.py` | Use pre-built route agent instance |
| `main.py` | Load MCP tools in lifespan, pass to route agent |
| `package.json` | New — `@googlemaps/mcp-server` dependency |
| `requirements.txt` | +1 line: `langchain-mcp-adapters>=0.1` |
| `.cfignore` | Add `node_modules/` |
| `cf_set_env.sh` | No change |
| CAP backend | No change |
| Other agents | No change |
