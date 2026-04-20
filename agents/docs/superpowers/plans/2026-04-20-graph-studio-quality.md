# Graph & Studio Quality Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LangGraph supervisor graph clean, Studio-native, and single-entry-point — with native HiTL interrupts and improved tool descriptions.

**Architecture:** Simplify `AgentState` to messages-only, replace the custom PROPOSAL string-parsing HiTL with LangGraph's `interrupt_before` on the driver subagent, unify the graph entry point so both Studio and FastAPI consume the same compiled graph, and improve tool docstrings so the LLM passes valid IDs.

**Tech Stack:** langgraph 1.1.8, langgraph-prebuilt 1.0.10, langchain-core 1.3.0, FastAPI, SAP AI Core (Claude via custom BaseChatModel)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `state.py` | Rewrite | Simplified `AgentState` — messages only |
| `tools/driver_tools.py` | Rewrite | Replace proposal tools with real tools; add write-tool marker |
| `tools/delivery_tools.py` | Modify | Improve tool docstrings |
| `tools/route_tools.py` | Modify | Improve tool docstrings |
| `agents/driver_agent.py` | Rewrite | Use `interrupt_before=["tools"]` on create_react_agent |
| `agents/supervisor.py` | Rewrite | Remove HiTL nodes, export single `graph` variable |
| `main.py` | Modify | Import `graph` from supervisor, wrap with MemorySaver, detect interrupts |
| `tests/test_graph_structure.py` | Create | Verify graph nodes, edges, interrupt config |
| `tests/test_tools.py` | Create | Verify tool descriptions contain guidance |

---

### Task 1: Simplify State Schema

**Files:**
- Rewrite: `state.py`
- Create: `tests/test_graph_structure.py`

- [ ] **Step 1: Write failing test for new state schema**

Create `tests/test_graph_structure.py`:

```python
from state import AgentState
from typing import get_type_hints


def test_agent_state_has_messages_only():
    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    assert "pending_action" not in hints
    assert "confirmed" not in hints
    assert "_route" not in hints
    assert "thread_id" not in hints
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py::test_agent_state_has_messages_only -v`

Expected: FAIL — `pending_action`, `confirmed`, `_route`, `thread_id` are still in `AgentState`

- [ ] **Step 3: Rewrite state.py**

Replace `state.py` with:

```python
from typing import Annotated
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py::test_agent_state_has_messages_only -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add state.py tests/test_graph_structure.py
git commit -m "refactor(state): simplify AgentState to messages-only"
```

---

### Task 2: Replace Proposal Tools with Real Tools in driver_tools.py

**Files:**
- Rewrite: `tools/driver_tools.py`
- Create: `tests/test_tools.py`

- [ ] **Step 1: Write failing test for new tool names and descriptions**

Create `tests/test_tools.py`:

```python
from tools.driver_tools import (
    list_drivers,
    list_assignments,
    get_driver_status,
    get_live_location,
    assign_driver,
    confirm_delivery,
)


def test_assign_driver_is_a_real_tool():
    assert assign_driver.name == "assign_driver"
    assert "assign" in assign_driver.description.lower()


def test_confirm_delivery_is_a_real_tool():
    assert confirm_delivery.name == "confirm_delivery"
    assert "confirm" in confirm_delivery.description.lower()


def test_proposal_tools_removed():
    import tools.driver_tools as mod
    assert not hasattr(mod, "propose_assign_driver")
    assert not hasattr(mod, "propose_confirm_delivery")
    assert not hasattr(mod, "execute_assign_driver")
    assert not hasattr(mod, "execute_confirm_delivery")


def test_driver_tools_have_guidance():
    assert "list_assignments" in get_driver_status.description.lower() or "UUID" in get_driver_status.description
    assert "list_assignments" in get_live_location.description.lower() or "UUID" in get_live_location.description
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_tools.py -v`

Expected: FAIL — `assign_driver` and `confirm_delivery` don't exist yet, proposal tools still present

- [ ] **Step 3: Rewrite tools/driver_tools.py**

Replace `tools/driver_tools.py` with:

