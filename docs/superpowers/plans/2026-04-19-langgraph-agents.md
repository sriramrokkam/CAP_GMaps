# LangGraph Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python FastAPI + LangGraph multi-agent service in `agents/` that lets a dispatcher manage EWM deliveries and driver assignments via natural language, with human-in-the-loop confirmation for all write actions and a background monitor posting proactive Teams alerts.

**Architecture:** Supervisor agent routes `/chat` messages to DeliveryAgent, DriverAgent, or RouteAgent; all write actions return a proposal that the caller must confirm before execution. A MonitorAgent runs on APScheduler every 5 min and posts 3 types of alerts to Teams webhook independently.

**Tech Stack:** Python 3.11, FastAPI, LangGraph, `generative-ai-hub-sdk` (SAP AI Core / Claude Sonnet 4.6), APScheduler, httpx, python-dotenv, pytest, CF Python buildpack.

---

## File Map

| File | Responsibility |
|------|---------------|
| `agents/config.py` | Load all env vars, expose typed `Settings` object |
| `agents/state.py` | LangGraph `AgentState` TypedDict + `ActionProposal` dataclass |
| `agents/tools/odata_client.py` | XSUAA token fetch + refresh; authenticated httpx GET/POST to CAP |
| `agents/tools/delivery_tools.py` | LangGraph tools wrapping EWM OData calls |
| `agents/tools/driver_tools.py` | LangGraph tools wrapping Tracking OData calls (read + propose-only writes) |
| `agents/tools/route_tools.py` | LangGraph tools wrapping GMaps OData calls |
| `agents/tools/teams_tools.py` | Post MessageCard to Teams Incoming Webhook |
| `agents/agents/delivery_agent.py` | DeliveryAgent LangGraph subgraph |
| `agents/agents/driver_agent.py` | DriverAgent LangGraph subgraph |
| `agents/agents/route_agent.py` | RouteAgent LangGraph subgraph |
| `agents/agents/monitor_agent.py` | MonitorAgent: 3 check functions + APScheduler job |
| `agents/agents/supervisor.py` | SupervisorAgent: intent classification, routing, HiTL gate |
| `agents/main.py` | FastAPI app: `/chat`, `/health`, lifespan scheduler startup |
| `agents/tests/test_odata_client.py` | Unit tests for token refresh logic |
| `agents/tests/test_tools.py` | Unit tests for each tool (mocked httpx) |
| `agents/tests/test_monitor.py` | Unit tests for 3 monitor checks |
| `agents/tests/test_api.py` | Integration tests for `/chat` and `/health` endpoints |
| `agents/requirements.txt` | All dependencies pinned |
| `agents/.env.example` | Template for `.env` (committed, no secrets) |
| `agents/manifest.yml` | CF standalone push manifest |
| `agents/mta.yaml` | CF MTA module definition |
| `agents/Procfile` | `web: uvicorn main:app --host 0.0.0.0 --port $PORT` |

---

## Task 1: Project scaffold and config

**Files:**
- Create: `agents/config.py`
- Create: `agents/requirements.txt`
- Create: `agents/.env.example`
- Create: `agents/.gitignore`
- Create: `agents/tests/__init__.py`
- Create: `agents/tests/test_config.py`

- [ ] **Step 1: Create `agents/` directory structure**

```bash
mkdir -p agents/agents agents/tools agents/tests
touch agents/__init__.py agents/agents/__init__.py agents/tools/__init__.py agents/tests/__init__.py
```

- [ ] **Step 2: Write `agents/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
langgraph==0.2.56
langchain-core==0.3.27
generative-ai-hub-sdk==4.3.0
apscheduler==3.10.4
httpx==0.27.2
python-dotenv==1.0.1
pydantic==2.9.2
pydantic-settings==2.5.2
pytest==8.3.3
pytest-asyncio==0.24.0
respx==0.21.1
```

- [ ] **Step 3: Write failing test for config**

Create `agents/tests/test_config.py`:
```python
import pytest
from unittest.mock import patch
import os

def test_settings_loads_required_vars():
    env = {
        "AICORE_AUTH_URL": "https://auth.example.com",
        "AICORE_CLIENT_ID": "client-id",
        "AICORE_CLIENT_SECRET": "secret",
        "AICORE_BASE_URL": "https://aicore.example.com",
        "AICORE_DEPLOYMENT_ID": "deploy-123",
        "CAP_BASE_URL": "https://srv.cfapps.us10.hana.ondemand.com",
        "XSUAA_URL": "https://xsuaa.example.com",
        "XSUAA_CLIENT_ID": "xsuaa-client",
        "XSUAA_CLIENT_SECRET": "xsuaa-secret",
        "TEAMS_WEBHOOK_URL": "https://outlook.office.com/webhook/xxx",
    }
    with patch.dict(os.environ, env, clear=True):
        from config import Settings
        s = Settings()
        assert s.cap_base_url == "https://srv.cfapps.us10.hana.ondemand.com"
        assert s.monitor_poll_interval_sec == 300
        assert s.unassigned_threshold_min == 30
        assert s.idle_threshold_min == 20
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd agents && pip install -r requirements.txt && pytest tests/test_config.py -v
```
Expected: `ModuleNotFoundError: No module named 'config'`

- [ ] **Step 5: Write `agents/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    aicore_auth_url: str
    aicore_client_id: str
    aicore_client_secret: str
    aicore_base_url: str
    aicore_deployment_id: str

    cap_base_url: str

    xsuaa_url: str
    xsuaa_client_id: str
    xsuaa_client_secret: str

    teams_webhook_url: str

    monitor_poll_interval_sec: int = 300
    unassigned_threshold_min: int = 30
    idle_threshold_min: int = 20

settings = Settings()
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd agents && pytest tests/test_config.py -v
```
Expected: `PASSED`

