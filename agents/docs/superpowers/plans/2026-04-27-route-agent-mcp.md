# RouteAgent Google Maps MCP Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Maps MCP server tools to RouteAgent so it can find nearby places and get directions from a driver's last known GPS coordinates, with zero changes to the CAP backend.

**Architecture:** A new `mcp_client.py` module spawns `@modelcontextprotocol/server-google-maps` as a stdio subprocess at FastAPI startup using `langchain-mcp-adapters`. The loaded MCP tools are injected into RouteAgent alongside existing tools. A new `get_last_known_location` tool reads driver GPS from the existing CAP OData endpoint and returns lat/lng ready for MCP tool calls.

**Tech Stack:** Python 3.13, `langchain-mcp-adapters==0.1.9` (already installed), `@modelcontextprotocol/server-google-maps@0.6.2` (Node.js, via npx), LangGraph `create_react_agent`, FastAPI async lifespan.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `agents/mcp_client.py` | Create | Spawn MCP subprocess, load tools, expose `load_mcp_tools()` + `get_mcp_tools()` |
| `agents/tools/route_tools.py` | Modify | Add `get_last_known_location` tool |
| `agents/agents/route_agent.py` | Modify | Accept pre-loaded MCP tools, update SYSTEM prompt |
| `agents/agents/supervisor.py` | Modify | Accept pre-built route agent instance via `set_route_agent()` |
| `agents/main.py` | Modify | Load MCP tools in lifespan, wire into supervisor |
| `agents/package.json` | Create | `@modelcontextprotocol/server-google-maps` dependency |
| `agents/requirements.txt` | Modify | Pin `langchain-mcp-adapters>=0.1,<1` |
| `agents/.cfignore` | Modify | Add `node_modules/` exclusion |
| `agents/tests/test_mcp_client.py` | Create | Tests for mcp_client.py |
| `agents/tests/test_route_tools.py` | Create | Test for `get_last_known_location` |
| `agents/tests/test_graph_structure.py` | Modify | Verify route agent has MCP tools when provided |

---

## Task 1: Add `get_last_known_location` tool to route_tools.py

**Files:**
- Modify: `agents/tools/route_tools.py`
- Create: `agents/tests/test_route_tools.py`

- [ ] **Step 1: Write the failing test**

Create `agents/tests/test_route_tools.py`:

```python
import pytest
import respx
import httpx
from unittest.mock import patch, MagicMock


def _mock_token():
    mock = MagicMock()
    mock._get_token.return_value = "fake-token"
    return mock


def test_get_last_known_location_returns_formatted_string():
    from tools.route_tools import get_last_known_location

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.return_value = {
            "Latitude": 12.971,
            "Longitude": 77.594,
            "Speed": 8.3,
            "LastGpsAt": "2026-04-27T10:30:00Z",
        }
        result = get_last_known_location.invoke({"assignment_id": "abc-123"})

    assert "12.971" in result
    assert "77.594" in result
    assert "abc-123" not in result  # not echoed back


def test_get_last_known_location_handles_odata_error():
    from tools.route_tools import get_last_known_location

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.side_effect = Exception("Connection refused")
        result = get_last_known_location.invoke({"assignment_id": "bad-id"})

    assert "Could not" in result or "error" in result.lower()


def test_get_last_known_location_is_a_tool():
    from tools.route_tools import get_last_known_location
    assert get_last_known_location.name == "get_last_known_location"
    assert "assignment" in get_last_known_location.description.lower()
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
PYTHONPATH=. python -m pytest tests/test_route_tools.py -v
```

Expected: `FAILED` — `ImportError: cannot import name 'get_last_known_location'`

- [ ] **Step 3: Add `get_last_known_location` to route_tools.py**

Append to `agents/tools/route_tools.py` after the existing `get_route_steps` function:

```python
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
PYTHONPATH=. python -m pytest tests/test_route_tools.py -v
```

Expected: 3 tests `PASSED`

- [ ] **Step 5: Commit**

```bash
git add tools/route_tools.py tests/test_route_tools.py
git commit -m "feat(route): add get_last_known_location tool for MCP chaining"
```

---

