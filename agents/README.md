# Dispatch Agents — LangGraph Multi-Agent System

> **Phase 2** (`feature_ph2_lg_agents`) — LangGraph supervisor + 3 ReAct subagents with 18 tools, LangSmith Studio, SAP AI Core Claude. See [root README](../README.md) for all phases.

A Python FastAPI service that lets dispatchers manage EWM deliveries, driver assignments, and Google Maps routes via natural language. Built on LangGraph with SAP AI Core (Claude) as the LLM.

## Quick Start

```bash
# Create and activate venv
python3 -m venv .venv-studio
source .venv-studio/bin/activate

# Install deps
pip install -r requirements.txt
pip install "langgraph-cli[inmem]"

# Set up environment
cp .env.example .env   # fill in your credentials

# Run in LangSmith Studio (development)
PYTHONPATH=. langgraph dev --host 127.0.0.1 --port 2024

# Run as FastAPI server (production-like)
PYTHONPATH=. uvicorn main:app --reload
```

## Architecture

```
User message → Supervisor (classify intent)
                   ├── DeliveryAgent  (read-only, EWM deliveries)
                   ├── DriverAgent    (read+write, assignments & GPS, HiTL gate)
                   └── RouteAgent     (read-only, Google Maps routes)

Background:  MonitorAgent (APScheduler, Teams alerts every 5 min)
```

### Supervisor

Entry point for all messages. Classifies intent via LLM into `delivery`, `driver`, or `route`, then dispatches to the matching subagent. Exports a single compiled `graph` variable consumed by both LangSmith Studio and FastAPI.

### DeliveryAgent (read-only)

ReAct agent with 4 tools for EWM outbound deliveries:

| Tool | Description |
|------|-------------|
| `list_open_deliveries()` | All open deliveries |
| `list_unassigned_deliveries()` | Deliveries with no driver assigned |
| `get_delivery_items(delivery_doc)` | Line items for a delivery |
| `get_delivery_route(delivery_doc)` | Google Maps route for a delivery |

### DriverAgent (read + write, with Human-in-the-Loop)

ReAct agent with 6 tools. Write tools are protected by LangGraph's native `interrupt_before` — the graph pauses before any tool execution, requiring human confirmation to proceed.

| Tool | Type | Description |
|------|------|-------------|
| `list_drivers()` | read | All registered drivers |
| `list_assignments()` | read | Active assignments with UUIDs |
| `get_driver_status(id)` | read | Full status of one assignment |
| `get_live_location(id)` | read | Latest GPS coordinates |
| `assign_driver(...)` | write | Assign driver to delivery (pauses for confirmation) |
| `confirm_delivery(id)` | write | Mark delivery completed (pauses for confirmation) |

### RouteAgent (read-only)

ReAct agent with 3 tools for Google Maps route data:

| Tool | Description |
|------|-------------|
| `get_route_for_delivery(delivery_doc)` | Route directions for a delivery |
| `list_all_routes()` | All stored routes with UUIDs |
| `get_route_steps(route_id)` | Turn-by-turn directions |

### MonitorAgent (background)

Not chat-facing. Runs every `MONITOR_POLL_INTERVAL_SEC` seconds via APScheduler. Posts alerts to Teams webhook with 30-min deduplication cooldown.

| Check | Condition | Alert |
|-------|-----------|-------|
| Unassigned deliveries | No driver for >30 min | Teams message |
| Idle drivers | Assigned but no GPS for >20 min | Teams message |
| Batch opportunities | 2+ deliveries to same zone | Teams message |

## Human-in-the-Loop (HiTL)

Write actions use LangGraph's native `interrupt_before=["tools"]`:

1. LLM decides to call `assign_driver` or `confirm_delivery`
2. Graph **pauses** before the tool executes
3. **LangSmith Studio**: shows "Resume" button with tool args
4. **FastAPI `/chat`**: returns `pending_action` → frontend shows Yes/No
5. On confirmation: `Command(resume=True)` unfreezes the graph
6. Tool executes the OData call

## Project Structure

```
agents/
  main.py                    FastAPI app (/chat, /health, web UI, APScheduler)
  agents/
    supervisor.py            Supervisor graph (classify → route → subagent)
    delivery_agent.py        DeliveryAgent (create_react_agent)
    driver_agent.py          DriverAgent (create_react_agent + interrupt_before)
    route_agent.py           RouteAgent (create_react_agent)
    monitor_agent.py         MonitorAgent (background checks + Teams alerts)
  tools/
    delivery_tools.py        EWM delivery OData tools
    driver_tools.py          Driver assignment + GPS OData tools
    route_tools.py           Google Maps route OData tools
    teams_tools.py           Teams webhook poster
    odata_client.py          Shared authenticated OData HTTP client
  state.py                   AgentState (messages only)
  ai_core.py                 SAP AI Core Claude chat model wrapper
  config.py                  Environment variable loading
  langgraph.json             LangGraph Studio config
  requirements.txt           Python dependencies
  .env                       Local dev credentials (git-ignored)
```

## Entry Points

| Consumer | How it loads the graph |
|----------|----------------------|
| **LangSmith Studio** | `langgraph.json` → `./agents/supervisor.py:graph` (Studio provides checkpointer) |
| **FastAPI `/chat`** | `main.py` imports `graph`, copies it, attaches `MemorySaver` |

Both use the same compiled StateGraph. No duplicate definitions.

## Data Flow

```
Agent → Tool → ODataClient → XSUAA token → CAP OData V4 → HANA/SQLite
                                              (BTP Cloud Foundry)

LLM: SAP AI Core → Claude (Bedrock-invoke endpoint)
```

## Environment Variables

```env
# AI Core (SAP BTP)
AICORE_AUTH_URL=https://<subaccount>.authentication.us10.hana.ondemand.com/oauth/token
AICORE_CLIENT_ID=
AICORE_CLIENT_SECRET=
AICORE_BASE_URL=https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com
AICORE_DEPLOYMENT_ID=          # Claude deployment ID

# CAP OData base URL
CAP_BASE_URL=https://<gmaps-app-srv>.cfapps.us10.hana.ondemand.com

# XSUAA credentials (client credentials grant)
XSUAA_URL=
XSUAA_CLIENT_ID=
XSUAA_CLIENT_SECRET=

# Teams webhook
TEAMS_WEBHOOK_URL=

# LangSmith tracing
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=gmaps-dispatch-agents

# Monitor tuning
MONITOR_POLL_INTERVAL_SEC=300
UNASSIGNED_THRESHOLD_MIN=30
IDLE_THRESHOLD_MIN=20
```

## API Endpoints

### `POST /chat`

```json
// Request
{"thread_id": "session-1", "message": "list open deliveries", "confirm": null}

// Response
{"reply": "3 open deliveries: ...", "pending_action": null}

// When interrupted (write action pending)
{"reply": "I'll assign driver John...", "pending_action": {"tool": "assign_driver", "description": "Awaiting human confirmation"}}
```

### `GET /health`

Returns connection status for XSUAA, CAP OData, Teams webhook, AI Core, plus agent and monitor status.

### `GET /`

Built-in web chat UI with confirmation buttons for HiTL actions.

## Testing

```bash
PYTHONPATH=. .venv-studio/bin/python -m pytest tests/ -v
```

## Deployment

BTP Cloud Foundry via `cf push` or MTA build. See `manifest.yml` for standalone deploy config.