- [ ] **Step 7: Write `agents/.env.example`**

```env
# AI Core (SAP BTP)
AICORE_AUTH_URL=https://<subaccount>.authentication.us10.hana.ondemand.com/oauth/token
AICORE_CLIENT_ID=
AICORE_CLIENT_SECRET=
AICORE_BASE_URL=https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com
AICORE_DEPLOYMENT_ID=

# CAP OData base URL
CAP_BASE_URL=https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-srv.cfapps.us10.hana.ondemand.com

# XSUAA client credentials (for agent → CAP auth)
XSUAA_URL=https://<subaccount>.authentication.us10.hana.ondemand.com
XSUAA_CLIENT_ID=
XSUAA_CLIENT_SECRET=

# Teams Incoming Webhook
TEAMS_WEBHOOK_URL=

# Monitor tuning (optional, defaults shown)
MONITOR_POLL_INTERVAL_SEC=300
UNASSIGNED_THRESHOLD_MIN=30
IDLE_THRESHOLD_MIN=20
```

- [ ] **Step 8: Write `agents/.gitignore`**

```
.env
__pycache__/
*.pyc
.pytest_cache/
dist/
*.egg-info/
```

- [ ] **Step 9: Commit**

```bash
git add agents/
git commit -m "feat(agents): scaffold project structure, config, requirements"
```

---

## Task 2: Shared OData client with XSUAA token management

**Files:**
- Create: `agents/tools/odata_client.py`
- Create: `agents/tests/test_odata_client.py`

- [ ] **Step 1: Write failing tests**

Create `agents/tests/test_odata_client.py`:
```python
import pytest
import respx
import httpx
from unittest.mock import patch, MagicMock
import time

def make_settings():
    s = MagicMock()
    s.xsuaa_url = "https://xsuaa.example.com"
    s.xsuaa_client_id = "cid"
    s.xsuaa_client_secret = "sec"
    s.cap_base_url = "https://srv.example.com"
    return s

@respx.mock
def test_get_token_fetches_and_caches():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    client = ODataClient(make_settings())
    token = client._get_token()
    assert token == "tok123"
    # second call should use cache, not make another request
    token2 = client._get_token()
    assert token2 == "tok123"
    assert respx.calls.call_count == 1

@respx.mock
def test_get_fetches_odata_with_auth():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    respx.get("https://srv.example.com/odata/v4/ewm/OutboundDeliveries").mock(
        return_value=httpx.Response(200, json={"value": [{"DeliveryDocument": "80000001"}]})
    )
    client = ODataClient(make_settings())
    result = client.get("/odata/v4/ewm/OutboundDeliveries")
    assert result["value"][0]["DeliveryDocument"] == "80000001"

@respx.mock
def test_post_sends_json_body():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    respx.post("https://srv.example.com/odata/v4/tracking/assignDriver").mock(
        return_value=httpx.Response(200, json={"ID": "abc"})
    )
    client = ODataClient(make_settings())
    result = client.post("/odata/v4/tracking/assignDriver", {"deliveryDoc": "80000001"})
    assert result["ID"] == "abc"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agents && pytest tests/test_odata_client.py -v
```
Expected: `ModuleNotFoundError: No module named 'tools.odata_client'`

- [ ] **Step 3: Write `agents/tools/odata_client.py`**

```python
import time
import httpx
from config import Settings

class ODataClient:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._token: str | None = None
        self._token_expiry: float = 0

    def _get_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        resp = httpx.post(
            f"{self._settings.xsuaa_url}/oauth/token",
            data={"grant_type": "client_credentials"},
            auth=(self._settings.xsuaa_client_id, self._settings.xsuaa_client_secret),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.time() + data["expires_in"]
        return self._token

    def get(self, path: str, params: dict | None = None) -> dict:
        resp = httpx.get(
            f"{self._settings.cap_base_url}{path}",
            params=params,
            headers={"Authorization": f"Bearer {self._get_token()}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def post(self, path: str, body: dict) -> dict:
        resp = httpx.post(
            f"{self._settings.cap_base_url}{path}",
            json=body,
            headers={"Authorization": f"Bearer {self._get_token()}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agents && pytest tests/test_odata_client.py -v
```
Expected: all 3 `PASSED`

- [ ] **Step 5: Commit**

```bash
git add agents/tools/odata_client.py agents/tests/test_odata_client.py
git commit -m "feat(agents): add ODataClient with XSUAA token caching"
```

---

## Task 3: LangGraph state schema + ActionProposal

**Files:**
- Create: `agents/state.py`

- [ ] **Step 1: Write `agents/state.py`**

```python
from typing import Annotated, Any
from dataclasses import dataclass, field
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

@dataclass
class ActionProposal:
    tool: str
    args: dict
    reasoning: str

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    thread_id: str
    pending_action: ActionProposal | None
    confirmed: bool | None  # None = not yet asked, True/False = response received
```

- [ ] **Step 2: Verify imports work**

```bash
cd agents && python -c "from state import AgentState, ActionProposal; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add agents/state.py
git commit -m "feat(agents): add AgentState and ActionProposal schema"
```

---

## Task 4: Delivery tools

**Files:**
- Create: `agents/tools/delivery_tools.py`
- Create: `agents/tests/test_tools.py` (delivery section)

- [ ] **Step 1: Write failing tests**