## Task 2: Create `mcp_client.py`

**Files:**
- Create: `agents/mcp_client.py`
- Create: `agents/tests/test_mcp_client.py`

- [ ] **Step 1: Write the failing tests**

Create `agents/tests/test_mcp_client.py`:

```python
import pytest
from unittest.mock import patch, AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_load_mcp_tools_returns_list_on_success():
    """load_mcp_tools() should return a non-empty list of LangChain tools."""
    mock_tool = MagicMock()
    mock_tool.name = "maps_get_directions"

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get_tools = AsyncMock(return_value=[mock_tool])

    with patch("mcp_client.MultiServerMCPClient", return_value=mock_client):
        import importlib
        import mcp_client as mod
        importlib.reload(mod)
        result = await mod.load_mcp_tools()

    assert isinstance(result, list)
    assert len(result) >= 1


@pytest.mark.asyncio
async def test_load_mcp_tools_returns_empty_list_on_failure():
    """load_mcp_tools() must not raise — returns [] on any error."""
    with patch("mcp_client.MultiServerMCPClient", side_effect=Exception("Node not found")):
        import importlib
        import mcp_client as mod
        importlib.reload(mod)
        result = await mod.load_mcp_tools()

    assert result == []


def test_get_mcp_tools_returns_cached_list():
    """get_mcp_tools() returns whatever was stored by load_mcp_tools."""
    import importlib
    import mcp_client as mod
    importlib.reload(mod)

    mod._mcp_tools = ["tool_a", "tool_b"]
    assert mod.get_mcp_tools() == ["tool_a", "tool_b"]


def test_get_mcp_tools_returns_empty_before_load():
    """get_mcp_tools() returns [] if load_mcp_tools has not been called."""
    import importlib
    import mcp_client as mod
    importlib.reload(mod)
    assert mod.get_mcp_tools() == []
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
PYTHONPATH=. python -m pytest tests/test_mcp_client.py -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'mcp_client'`

- [ ] **Step 3: Create `agents/mcp_client.py`**

```python
import os
import logging
from langchain_mcp_adapters.client import MultiServerMCPClient

logger = logging.getLogger(__name__)

_mcp_tools: list = []


async def load_mcp_tools() -> list:
    """Spawn Google Maps MCP server subprocess and load its tools.
    Returns empty list on any failure — RouteAgent degrades gracefully."""
    global _mcp_tools
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        logger.warning("GOOGLE_MAPS_API_KEY not set — Google Maps MCP tools will not be available")
        return []
    try:
        async with MultiServerMCPClient(
            {
                "google_maps": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-google-maps"],
                    "env": {"GOOGLE_MAPS_API_KEY": api_key},
                    "transport": "stdio",
                }
            }
        ) as client:
            tools = await client.get_tools()
            _mcp_tools = tools
            logger.info(f"Loaded {len(tools)} Google Maps MCP tools: {[t.name for t in tools]}")
            return tools
    except Exception as e:
        logger.warning(f"Google Maps MCP server failed to load (non-fatal): {e}")
        _mcp_tools = []
        return []


def get_mcp_tools() -> list:
    """Return MCP tools loaded at startup. Empty list if load_mcp_tools() was not called or failed."""
    return _mcp_tools
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
PYTHONPATH=. python -m pytest tests/test_mcp_client.py -v
```

Expected: 4 tests `PASSED`

- [ ] **Step 5: Commit**

```bash
git add mcp_client.py tests/test_mcp_client.py
git commit -m "feat(mcp): add mcp_client module for Google Maps MCP server"
```

---

## Task 3: Update `route_agent.py` to accept MCP tools

**Files:**
- Modify: `agents/agents/route_agent.py`
- Modify: `agents/tests/test_graph_structure.py`

- [ ] **Step 1: Write the failing test**

Add to `agents/tests/test_graph_structure.py`:

```python
@patch("agents.route_agent.get_llm")
def test_route_agent_accepts_mcp_tools(mock_get_llm):
    """build_route_agent() should include extra MCP tools when passed."""
    mock_get_llm.return_value = _make_fake_llm()
    from agents.route_agent import build_route_agent
    from unittest.mock import MagicMock
    from langchain_core.tools import tool

    @tool
    def fake_mcp_tool(query: str) -> str:
        """A fake MCP tool for testing."""
        return query

    agent = build_route_agent(mcp_tools=[fake_mcp_tool])
    # Agent should have a tools node
    assert "tools" in list(agent.nodes.keys())


@patch("agents.route_agent.get_llm")
def test_route_agent_works_without_mcp_tools(mock_get_llm):
    """build_route_agent() without args uses only the 4 standard tools."""
    mock_get_llm.return_value = _make_fake_llm()
    from agents.route_agent import build_route_agent
    agent = build_route_agent()
    assert "tools" in list(agent.nodes.keys())
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
PYTHONPATH=. python -m pytest tests/test_graph_structure.py::test_route_agent_accepts_mcp_tools tests/test_graph_structure.py::test_route_agent_works_without_mcp_tools -v
```

Expected: `FAILED` — `TypeError: build_route_agent() takes 0 positional arguments but 1 was given`

- [ ] **Step 3: Rewrite `agents/agents/route_agent.py`**

```python
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
PYTHONPATH=. python -m pytest tests/test_graph_structure.py -v
```

Expected: all tests `PASSED` including the two new ones

- [ ] **Step 5: Commit**

```bash
git add agents/route_agent.py tests/test_graph_structure.py
git commit -m "feat(route): build_route_agent accepts optional MCP tools list"
```

---

## Task 4: Wire MCP loading into `supervisor.py` and `main.py`

**Files:**
- Modify: `agents/agents/supervisor.py`
- Modify: `agents/main.py`

- [ ] **Step 1: Add `set_route_agent()` to `supervisor.py`**

In `agents/agents/supervisor.py`, change the route agent initialisation and add a setter. Replace:

```python
_route_agent = build_route_agent()
```

With:

```python
_route_agent = build_route_agent()  # default — no MCP tools until lifespan runs


def set_route_agent(agent) -> None:
    """Replace the route agent with one that has MCP tools loaded. Called from main.py lifespan."""
    global _route_agent
    _route_agent = agent
```

No other changes to supervisor.py needed.

- [ ] **Step 2: Update `main.py` lifespan to load MCP tools**

In `agents/main.py`, add these imports after the existing imports:

```python
from mcp_client import load_mcp_tools
from agents.route_agent import build_route_agent
from agents.supervisor import set_route_agent
```

Then in the `lifespan` function, add MCP loading **before** `yield`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler

    # Load Google Maps MCP tools and rebuild route agent with them
    mcp_tools = await load_mcp_tools()
    if mcp_tools:
        set_route_agent(build_route_agent(mcp_tools))

    _scheduler = BackgroundScheduler()

    def _run():
        _monitor_state["last_run"] = datetime.now(timezone.utc).isoformat()
        try:
            run_all_checks()
            _monitor_state["status"] = "running"
        except Exception as e:
            _monitor_state["status"] = f"error: {e}"

    _scheduler.add_job(_run, "interval", seconds=settings.monitor_poll_interval_sec, id="monitor")
    _scheduler.start()
    _monitor_state["status"] = "running"
    yield
    _scheduler.shutdown(wait=False)
```

- [ ] **Step 3: Test the wiring manually (smoke test)**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
PYTHONPATH=. uvicorn main:app --reload --port 8000
```

Expected log output on startup:
```
INFO:mcp_client:Loaded 6 Google Maps MCP tools: ['maps_geocode', 'maps_reverse_geocode', ...]
INFO:     Application startup complete.
```

If you see `WARNING:mcp_client:Google Maps MCP server failed to load` — check `GOOGLE_MAPS_API_KEY` is set in `.env`.

- [ ] **Step 4: Run the full test suite**

```bash
PYTHONPATH=. python -m pytest tests/ -v
```

Expected: all tests `PASSED`

- [ ] **Step 5: Commit**

```bash
git add agents/supervisor.py main.py
git commit -m "feat(main): load Google Maps MCP tools in lifespan and inject into RouteAgent"
```

---

## Task 5: Add Node.js package files for CF deployment