```python
from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings


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
    """List all active driver assignments. Returns assignment IDs (UUIDs) needed by other tools."""
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status ne 'DELIVERED'", "$top": "50"})
    assignments = data.get("value", [])
    if not assignments:
        return "No active assignments."
    lines = [f"- ID: {a.get('ID','?')} | {a.get('DriverName','?')} | Delivery: {a.get('DeliveryDocument','?')} | Status: {a.get('Status','?')} | Truck: {a.get('TruckRegistration','?')}" for a in assignments]
    return f"{len(assignments)} active assignments:\n" + "\n".join(lines)


@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment. Pass the assignment UUID from list_assignments()."""
    data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    return (f"Driver: {data.get('DriverName','?')} | Status: {data.get('Status','?')} | "
            f"Delivery: {data.get('DeliveryDocument','?')} | Truck: {data.get('TruckRegistration','?')} | "
            f"Assigned: {data.get('AssignedAt','?')}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment. Pass the assignment UUID from list_assignments()."""
    data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    return (f"Last GPS: Lat {data.get('Latitude','?')}, Lng {data.get('Longitude','?')} | "
            f"Speed: {data.get('Speed','?')} m/s | Updated: {data.get('LastGpsAt','?')}")


@tool
def assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Assign a driver to a delivery. This is a write action — the graph will pause for human confirmation before executing."""
    data = _client.post("/odata/v4/tracking/assignDriver", {
        "deliveryDoc": delivery_doc,
        "mobileNumber": mobile_number,
        "truckRegistration": truck_registration,
        "driverName": driver_name,
    })
    return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID','?')}"


@tool
def confirm_delivery(assignment_id: str) -> str:
    """Confirm a delivery as completed. This is a write action — the graph will pause for human confirmation before executing."""
    _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
    return f"Delivery confirmed for assignment {assignment_id}."
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_tools.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/driver_tools.py tests/test_tools.py
git commit -m "refactor(tools): replace proposal tools with real tools for native HiTL"
```

---

### Task 3: Improve Tool Descriptions in delivery_tools.py and route_tools.py

**Files:**
- Modify: `tools/delivery_tools.py`
- Modify: `tools/route_tools.py`
- Modify: `tests/test_tools.py`

- [ ] **Step 1: Add failing tests for improved descriptions**

Append to `tests/test_tools.py`:

```python
from tools.delivery_tools import get_delivery_items, get_delivery_route
from tools.route_tools import get_route_steps, get_route_for_delivery


def test_delivery_tools_have_guidance():
    assert "list_open_deliveries" in get_delivery_items.description.lower() or "DeliveryDocument" in get_delivery_items.description


def test_route_tools_have_guidance():
    assert "list_all_routes" in get_route_steps.description.lower() or "UUID" in get_route_steps.description
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_tools.py::test_delivery_tools_have_guidance tests/test_tools.py::test_route_tools_have_guidance -v`

Expected: FAIL — current descriptions don't reference prerequisite tools

- [ ] **Step 3: Update delivery_tools.py docstrings**

In `tools/delivery_tools.py`, update the two tool docstrings:

Change `get_delivery_items`:
```python
@tool
def get_delivery_items(delivery_doc: str) -> str:
    """Get line items for a specific delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
```

Change `get_delivery_route`:
```python
@tool
def get_delivery_route(delivery_doc: str) -> str:
    """Fetch Google Maps route for a delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
```

- [ ] **Step 4: Update route_tools.py docstrings**

In `tools/route_tools.py`, update:

Change `get_route_for_delivery`:
```python
@tool
def get_route_for_delivery(delivery_doc: str) -> str:
    """Fetch Google Maps route directions for a delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
```

Change `get_route_steps`:
```python
@tool
def get_route_steps(route_id: str) -> str:
    """Get turn-by-turn directions for a route. Pass a route UUID from list_all_routes()."""
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_tools.py -v`

Expected: PASS (all tests including Task 2 tests)

- [ ] **Step 6: Commit**

```bash
git add tools/delivery_tools.py tools/route_tools.py tests/test_tools.py
git commit -m "docs(tools): improve tool descriptions with prerequisite guidance"
```

---

### Task 4: Add interrupt_before to Driver Agent

**Files:**
- Rewrite: `agents/driver_agent.py`
- Modify: `tests/test_graph_structure.py`

- [ ] **Step 1: Write failing test for driver agent interrupt config**

Append to `tests/test_graph_structure.py`:

```python
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

from unittest.mock import patch, MagicMock


def _make_fake_llm():
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatResult, ChatGeneration

    class FakeLLM(BaseChatModel):
        @property
        def _llm_type(self):
            return "fake"

        def _generate(self, messages, **kwargs):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="hi"))])

        def bind_tools(self, tools, **kwargs):
            return self

    return FakeLLM()


@patch("agents.driver_agent.get_llm")
def test_driver_agent_has_interrupt_before_tools(mock_get_llm):
    mock_get_llm.return_value = _make_fake_llm()
    from agents.driver_agent import build_driver_agent
    agent = build_driver_agent()
    assert "tools" in list(agent.nodes.keys()), "Driver agent must have a 'tools' node"
    assert agent.interrupt_before_nodes == ["tools"], (
        f"Driver agent must interrupt before 'tools', got {agent.interrupt_before_nodes}"
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py::test_driver_agent_has_interrupt_before_tools -v`

Expected: FAIL — current driver agent doesn't use interrupt_before

- [ ] **Step 3: Rewrite agents/driver_agent.py**

Replace `agents/driver_agent.py` with:

```python
import warnings
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.driver_tools import (
    list_drivers, list_assignments, get_driver_status,
    get_live_location, assign_driver, confirm_delivery,
)
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DriverAgent. You manage driver assignments and track GPS locations.
You can assign drivers and confirm deliveries — these write actions will be paused for human confirmation before executing.
Always explain your reasoning when proposing a write action.""")

warnings.filterwarnings("ignore", category=DeprecationWarning)


def build_driver_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_drivers, list_assignments, get_driver_status, get_live_location, assign_driver, confirm_delivery],
        prompt=SYSTEM,
        interrupt_before=["tools"],
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py::test_driver_agent_has_interrupt_before_tools -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/driver_agent.py tests/test_graph_structure.py
git commit -m "feat(driver): add interrupt_before for native HiTL in Studio"
```

---

### Task 5: Rewrite Supervisor — Single Entry Point, No Custom HiTL

**Files:**
- Rewrite: `agents/supervisor.py`
- Modify: `tests/test_graph_structure.py`

- [ ] **Step 1: Write failing tests for new supervisor structure**

Append to `tests/test_graph_structure.py`:

```python
@patch("agents.driver_agent.get_llm")
@patch("agents.delivery_agent.get_llm")
@patch("agents.route_agent.get_llm")
@patch("agents.supervisor.get_llm")
def test_supervisor_graph_nodes(mock_sup_llm, mock_route_llm, mock_del_llm, mock_drv_llm):
    fake = _make_fake_llm()
    mock_sup_llm.return_value = fake
    mock_route_llm.return_value = fake
    mock_del_llm.return_value = fake
    mock_drv_llm.return_value = fake

    import importlib
    import agents.supervisor as sup_mod
    importlib.reload(sup_mod)
    graph = sup_mod.graph

    node_names = list(graph.nodes.keys())
    assert "classify" in node_names
    assert "delivery" in node_names
    assert "driver" in node_names
    assert "route" in node_names
    assert "await_confirm" not in node_names, "await_confirm should be removed"


@patch("agents.driver_agent.get_llm")
@patch("agents.delivery_agent.get_llm")
@patch("agents.route_agent.get_llm")
@patch("agents.supervisor.get_llm")
def test_supervisor_graph_is_compiled(mock_sup_llm, mock_route_llm, mock_del_llm, mock_drv_llm):
    fake = _make_fake_llm()
    mock_sup_llm.return_value = fake
    mock_route_llm.return_value = fake
    mock_del_llm.return_value = fake
    mock_drv_llm.return_value = fake

    import importlib
    import agents.supervisor as sup_mod
    importlib.reload(sup_mod)

    from langgraph.graph.state import CompiledStateGraph
    assert isinstance(sup_mod.graph, CompiledStateGraph)


def test_supervisor_has_no_build_function():
    import agents.supervisor as sup_mod
    assert not hasattr(sup_mod, "build_supervisor"), "build_supervisor() should be removed"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py::test_supervisor_graph_nodes tests/test_graph_structure.py::test_supervisor_graph_is_compiled tests/test_graph_structure.py::test_supervisor_has_no_build_function -v`

Expected: FAIL — `await_confirm` still present, `build_supervisor` still exists

- [ ] **Step 3: Rewrite agents/supervisor.py**

Replace `agents/supervisor.py` with:

```python
import warnings
from langgraph.graph import StateGraph, END, START
from state import AgentState
from agents.delivery_agent import build_delivery_agent
from agents.driver_agent import build_driver_agent
from agents.route_agent import build_route_agent
from ai_core import get_llm

warnings.filterwarnings("ignore", category=DeprecationWarning)

ROUTE_PROMPT = """You are a dispatch supervisor. Classify this message into one of: delivery, driver, route, unknown.
Reply with ONLY the single word classification.

Message: {message}"""

_delivery_agent = build_delivery_agent()
_driver_agent = build_driver_agent()
_route_agent = build_route_agent()
_llm = get_llm()


def classify(state: AgentState) -> dict:
    last_msg = state["messages"][-1].content if state["messages"] else ""
    resp = _llm.invoke(ROUTE_PROMPT.format(message=last_msg))
    return {"messages": [resp]}


def route_message(state: AgentState) -> str:
    last = state["messages"][-1].content.strip().lower() if state["messages"] else ""
    if last in ("delivery", "driver", "route"):
        return last
    return "delivery"


def run_delivery(state: AgentState) -> dict:
    result = _delivery_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


def run_driver(state: AgentState) -> dict:
    result = _driver_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


def run_route(state: AgentState) -> dict:
    result = _route_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


_builder = StateGraph(AgentState)
_builder.add_node("classify", classify)
_builder.add_node("delivery", run_delivery)
_builder.add_node("driver", run_driver)
_builder.add_node("route", run_route)

_builder.add_edge(START, "classify")
_builder.add_conditional_edges("classify", route_message, {
    "delivery": "delivery",
    "driver": "driver",
    "route": "route",
})
_builder.add_edge("delivery", END)
_builder.add_edge("driver", END)
_builder.add_edge("route", END)

graph = _builder.compile()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents && PYTHONPATH=. .venv-studio/bin/python -m pytest tests/test_graph_structure.py -v`

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add agents/supervisor.py tests/test_graph_structure.py
git commit -m "refactor(supervisor): single graph entry point, remove custom HiTL"
```

---

### Task 6: Update main.py to Use Single Graph + Detect Interrupts

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Update main.py imports and graph usage**

Replace the graph-related sections of `main.py`. The key changes:

1. Import `graph` from `agents.supervisor` instead of calling `build_supervisor()`
2. Wrap with `MemorySaver` for the FastAPI instance
3. Detect interrupted state via `graph_with_memory.get_state(config).tasks` to check for pending interrupts
4. Resume interrupted graph with `Command(resume=True)` on confirmation

Replace `main.py` with:

```python
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
import httpx

from agents.supervisor import graph
from agents.monitor_agent import run_all_checks
from config import settings
from tools.odata_client import ODataClient
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

_memory = MemorySaver()
_graph = graph.copy()
_graph.checkpointer = _memory