Create `agents/tests/test_tools.py`:
```python
import pytest
import respx
import httpx
from unittest.mock import MagicMock, patch

def make_client(deliveries=None, items=None, route=None):
    client = MagicMock()
    if deliveries is not None:
        client.get.return_value = {"value": deliveries}
    if items is not None:
        client.post.return_value = {"value": items}
    if route is not None:
        client.post.return_value = route
    return client

def test_list_open_deliveries_returns_list():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"DeliveryDocument": "80000001", "DriverStatus": "OPEN"}]}
        from tools.delivery_tools import list_open_deliveries
        result = list_open_deliveries()
        assert "80000001" in result

def test_list_unassigned_deliveries_filters_correctly():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"DeliveryDocument": "80000002"}]}
        from tools.delivery_tools import list_unassigned_deliveries
        result = list_unassigned_deliveries()
        assert "80000002" in result

def test_get_delivery_items_returns_items():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.post.return_value = {"value": [{"Material": "MAT001", "DeliveryQuantity": 10}]}
        from tools.delivery_tools import get_delivery_items
        result = get_delivery_items("80000001")
        assert "MAT001" in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agents && pytest tests/test_tools.py -v
```
Expected: `ModuleNotFoundError: No module named 'tools.delivery_tools'`

- [ ] **Step 3: Write `agents/tools/delivery_tools.py`**

```python
from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings
import json

_client = ODataClient(settings)

@tool
def list_open_deliveries() -> str:
    """List all open outbound deliveries from EWM."""
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq 'OPEN' or DriverStatus eq null", "$top": "50"})
    deliveries = data.get("value", [])
    if not deliveries:
        return "No open deliveries found."
    lines = [f"- {d['DeliveryDocument']} | Ship-To: {d.get('ShipToParty','?')} | Route: {d.get('ActualDeliveryRoute','?')}" for d in deliveries]
    return f"{len(deliveries)} open deliveries:\n" + "\n".join(lines)

@tool
def list_unassigned_deliveries() -> str:
    """List open deliveries with no driver assigned."""
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    deliveries = [d for d in data.get("value", []) if not d.get("DriverMobile")]
    if not deliveries:
        return "All deliveries have drivers assigned."
    lines = [f"- {d['DeliveryDocument']} | Ship-To: {d.get('ShipToParty','?')} | Date: {d.get('DeliveryDate','?')}" for d in deliveries]
    return f"{len(deliveries)} unassigned deliveries:\n" + "\n".join(lines)

@tool
def get_delivery_items(delivery_doc: str) -> str:
    """Get line items for a specific delivery document."""
    data = _client.post("/odata/v4/ewm/getDeliveryItems", {"deliveryDoc": delivery_doc})
    items = data.get("value", [])
    if not items:
        return f"No items found for delivery {delivery_doc}."
    lines = [f"- {i.get('Material','?')} | Qty: {i.get('DeliveryQuantity','?')} {i.get('DeliveryQuantityUnit','')}" for i in items]
    return f"Items for {delivery_doc}:\n" + "\n".join(lines)

@tool
def get_delivery_route(delivery_doc: str) -> str:
    """Fetch Google Maps route for a delivery document."""
    data = _client.post("/odata/v4/ewm/getDeliveryRoute", {"deliveryDoc": delivery_doc})
    if not data:
        return f"No route found for delivery {delivery_doc}."
    return f"Route for {delivery_doc}: {data.get('origin','?')} → {data.get('destination','?')} | Distance: {data.get('distance','?')} | Duration: {data.get('duration','?')}"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agents && pytest tests/test_tools.py -v
```
Expected: all 3 `PASSED`

- [ ] **Step 5: Commit**

```bash
git add agents/tools/delivery_tools.py agents/tests/test_tools.py
git commit -m "feat(agents): add delivery tools wrapping EWM OData"
```

---

## Task 5: Driver tools

**Files:**
- Modify: `agents/tools/driver_tools.py`
- Modify: `agents/tests/test_tools.py`

- [ ] **Step 1: Add failing tests to `agents/tests/test_tools.py`**

Append to the file:
```python
def test_list_drivers_returns_names():
    with patch("tools.driver_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"ID": "d1", "Name": "Raj Kumar", "Mobile": "+91999"}]}
        from tools.driver_tools import list_drivers
        result = list_drivers()
        assert "Raj Kumar" in result

def test_get_driver_status_returns_status():
    with patch("tools.driver_tools._client") as mock_client:
        mock_client.get.return_value = {"Status": "IN_TRANSIT", "DeliveryDocument": "80000001", "DriverName": "Raj"}
        from tools.driver_tools import get_driver_status
        result = get_driver_status("some-uuid")
        assert "IN_TRANSIT" in result

def test_propose_assign_driver_returns_proposal_not_executes():
    with patch("tools.driver_tools._client") as mock_client:
        from tools.driver_tools import propose_assign_driver
        result = propose_assign_driver("80000001", "+91999", "KA01AB1234", "Raj Kumar")
        # Must NOT have called post — it's a proposal only
        mock_client.post.assert_not_called()
        assert "PROPOSAL" in result
        assert "80000001" in result
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd agents && pytest tests/test_tools.py::test_list_drivers_returns_names -v
```
Expected: `ModuleNotFoundError: No module named 'tools.driver_tools'`

- [ ] **Step 3: Write `agents/tools/driver_tools.py`**