**Files:**
- Create: `agents/package.json`
- Modify: `agents/requirements.txt`
- Modify: `agents/.cfignore`

- [ ] **Step 1: Create `agents/package.json`**

```json
{
  "name": "gmaps-dispatch-agents",
  "version": "1.0.0",
  "description": "Node.js MCP server dependencies for gmaps-dispatch-agents CF app",
  "dependencies": {
    "@modelcontextprotocol/server-google-maps": "0.6.2"
  }
}
```

- [ ] **Step 2: Update `agents/requirements.txt`**

Add `langchain-mcp-adapters` pin after the existing `langchain-core` line:

```
langchain-mcp-adapters>=0.1,<1
```

- [ ] **Step 3: Add `node_modules/` to `.cfignore`**

Append to `agents/.cfignore`:

```
# Node.js (MCP server installed by CF buildpack at deploy time)
node_modules/
package-lock.json
```

- [ ] **Step 4: Run `npm install` locally to verify package resolves**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
npm install
npx @modelcontextprotocol/server-google-maps --help 2>&1 | head -3
```

Expected: `Google Maps MCP Server running on stdio` (then Ctrl+C)

- [ ] **Step 5: Commit**

```bash
git add package.json requirements.txt .cfignore
git commit -m "chore(cf): add Node.js MCP server dependency for CF deployment"
```

---

## Task 6: Local end-to-end test

- [ ] **Step 1: Start the server**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
PYTHONPATH=. uvicorn main:app --port 8000
```

Confirm startup log shows MCP tools loaded.

- [ ] **Step 2: Test route query with MCP — places near coordinates**

```bash
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test-mcp-1","message":"find fuel stations near coordinates 12.971598, 77.594562"}' | python3 -m json.tool
```

Expected: `reply` field contains a list of nearby fuel stations with names and addresses.

- [ ] **Step 3: Test chained query — GPS from DB then nearby places**

```bash
# First get a real assignment ID from the system
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test-mcp-2","message":"get the last known location for assignment <PASTE_REAL_ASSIGNMENT_ID> and find nearby fuel stations"}' | python3 -m json.tool
```

Expected: Agent calls `get_last_known_location` first, then `maps_search_places`, returns combined result.

- [ ] **Step 4: Test graceful fallback — ensure non-route queries unaffected**

```bash
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test-mcp-3","message":"list open deliveries"}' | python3 -m json.tool
```

Expected: Normal delivery list response — DeliveryAgent handles it, MCP not involved.

- [ ] **Step 5: Check health endpoint shows route agent ready**

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `"route_agent": "ready"` and `"status": "ok"`

---

## Task 7: Deploy to Cloud Foundry

- [ ] **Step 1: Verify CF login**

```bash
cf target
```

Expected: shows org and space. If expired, run `cf login`.

- [ ] **Step 2: CF push**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
cf push
```

Expected: build succeeds. Watch for:
- Python buildpack detects `requirements.txt` ✓
- Python buildpack detects `package.json` and runs `npm install` ✓
- App starts with `uvicorn main:app`

- [ ] **Step 3: Set secrets**

```bash
bash cf_set_env.sh && cf restart gmaps-dispatch-agents
```

- [ ] **Step 4: Check CF logs for MCP startup**

```bash
cf logs gmaps-dispatch-agents --recent | grep -E "mcp_client|MCP|google_maps"
```

Expected: `Loaded N Google Maps MCP tools`

- [ ] **Step 5: Health check on CF**

```bash
curl -s https://gmaps-dispatch-agents.cfapps.us10.hana.ondemand.com/health | python3 -m json.tool
```

Expected: `"status": "ok"`

- [ ] **Step 6: Smoke test on CF**

```bash
curl -s -X POST https://gmaps-dispatch-agents.cfapps.us10.hana.ondemand.com/chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"cf-mcp-test","message":"find restaurants near 12.971598, 77.594562"}' | python3 -m json.tool
```

Expected: reply with nearby restaurants.

- [ ] **Step 7: Final commit and push to main**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps
git add -A
git commit -m "feat: RouteAgent Google Maps MCP integration complete"
git push origin main
```
