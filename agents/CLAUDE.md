# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

LangGraph multi-agent system for EWM dispatch operations. A supervisor classifies user messages and routes to specialized ReAct subagents (delivery, driver, route), each backed by OData tools against a CAP backend. A background monitor posts alerts to Teams. LLM is Claude via SAP AI Core.

## Commands

```bash
# Local dev — LangGraph Studio (interactive graph UI)
PYTHONPATH=. langgraph dev --host 127.0.0.1 --port 2024

# Local dev — FastAPI server with web chat UI
PYTHONPATH=. uvicorn main:app --reload

# Tests
PYTHONPATH=. python -m pytest tests/ -v

# Deploy to Cloud Foundry
cf push                                    # deploys from manifest.yml
bash cf_set_env.sh && cf restart gmaps-dispatch-agents  # MUST run after every cf push

# Health check (local or CF)
curl http://localhost:8000/health
```

## Architecture

```
UserInput.message → parse_input → classify (LLM) → route_message
                                                      ├── DeliveryAgent (3 read tools)
                                                      ├── DriverAgent (9 tools: 4 read + 5 write)
                                                      └── RouteAgent (4 built-in + Google Maps MCP tools)

Background: MonitorAgent (APScheduler → Teams webhook)
```

### Tool Design

Tools use flexible filter parameters instead of rigid single-purpose variants. The `build_filter()` helper in `odata_client.py` constructs OData `$filter` strings from `exact={}` and `contains={}` dicts. Example: `list_deliveries(status='unassigned', route='TR0002')` generates the appropriate OData filter.

### MCP Integration

RouteAgent loads Google Maps MCP tools (geocode, directions, places, reverse geocode) at startup via `mcp_client.py`. The MCP server (`@modelcontextprotocol/server-google-maps`) runs as a stdio subprocess. If `GOOGLE_MAPS_API_KEY` is missing or the server fails, RouteAgent degrades gracefully to its 4 built-in tools.

**Async requirement**: MCP tools are async-only. The chain `async /chat endpoint → await graph.ainvoke() → async run_route() → await route_agent.ainvoke()` must be fully async.

### Graph Input Schema

The supervisor uses `StateGraph(SupervisorState, input=UserInput)` where `UserInput` only has `message: str`. When invoking the graph programmatically, pass `{"message": "..."}` — NOT `{"messages": [HumanMessage(...)]}`. The `messages` field gets silently dropped if passed directly because it's not in `UserInput`. The `parse_input` node converts `message` → `messages`.

### Classification Pollution

The `classify` node appends an AIMessage (e.g., "delivery") to state. Subagent runner functions filter to only human messages via `_user_messages()` before invoking subagents, so the classification word doesn't confuse them.

### Two Entry Points, Same Graph

- **LangGraph Studio**: loads via `langgraph.json` → `./agents/supervisor.py:graph` (Studio provides its own checkpointer)
- **FastAPI**: `main.py` imports `graph`, copies it, attaches `MemorySaver` for thread-based conversation memory

### OData Auth Flow

All tools → `ODataClient` → XSUAA client_credentials token (cached with 60s buffer) → CAP OData V4 on BTP CF. Token caching is in `odata_client.py`. For M2M auth, scopes come from `authorities` in `xs-security.json`, not role collections.

## CF Deployment

`cf push` reads `manifest.yml` but **overwrites all env vars** — secrets set via `cf set-env` get wiped. Always run `bash cf_set_env.sh && cf restart gmaps-dispatch-agents` after every push. The script sets: `AICORE_*`, `XSUAA_*`, `TEAMS_WEBHOOK_URL`, `LANGCHAIN_API_KEY`, `GOOGLE_MAPS_API_KEY`.

Non-secret vars (`CAP_BASE_URL`, `LANGCHAIN_TRACING_V2`, `MONITOR_POLL_INTERVAL_SEC`, thresholds) live in `manifest.yml` and survive pushes.

## Joule Integration

Joule DTA files live in `../joule/dispatch_capability/`. The Joule capability POSTs to the CF app's `/chat` endpoint via BTP Destination `GMaps_OD_Dispatch_Agent`. Compile from the capability directory:

```bash
cd ../joule/dispatch_capability && joule compile
```

## Key Patterns

- **Tool error handling**: Every `@tool` function wraps external calls in try/except and returns a string error message — never raises.
- **Driver auto-creation**: CAP's `assignDriver` action auto-creates drivers if the mobile number is new. Direct POST to `Driver` entity is blocked (`@readonly`).
- **AI Core LLM**: Custom `BaseChatModel` in `ai_core.py` that converts LangChain tool schemas to Anthropic format and calls Claude via AI Core's Bedrock-compatible endpoint.
- **Config**: All env vars loaded via `pydantic-settings` in `config.py`. Local: `.env` file. CF: `manifest.yml` + `cf set-env`.