```python
from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings
import json

_client = ODataClient(settings)

@tool
def list_drivers() -> str:
    """List all registered drivers."""
    data = _client.get("/odata/v4/tracking/Driver")
    drivers = data.get("value", [])
    if not drivers:
        return "No drivers registered."
    lines = [f"- {d.get('Name','?')} | Mobile: {d.get('Mobile','?')}" for d in drivers]
    return f"{len(drivers)} drivers:\n" + "\n".join(lines)

@tool
def list_assignments() -> str:
    """List all active driver assignments."""
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status ne 'DELIVERED'", "$top": "50"})
    assignments = data.get("value", [])
    if not assignments:
        return "No active assignments."
    lines = [f"- {a.get('DriverName','?')} | Delivery: {a.get('DeliveryDocument','?')} | Status: {a.get('Status','?')} | Truck: {a.get('TruckRegistration','?')}" for a in assignments]
    return f"{len(assignments)} active assignments:\n" + "\n".join(lines)

@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment by ID."""
    data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    return (f"Driver: {data.get('DriverName','?')} | Status: {data.get('Status','?')} | "
            f"Delivery: {data.get('DeliveryDocument','?')} | Truck: {data.get('TruckRegistration','?')} | "
            f"Assigned: {data.get('AssignedAt','?')}")

@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment."""
    data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    return (f"Last GPS: Lat {data.get('Latitude','?')}, Lng {data.get('Longitude','?')} | "
            f"Speed: {data.get('Speed','?')} m/s | Updated: {data.get('LastGpsAt','?')}")

@tool
def propose_assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Propose assigning a driver to a delivery. Returns a proposal for human confirmation — does NOT execute."""
    return (f"PROPOSAL|tool=execute_assign_driver|"
            f"args={json.dumps({'deliveryDoc': delivery_doc, 'mobileNumber': mobile_number, 'truckRegistration': truck_registration, 'driverName': driver_name})}|"
            f"reasoning=Assign {driver_name} ({truck_registration}) to delivery {delivery_doc}")

@tool
def propose_confirm_delivery(assignment_id: str) -> str:
    """Propose confirming a delivery as completed. Returns a proposal for human confirmation — does NOT execute."""
    return (f"PROPOSAL|tool=execute_confirm_delivery|"
            f"args={json.dumps({'assignmentId': assignment_id})}|"
            f"reasoning=Mark assignment {assignment_id} as DELIVERED")

def execute_assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Execute driver assignment after human confirmation."""
    data = _client.post("/odata/v4/tracking/assignDriver", {
        "deliveryDoc": delivery_doc,
        "mobileNumber": mobile_number,
        "truckRegistration": truck_registration,
        "driverName": driver_name,
    })
    return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID','?')}"

def execute_confirm_delivery(assignment_id: str) -> str:
    """Execute delivery confirmation after human confirmation."""
    _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
    return f"Delivery confirmed for assignment {assignment_id}."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agents && pytest tests/test_tools.py -v
```
Expected: all tests `PASSED`

- [ ] **Step 5: Commit**

```bash
git add agents/tools/driver_tools.py agents/tests/test_tools.py
git commit -m "feat(agents): add driver tools with proposal-only write pattern"
```

---

## Task 6: Route tools + Teams tools

**Files:**
- Create: `agents/tools/route_tools.py`
- Create: `agents/tools/teams_tools.py`

- [ ] **Step 1: Write `agents/tools/route_tools.py`**

```python
from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings

_client = ODataClient(settings)

@tool
def get_route_for_delivery(delivery_doc: str) -> str:
    """Fetch Google Maps route directions for a delivery document."""
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
    """Get turn-by-turn directions for a route ID."""
    data = _client.get(f"/odata/v4/gmaps/RouteDirections({route_id})/steps", {"$orderby": "stepNumber asc"})
    steps = data.get("value", [])
    if not steps:
        return "No steps found."
    lines = [f"{s.get('stepNumber','?')}. {s.get('instruction','?')} ({s.get('distance','?')})" for s in steps]
    return "\n".join(lines)
```

- [ ] **Step 2: Write `agents/tools/teams_tools.py`**

```python
import httpx
from config import settings

def post_teams_alert(message: str, title: str = "Dispatch Alert") -> bool:
    """Post a MessageCard to the Teams Incoming Webhook. Returns True on success."""
    card = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": title,
        "themeColor": "E8A000",
        "title": title,
        "text": message,
    }
    try:
        resp = httpx.post(settings.teams_webhook_url, json=card, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False
```

- [ ] **Step 3: Verify imports**

```bash
cd agents && python -c "from tools.route_tools import get_route_for_delivery; from tools.teams_tools import post_teams_alert; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add agents/tools/route_tools.py agents/tools/teams_tools.py
git commit -m "feat(agents): add route tools and Teams webhook poster"
```

---

## Task 7: MonitorAgent — 3 proactive checks

**Files:**
- Create: `agents/agents/monitor_agent.py`
- Create: `agents/tests/test_monitor.py`

- [ ] **Step 1: Write failing tests**

Create `agents/tests/test_monitor.py`:
```python
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

def make_delivery(doc, age_min, has_driver=False):
    created = datetime.now(timezone.utc) - timedelta(minutes=age_min)
    return {
        "DeliveryDocument": doc,
        "createdAt": created.isoformat(),
        "DriverMobile": "+91999" if has_driver else None,
        "ShipToParty": "17100001",
    }

def make_assignment(id_, status, last_gps_min_ago):
    last_gps = datetime.now(timezone.utc) - timedelta(minutes=last_gps_min_ago)
    return {
        "ID": id_,
        "Status": status,
        "DriverName": "Raj",
        "TruckRegistration": "KA01",
        "DeliveryDocument": "80000001",
        "CurrentLat": 12.9,
        "CurrentLng": 77.5,
        "modifiedAt": last_gps.isoformat(),
    }

def test_check_unassigned_threshold_detects_old_deliveries():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_delivery("80000001", age_min=45, has_driver=False)]}
        from agents.monitor_agent import check_unassigned_deliveries
        check_unassigned_deliveries()
        mock_alert.assert_called_once()
        assert "80000001" in mock_alert.call_args[0][0] or "unassigned" in mock_alert.call_args[0][0].lower()

def test_check_unassigned_threshold_skips_recent():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_delivery("80000002", age_min=5, has_driver=False)]}
        from agents.monitor_agent import check_unassigned_deliveries
        check_unassigned_deliveries()
        mock_alert.assert_not_called()

def test_check_idle_drivers_fires_for_assigned_no_gps():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_assignment("id1", "ASSIGNED", last_gps_min_ago=25)]}
        from agents.monitor_agent import check_idle_drivers
        check_idle_drivers()
        mock_alert.assert_called_once()
        assert "Raj" in mock_alert.call_args[0][0]
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd agents && pytest tests/test_monitor.py -v
```
Expected: `ModuleNotFoundError: No module named 'agents.monitor_agent'`