_scheduler = None
_monitor_state = {"last_run": None, "next_run": None, "status": "stopped"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
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


app = FastAPI(title="Dispatch Agents", lifespan=lifespan)


class ChatRequest(BaseModel):
    thread_id: str
    message: str
    confirm: bool | None = None


class ChatResponse(BaseModel):
    reply: str
    pending_action: dict | None = None


CHAT_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Dispatch Agent Chat</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; background: #f5f5f5; }
  h1 { font-size: 1.2rem; color: #333; }
  #log { background: #fff; border: 1px solid #ddd; border-radius: 6px; height: 480px; overflow-y: auto; padding: 12px; margin-bottom: 10px; }
  .msg { margin: 6px 0; }
  .user { color: #0a6; font-weight: bold; }
  .agent { color: #333; }
  .error { color: #c00; }
  .pending { color: #888; font-style: italic; }
  #row { display: flex; gap: 8px; }
  #input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.95rem; }
  button { padding: 8px 16px; background: #0070d2; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: #005fb2; }
  #confirm-row { display: none; gap: 8px; margin-top: 8px; }
  .btn-yes { background: #0a6; }
  .btn-no { background: #c00; }
</style>
</head>
<body>
<h1>Dispatch Agent Chat</h1>
<div id="log"></div>
<div id="row">
  <input id="input" placeholder="Ask something (e.g. 'list open deliveries')" onkeydown="if(event.key==='Enter')send()">
  <button onclick="send()">Send</button>
</div>
<div id="confirm-row">
  <strong>Confirm action?</strong>
  <button class="btn-yes" onclick="confirm_(true)">Yes</button>
  <button class="btn-no" onclick="confirm_(false)">No</button>
</div>
<script>
const log = document.getElementById('log');
const input = document.getElementById('input');
const confirmRow = document.getElementById('confirm-row');
let threadId = 'ui-' + Math.random().toString(36).slice(2);
let pendingAction = null;

function append(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

async function send() {
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  confirmRow.style.display = 'none';
  append('user', 'You: ' + msg);
  append('pending', 'Agent is thinking...');
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({thread_id: threadId, message: msg})
    });
    const data = await res.json();
    log.lastChild.remove();
    append('agent', 'Agent: ' + data.reply);
    if (data.pending_action) {
      pendingAction = data.pending_action;
      confirmRow.style.display = 'flex';
    }
  } catch(e) {
    log.lastChild.remove();
    append('error', 'Error: ' + e.message);
  }
}

async function confirm_(yes) {
  confirmRow.style.display = 'none';
  append('user', yes ? 'You: yes' : 'You: no');
  append('pending', 'Agent is thinking...');
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({thread_id: threadId, message: yes ? 'yes' : 'no', confirm: yes})
    });
    const data = await res.json();
    log.lastChild.remove();
    append('agent', 'Agent: ' + data.reply);
    pendingAction = null;
  } catch(e) {
    log.lastChild.remove();
    append('error', 'Error: ' + e.message);
  }
}
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return CHAT_HTML


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    config = {"configurable": {"thread_id": req.thread_id}}

    # Check if graph is interrupted (awaiting confirmation)
    state = _graph.get_state(config)
    if state.tasks and any(t.interrupts for t in state.tasks):
        if req.confirm is True:
            result = _graph.invoke(Command(resume=True), config=config)
        else:
            result = _graph.invoke(
                {"messages": [HumanMessage(content="Action cancelled by user.")]},
                config=config,
            )
        last_msg = result["messages"][-1].content if result.get("messages") else "No response."
        return ChatResponse(reply=last_msg)

    # Normal message — invoke graph
    result = _graph.invoke(
        {"messages": [HumanMessage(content=req.message)]},
        config=config,
    )

    # Check if graph is now interrupted after invocation
    state = _graph.get_state(config)
    pending = None
    if state.tasks and any(t.interrupts for t in state.tasks):
        for task in state.tasks:
            for intr in task.interrupts:
                pending = {"tool": str(intr.value), "description": "Awaiting human confirmation"}
                break

    last_msg = result["messages"][-1].content if result.get("messages") else "No response."
    return ChatResponse(reply=last_msg, pending_action=pending)


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
        "aicore": "ok",
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

- [ ] **Step 2: Commit**

```bash
git add main.py
git commit -m "refactor(main): use single graph entry point, detect native interrupts"
```

---

### Task 7: Verify in LangSmith Studio

**Files:** None (manual verification)

- [ ] **Step 1: Rebuild .venv-studio and verify graph loads**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
PYTHONPATH=. .venv-studio/bin/python -c "
from agents.supervisor import graph
print('Graph compiled:', type(graph))
print('Nodes:', list(graph.nodes.keys()))
"
```

Expected output:
```
Graph compiled: <class 'langgraph.graph.state.CompiledStateGraph'>
Nodes: ['__start__', 'classify', 'delivery', 'driver', 'route']
```

- [ ] **Step 2: Start langgraph dev**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
pkill -f "langgraph dev" 2>/dev/null
PYTHONPATH=. .venv-studio/bin/langgraph dev --host 127.0.0.1 --port 2024 --no-browser
```

Verify: `curl -s http://127.0.0.1:2024/info` returns valid JSON with no errors.

- [ ] **Step 3: Open LangSmith Studio and verify graph renders**

Navigate to: `https://smith.langchain.com/studio/thread?baseUrl=http://127.0.0.1:2024`

Verify:
- Graph shows: `__start__` → `classify` → conditional edges to `delivery`, `driver`, `route` → `__end__`
- `driver` subgraph shows `agent` → `tools` loop (same as before)
- No `await_confirm` node visible
- "Connected" badge is green

- [ ] **Step 4: Run all tests**

```bash
cd /Users/I310202/Library/CloudStorage/OneDrive-SAPSE/SR@Work/2026/99_Initiatives/922_CAP_GMaps/agents
PYTHONPATH=. .venv-studio/bin/python -m pytest tests/ -v
```

Expected: All tests pass.