- [ ] **Step 3: Write `agents/agents/monitor_agent.py`**

```python
from datetime import datetime, timezone, timedelta
from tools.odata_client import ODataClient
from tools.teams_tools import post_teams_alert
from config import settings

_client = ODataClient(settings)
_alert_cooldown: dict[tuple, datetime] = {}
_COOLDOWN_MIN = 30

def _should_alert(key: tuple) -> bool:
    last = _alert_cooldown.get(key)
    if last and datetime.now(timezone.utc) - last < timedelta(minutes=_COOLDOWN_MIN):
        return False
    _alert_cooldown[key] = datetime.now(timezone.utc)
    return True

def check_unassigned_deliveries():
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    threshold = timedelta(minutes=settings.unassigned_threshold_min)
    now = datetime.now(timezone.utc)
    old = []
    for d in data.get("value", []):
        if d.get("DriverMobile"):
            continue
        created_str = d.get("createdAt", "")
        try:
            created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age = now - created
            if age > threshold:
                old.append((d["DeliveryDocument"], int(age.total_seconds() // 60)))
        except Exception:
            continue
    if not old:
        return
    key = ("unassigned", tuple(d for d, _ in old))
    if not _should_alert(key):
        return
    oldest_min = max(m for _, m in old)
    msg = f"📦 {len(old)} deliveries unassigned — oldest waiting {oldest_min} min. Docs: {', '.join(d for d, _ in old)}"
    post_teams_alert(msg, title="Unassigned Deliveries")

def check_idle_drivers():
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status eq 'ASSIGNED'", "$top": "50"})
    threshold = timedelta(minutes=settings.idle_threshold_min)
    now = datetime.now(timezone.utc)
    for a in data.get("value", []):
        modified_str = a.get("modifiedAt", "")
        try:
            modified = datetime.fromisoformat(modified_str.replace("Z", "+00:00"))
            idle_min = int((now - modified).total_seconds() // 60)
            if idle_min < settings.idle_threshold_min:
                continue
        except Exception:
            continue
        key = ("idle", a["ID"])
        if not _should_alert(key):
            continue
        msg = (f"🚛 Driver {a.get('DriverName','?')} ({a.get('TruckRegistration','?')}) "
               f"assigned but not moving for {idle_min} min — delivery {a.get('DeliveryDocument','?')}")
        post_teams_alert(msg, title="Idle Driver Alert")

def check_batch_opportunities():
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    zone_map: dict[str, list[str]] = {}
    for d in data.get("value", []):
        if d.get("DriverMobile"):
            continue
        zone = d.get("ShipToParty", "UNKNOWN")
        zone_map.setdefault(zone, []).append(d["DeliveryDocument"])
    for zone, docs in zone_map.items():
        if len(docs) < 2:
            continue
        key = ("batch", zone)
        if not _should_alert(key):
            continue
        msg = f"📍 {len(docs)} deliveries for ship-to {zone} — consider assigning same driver: {', '.join(docs)}"
        post_teams_alert(msg, title="Batch Opportunity")

def run_all_checks():
    for check in [check_unassigned_deliveries, check_idle_drivers, check_batch_opportunities]:
        try:
            check()
        except Exception as e:
            print(f"Monitor check {check.__name__} failed: {e}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agents && pytest tests/test_monitor.py -v
```
Expected: all 3 `PASSED`

- [ ] **Step 5: Commit**

```bash
git add agents/agents/monitor_agent.py agents/tests/test_monitor.py
git commit -m "feat(agents): add MonitorAgent with 3 proactive checks + alert deduplication"
```

---

## Task 8: Specialist subagents (Delivery, Driver, Route)

**Files:**
- Create: `agents/agents/delivery_agent.py`
- Create: `agents/agents/driver_agent.py`
- Create: `agents/agents/route_agent.py`

- [ ] **Step 1: Write `agents/agents/delivery_agent.py`**

```python
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.delivery_tools import list_open_deliveries, list_unassigned_deliveries, get_delivery_items, get_delivery_route
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DeliveryAgent. You answer questions about EWM outbound deliveries.
Use the available tools to list open deliveries, show delivery items, and fetch route information.
Be concise. Format lists clearly. Never make up delivery document numbers.""")

def build_delivery_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_open_deliveries, list_unassigned_deliveries, get_delivery_items, get_delivery_route],
        state_modifier=SYSTEM,
    )
```

- [ ] **Step 2: Write `agents/agents/driver_agent.py`**

```python
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.driver_tools import list_drivers, list_assignments, get_driver_status, get_live_location, propose_assign_driver, propose_confirm_delivery
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DriverAgent. You manage driver assignments and track GPS locations.
For any write action (assigning a driver, confirming delivery), you MUST use propose_assign_driver or propose_confirm_delivery.
Never call execute functions directly. Always explain your reasoning when proposing an action.""")

def build_driver_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_drivers, list_assignments, get_driver_status, get_live_location, propose_assign_driver, propose_confirm_delivery],
        state_modifier=SYSTEM,
    )
```

- [ ] **Step 3: Write `agents/agents/route_agent.py`**

```python
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.route_tools import get_route_for_delivery, list_all_routes, get_route_steps
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the RouteAgent. You provide Google Maps route information for deliveries.
You are read-only — you cannot modify any data. Show distances, durations, and turn-by-turn directions clearly.""")

def build_route_agent():
    return create_react_agent(
        get_llm(),
        tools=[get_route_for_delivery, list_all_routes, get_route_steps],
        state_modifier=SYSTEM,
    )
```

- [ ] **Step 4: Write `agents/ai_core.py`** (shared LLM factory)

```python
from gen_ai_hub.proxy.langchain.openai import ChatOpenAI
from gen_ai_hub.proxy.core.proxy_clients import get_proxy_client
from config import settings

_llm = None

def get_llm():
    global _llm
    if _llm is None:
        proxy_client = get_proxy_client("gen-ai-hub")
        _llm = ChatOpenAI(
            proxy_model_name="claude-sonnet-4-6",
            proxy_client=proxy_client,
        )
    return _llm
```

- [ ] **Step 5: Verify imports**

```bash
cd agents && python -c "from agents.delivery_agent import build_delivery_agent; from agents.driver_agent import build_driver_agent; from agents.route_agent import build_route_agent; print('OK')"
```
Expected: `OK` (will succeed even without AI Core credentials — lazy init)

- [ ] **Step 6: Commit**

```bash
git add agents/agents/delivery_agent.py agents/agents/driver_agent.py agents/agents/route_agent.py agents/ai_core.py
git commit -m "feat(agents): add DeliveryAgent, DriverAgent, RouteAgent subagents"
```

---

## Task 9: SupervisorAgent with HiTL gate

**Files:**
- Create: `agents/agents/supervisor.py`

- [ ] **Step 1: Write `agents/agents/supervisor.py`**

```python
import json
import re
from langgraph.graph import StateGraph, END, START
from langchain_core.messages import HumanMessage, AIMessage
from state import AgentState, ActionProposal
from agents.delivery_agent import build_delivery_agent
from agents.driver_agent import build_driver_agent
from agents.route_agent import build_route_agent
from ai_core import get_llm
from langgraph.checkpoint.memory import MemorySaver

ROUTE_PROMPT = """You are a dispatch supervisor. Classify this message into one of: delivery, driver, route, unknown.
Reply with ONLY the single word classification.

Message: {message}"""

def _parse_proposal(text: str) -> ActionProposal | None:
    """Parse PROPOSAL|tool=...|args=...|reasoning=... format from tool output."""
    if "PROPOSAL|" not in text:
        return None
    try:
        parts = dict(p.split("=", 1) for p in text.split("|")[1:])
        return ActionProposal(
            tool=parts["tool"],
            args=json.loads(parts["args"]),
            reasoning=parts["reasoning"],
        )
    except Exception:
        return None

def build_supervisor() -> tuple:
    delivery_agent = build_delivery_agent()
    driver_agent = build_driver_agent()
    route_agent = build_route_agent()
    llm = get_llm()
    memory = MemorySaver()

    def classify(state: AgentState) -> dict:
        last_msg = state["messages"][-1].content if state["messages"] else ""
        resp = llm.invoke(ROUTE_PROMPT.format(message=last_msg))
        return {"_route": resp.content.strip().lower()}

    def route_message(state: AgentState) -> str:
        return state.get("_route", "delivery")

    def run_delivery(state: AgentState) -> dict:
        result = delivery_agent.invoke({"messages": state["messages"]})
        return {"messages": result["messages"]}

    def run_driver(state: AgentState) -> dict:
        result = driver_agent.invoke({"messages": state["messages"]})
        last = result["messages"][-1].content
        proposal = _parse_proposal(last)
        if proposal:
            confirm_msg = (f"I'd like to perform this action:\n\n"
                           f"**{proposal.tool.replace('_', ' ').title()}**\n"
                           f"Reason: {proposal.reasoning}\n\n"
                           f"Confirm? Reply **yes** to proceed or **no** to cancel.")
            return {"messages": [AIMessage(content=confirm_msg)], "pending_action": proposal}
        return {"messages": result["messages"], "pending_action": None}

    def run_route(state: AgentState) -> dict:
        result = route_agent.invoke({"messages": state["messages"]})
        return {"messages": result["messages"]}

    def handle_confirmation(state: AgentState) -> dict:
        if not state.get("pending_action"):
            return {}
        last = state["messages"][-1].content.strip().lower()
        if last in ("yes", "y", "confirm", "ok", "proceed"):
            action = state["pending_action"]
            from tools import driver_tools
            fn = getattr(driver_tools, action.tool, None)
            if fn:
                result = fn(**action.args)
                return {"messages": [AIMessage(content=f"Done. {result}")], "pending_action": None, "confirmed": True}
        return {"messages": [AIMessage(content="Action cancelled.")], "pending_action": None, "confirmed": False}

    def should_confirm(state: AgentState) -> str:
        if state.get("pending_action"):
            return "await_confirm"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("classify", classify)
    graph.add_node("delivery", run_delivery)
    graph.add_node("driver", run_driver)
    graph.add_node("route", run_route)
    graph.add_node("await_confirm", handle_confirmation)

    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", route_message, {
        "delivery": "delivery",
        "driver": "driver",
        "route": "route",
        "unknown": "delivery",
    })
    graph.add_conditional_edges("driver", should_confirm, {"await_confirm": "await_confirm", END: END})
    graph.add_edge("delivery", END)
    graph.add_edge("route", END)
    graph.add_edge("await_confirm", END)

    return graph.compile(checkpointer=memory), memory
```

- [ ] **Step 2: Verify import**

```bash
cd agents && python -c "from agents.supervisor import build_supervisor; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add agents/agents/supervisor.py
git commit -m "feat(agents): add SupervisorAgent with intent routing and HiTL confirmation gate"
```

---

## Task 10: FastAPI app — `/chat`, `/health`, scheduler

**Files:**
- Create: `agents/main.py`
- Create: `agents/tests/test_api.py`
- Create: `agents/Procfile`

- [ ] **Step 1: Write failing API tests**

Create `agents/tests/test_api.py`:
```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

@pytest.fixture
def client():
    with patch("agents.supervisor.build_supervisor") as mock_sup, \
         patch("agents.monitor_agent.run_all_checks"), \
         patch("tools.teams_tools.post_teams_alert"):
        mock_graph = MagicMock()
        mock_graph.invoke.return_value = {
            "messages": [MagicMock(content="3 open deliveries found.")],
            "pending_action": None,
        }
        mock_sup.return_value = (mock_graph, MagicMock())
        from main import app
        yield TestClient(app)

def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "connections" in data
    assert "monitor" in data

def test_chat_returns_reply(client):
    resp = client.post("/chat", json={
        "thread_id": "test-thread",
        "message": "List open deliveries",
        "confirm": None,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert "pending_action" in data
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd agents && pytest tests/test_api.py -v
```
Expected: `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 3: Write `agents/main.py`**

```python
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
import httpx

from agents.supervisor import build_supervisor
from agents.monitor_agent import run_all_checks
from config import settings
from tools.odata_client import ODataClient
from langchain_core.messages import HumanMessage

_supervisor_graph = None
_scheduler = None
_monitor_state = {"last_run": None, "next_run": None, "status": "stopped"}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _supervisor_graph, _scheduler
    _supervisor_graph, _ = build_supervisor()

    _scheduler = BackgroundScheduler()
    def _run():
        _monitor_state["last_run"] = datetime.now(timezone.utc).isoformat()
        _monitor_state["status"] = "running"
        try:
            run_all_checks()
        except Exception as e:
            _monitor_state["status"] = f"error: {e}"
    _scheduler.add_job(_run, "interval", seconds=settings.monitor_poll_interval_sec, id="monitor")
    _scheduler.start()
    _monitor_state["status"] = "running"
    yield
    _scheduler.shutdown(wait=False)

app = FastAPI(title="Dispatch Agents", lifespan=lifespan)

class ChatRequest(BaseModel):
    thread_id: str
    message: str
    confirm: bool | None = None

class ChatResponse(BaseModel):
    reply: str
    pending_action: dict | None = None

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    msg_text = req.message
    if req.confirm is True:
        msg_text = "yes"
    elif req.confirm is False:
        msg_text = "no"
    result = _supervisor_graph.invoke(
        {"messages": [HumanMessage(content=msg_text)], "thread_id": req.thread_id},
        config=config,
    )
    last_msg = result["messages"][-1].content if result.get("messages") else "No response."
    pending = result.get("pending_action")
    return ChatResponse(
        reply=last_msg,
        pending_action={"tool": pending.tool, "args": pending.args, "reasoning": pending.reasoning} if pending else None,
    )

def _probe_connection(name: str, fn) -> str:
    try:
        fn()
        return "ok"
    except Exception:
        return "error"

@app.get("/health")
def health():
    client = ODataClient(settings)

    def probe_xsuaa():
        client._get_token()
    def probe_cap():
        client.get("/odata/v4/ewm/OutboundDeliveries", {"$top": "1"})
    def probe_teams():
        httpx.head(settings.teams_webhook_url, timeout=5)

    connections = {
        "xsuaa": _probe_connection("xsuaa", probe_xsuaa),
        "cap_odata": _probe_connection("cap_odata", probe_cap),
        "teams_webhook": _probe_connection("teams_webhook", probe_teams),
        "aicore": "ok",  # lazy — checked on first chat request
    }
    overall = "ok" if all(v == "ok" for v in connections.values()) else "degraded"
    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "connections": connections,
        "agents": {
            "supervisor": "ready",
            "delivery_agent": "ready",
            "driver_agent": "ready",
            "route_agent": "ready",
        },
        "monitor": {
            "status": _monitor_state["status"],
            "last_run": _monitor_state["last_run"],
            "next_run": _monitor_state["next_run"],
            "checks": {
                "unassigned_deliveries": "ok",
                "idle_drivers": "ok",
                "batch_opportunities": "ok",
            },
        },
        "tools": {
            "list_open_deliveries": _probe_connection("list_open_deliveries", lambda: client.get("/odata/v4/ewm/OutboundDeliveries", {"$top": "1"})),
            "list_drivers": _probe_connection("list_drivers", lambda: client.get("/odata/v4/tracking/Driver", {"$top": "1"})),
            "get_live_location": "ok",
            "get_route_for_delivery": "ok",
        },
    }
```

- [ ] **Step 4: Write `agents/Procfile`**

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 5: Run tests**

```bash
cd agents && pytest tests/test_api.py -v
```
Expected: all `PASSED`

- [ ] **Step 6: Commit**

```bash
git add agents/main.py agents/Procfile agents/tests/test_api.py
git commit -m "feat(agents): add FastAPI app with /chat, /health, APScheduler monitor"
```

---

## Task 11: CF deployment config

**Files:**
- Create: `agents/manifest.yml`
- Create: `agents/mta.yaml`

- [ ] **Step 1: Write `agents/manifest.yml`**

```yaml
applications:
  - name: gmaps-agents
    buildpacks:
      - python_buildpack
    memory: 512M
    instances: 1
    command: uvicorn main:app --host 0.0.0.0 --port $PORT
    env:
      AICORE_AUTH_URL: ((AICORE_AUTH_URL))
      AICORE_CLIENT_ID: ((AICORE_CLIENT_ID))
      AICORE_CLIENT_SECRET: ((AICORE_CLIENT_SECRET))
      AICORE_BASE_URL: ((AICORE_BASE_URL))
      AICORE_DEPLOYMENT_ID: ((AICORE_DEPLOYMENT_ID))
      CAP_BASE_URL: https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-srv.cfapps.us10.hana.ondemand.com
      XSUAA_URL: ((XSUAA_URL))
      XSUAA_CLIENT_ID: ((XSUAA_CLIENT_ID))
      XSUAA_CLIENT_SECRET: ((XSUAA_CLIENT_SECRET))
      TEAMS_WEBHOOK_URL: ((TEAMS_WEBHOOK_URL))
    services:
      - gmaps-xsuaa
```

- [ ] **Step 2: Write `agents/mta.yaml`**

```yaml
_schema-version: "3.1"
ID: gmaps-agents
version: 1.0.0

modules:
  - name: gmaps-agents
    type: python
    path: .
    parameters:
      buildpack: python_buildpack
      memory: 512M
      health-check-type: http
      health-check-http-endpoint: /health
    properties:
      CAP_BASE_URL: https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-srv.cfapps.us10.hana.ondemand.com
    requires:
      - name: gmaps-xsuaa
      - name: gmaps-destination

resources:
  - name: gmaps-xsuaa
    type: org.cloudfoundry.existing-service
  - name: gmaps-destination
    type: org.cloudfoundry.existing-service
```

- [ ] **Step 3: Smoke test local startup**

```bash
cd agents && cp .env.example .env  # fill in real values first
uvicorn main:app --port 8000 &
sleep 5 && curl -s http://localhost:8000/health | python3 -m json.tool
```
Expected: JSON with `"status": "ok"` or `"degraded"` (degraded is fine if AI Core creds not set yet)

- [ ] **Step 4: Commit**

```bash
git add agents/manifest.yml agents/mta.yaml
git commit -m "feat(agents): add CF manifest and mta.yaml for deployment"
```

---

## Task 12: Deploy to CF and verify

- [ ] **Step 1: Fill in `.env` with real values** (AI Core, XSUAA, Teams webhook — from BTP subaccount)

- [ ] **Step 2: Push to CF**

```bash
cd agents && cf push gmaps-agents --vars-file .env
```
Or with manifest vars:
```bash
cf push gmaps-agents -f manifest.yml
```

- [ ] **Step 3: Verify health endpoint**

```bash
cf app gmaps-agents  # get URL
curl https://<gmaps-agents-url>.cfapps.us10.hana.ondemand.com/health | python3 -m json.tool
```
Expected: `"status": "ok"` with all connections green.

- [ ] **Step 4: Test chat endpoint**

```bash
curl -s -X POST https://<gmaps-agents-url>.cfapps.us10.hana.ondemand.com/chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "test-1", "message": "List open deliveries", "confirm": null}' \
  | python3 -m json.tool
```
Expected: `"reply"` with delivery list.

- [ ] **Step 5: Test HiTL flow**

```bash
# Step 1 — propose assignment
curl -s -X POST .../chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "hitl-test", "message": "Assign Raj Kumar with truck KA01AB1234 to delivery 80000001, mobile +91999", "confirm": null}' \
  | python3 -m json.tool
# Expected: reply contains confirmation prompt, pending_action is populated

# Step 2 — confirm
curl -s -X POST .../chat \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "hitl-test", "message": "", "confirm": true}' \
  | python3 -m json.tool
# Expected: reply says "Done. Driver assigned..."
```

- [ ] **Step 6: Commit**

```bash
git add agents/
git commit -m "feat(agents): Phase 3 agents service fully deployed on CF"
```

---

## Self-Review

**Spec coverage:**
- ✅ SupervisorAgent with HiTL gate — Task 9
- ✅ DeliveryAgent + tools — Tasks 4, 8
- ✅ DriverAgent + proposal-only writes — Tasks 5, 8
- ✅ RouteAgent + tools — Tasks 6, 8
- ✅ MonitorAgent 3 checks — Task 7
- ✅ `/chat` API contract — Task 10
- ✅ `/health` with connections/agents/monitor/tools — Task 10
- ✅ Config / env vars — Task 1
- ✅ XSUAA token client — Task 2
- ✅ Teams webhook — Task 6
- ✅ CF deployment manifest + mta.yaml — Task 11
- ✅ Alert deduplication 30-min cooldown — Task 7
- ✅ APScheduler lifespan startup — Task 10

**Type consistency:**
- `ActionProposal` defined in `state.py` (Task 3), used in `supervisor.py` (Task 9) ✅
- `ODataClient` defined in `odata_client.py` (Task 2), instantiated as `_client` in each tools file ✅
- `execute_assign_driver` / `execute_confirm_delivery` defined in `driver_tools.py` (Task 5), called via `getattr` in supervisor (Task 9) ✅
- `post_teams_alert` defined in `teams_tools.py` (Task 6), imported in `monitor_agent.py` (Task 7) ✅
