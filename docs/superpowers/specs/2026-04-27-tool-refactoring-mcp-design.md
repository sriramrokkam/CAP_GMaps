# Phase 4: Tool Refactoring + MCP Integration — Design Spec

**Date:** 2026-04-27
**Branch:** `feature_ph4_joule_agents`
**Status:** Implemented and deployed to CF

---

## Overview

Consolidation of 19 rigid, single-purpose agent tools into 16 flexible, filter-based tools — matching the query capabilities available in the Fiori Elements frontend. Added Google Maps MCP integration (geocode, directions, places, reverse geocode) to the RouteAgent, and fixed the full async chain (FastAPI endpoint → LangGraph graph → supervisor node → subagent) required for async-only MCP tools.

---

## Design Decisions

### 1. Fewer, smarter tools over many rigid tools

**Problem:** The original 18 tools had overlapping purposes (e.g., `list_open_deliveries` vs `list_unassigned_deliveries` differed only by OData filter). The LLM frequently chose the wrong tool or missed filtering capabilities.

**Solution:** Merge tools that differ only by filter parameters into single tools with optional filter arguments. The LLM maps natural language to the appropriate filters.

**Example:**
- Before: `list_open_deliveries()`, `list_unassigned_deliveries()` — 2 separate tools, no further filtering
- After: `list_deliveries(status='unassigned', route='TR0002', driver_name='Sriram', ship_to='17100001', top=20)` — 1 tool, 5 filter dimensions

### 2. MCP for RouteAgent only

Google Maps MCP tools (geocode, directions, places, reverse geocode) are added only to the RouteAgent. Delivery and Driver agents don't need Maps capabilities — they query structured OData entities.

### 3. Graceful MCP degradation

If `GOOGLE_MAPS_API_KEY` is missing or the MCP server fails to start, the RouteAgent still works with its 4 built-in tools (`get_directions`, `list_routes`, `get_route_steps`, `get_last_known_location`). MCP tools are additive.

### 4. Write tools stay in DriverAgent only

All write operations (`assign_driver`, `update_driver`, `update_location`, `confirm_delivery`) remain in the DriverAgent. DeliveryAgent and RouteAgent are read-only.

---

## Tool Inventory (Before → After)

### DeliveryAgent: 4 → 3 tools

| Before | After | Change |
|--------|-------|--------|
| `list_open_deliveries()` | `list_deliveries(status, route, driver_name, ship_to, top)` | Merged into single flexible tool |
| `list_unassigned_deliveries()` | _(merged above)_ | Removed |
| `get_delivery_items(delivery_doc)` | `get_delivery_items(delivery_doc)` | Unchanged |
| `get_delivery_route(delivery_doc)` | `get_delivery_route(delivery_doc)` | Unchanged |

**Status filter mapping** in `list_deliveries`:
| Status keyword | OData $filter |
|----------------|---------------|
| `unassigned` | `DriverStatus eq null or DriverStatus eq 'OPEN'` |
| `assigned` | `DriverStatus eq 'ASSIGNED'` |
| `in_transit` | `DriverStatus eq 'IN_TRANSIT'` |
| `delivered` | `DriverStatus eq 'DELIVERED'` |
| `open` | `DriverStatus eq 'OPEN' or DriverStatus eq null` |
| _(empty/default)_ | Same as `open` |

### DriverAgent: 11 → 9 tools

| Before | After | Change |
|--------|-------|--------|
| `list_drivers()` | `list_drivers(name, mobile, is_active, top)` | Added filter params |
| `get_driver_by_mobile(mobile)` | _(merged into list_drivers)_ | Removed |
| `list_assignments()` | `list_assignments(status, driver_name, delivery_doc, top)` | Added filter params |
| `get_driver_status(assignment_id)` | `get_driver_status(assignment_id)` | Unchanged |
| `get_live_location(assignment_id)` | `get_live_location(assignment_id)` | Unchanged |
| `create_driver(...)` | _(removed — redundant with assign_driver)_ | Removed |
| `update_driver(...)` | `update_driver(driver_id, ...)` | Unchanged |
| `assign_driver(...)` | `assign_driver(delivery_doc, mobile_number, truck_registration, driver_name)` | Unchanged |
| `update_location(...)` | `update_location(assignment_id, latitude, longitude, speed, accuracy)` | Unchanged |
| `confirm_delivery(assignment_id)` | `confirm_delivery(assignment_id)` | Unchanged |
| `get_qr_code(assignment_id)` | `get_qr_code(delivery_doc)` | Changed: now takes delivery_doc, resolves assignment internally |

**Key changes:**
- `list_drivers` now supports partial name/mobile search via `contains()` filter — subsumes `get_driver_by_mobile`
- `list_assignments(status='ASSIGNED')` returns idle/waiting drivers — replaces the concept of "idle drivers"
- `get_qr_code` takes `delivery_doc` instead of `assignment_id` — matches dispatcher mental model

### RouteAgent: 3 → 4 built-in + MCP tools

| Before | After | Change |
|--------|-------|--------|
| `get_directions(origin, destination)` | `get_directions(origin, destination)` | Unchanged |
| `list_all_routes()` | `list_routes(origin, destination, top)` | Renamed, added filters |
| `get_route_steps(route_id)` | `get_route_steps(route_id)` | Unchanged |
| _(none)_ | `get_last_known_location(assignment_id)` | New — GPS coords for passing to MCP tools |

**MCP tools (loaded at startup, when available):**
- `maps_search_places` — search for places near coordinates
- `maps_get_directions` — real-time directions from coordinates
- `maps_geocode` — address to coordinates
- `maps_reverse_geocode` — coordinates to address

---

## Infrastructure Changes

### build_filter helper (`tools/odata_client.py`)

New utility function for constructing OData `$filter` strings:

```python
build_filter(
    exact={"Status": "ASSIGNED", "IsActive": True},
    contains={"DriverName": "Sriram"},
) → "Status eq 'ASSIGNED' and IsActive eq true and contains(DriverName,'Sriram')"
```

- `exact`: generates `field eq 'value'` (strings), `field eq true/false` (bools), `field eq N` (numbers)
- `contains`: generates `contains(field,'value')` for partial matching
- `None` values are silently skipped — enables tools to pass `name or None` without conditional logic

### Async chain for MCP tools

MCP tools loaded via `langchain-mcp-adapters` are async-only (`StructuredTool` without sync implementation). The full invocation chain must be async:

1. **FastAPI endpoint** (`main.py`): `async def chat()` with `await _graph.ainvoke()`
2. **LangGraph graph**: compiled graph supports both sync/async invocation
3. **Supervisor node** (`supervisor.py`): `run_route` is `async def` with `await _route_agent.ainvoke()`
4. **RouteAgent**: `create_react_agent` internally supports async tool execution

Other subagent runner functions (`run_delivery`, `run_driver`) remain sync — they don't use MCP tools.

### MCP client (`mcp_client.py`)

- Uses `MultiServerMCPClient` from `langchain-mcp-adapters`
- Spawns `@modelcontextprotocol/server-google-maps` as stdio subprocess
- Loaded during FastAPI lifespan startup
- Tools injected into RouteAgent via `set_route_agent(build_route_agent(mcp_tools))`

### CF deployment

Multi-buildpack deployment for MCP support:
- `nodejs_buildpack` — provides `npx` for spawning MCP server subprocess
- `python_buildpack` — runs the Python FastAPI application

---

## Test Coverage

### Unit tests (`tests/test_tools.py`)
- Filter schema validation for all list tools (verify `name`, `mobile`, `is_active`, `status`, `route`, `driver_name`, `ship_to`, `delivery_doc`, `top` params exist)
- Removal assertions: old tools (`list_open_deliveries`, `list_unassigned_deliveries`, `get_driver_by_mobile`, `create_driver`, `list_all_routes`, `propose_*`) don't exist
- `get_qr_code` takes `delivery_doc` (not `assignment_id`)
- Tool guidance: descriptions reference the right lookup tools

### Unit tests (`tests/test_route_tools.py`)
- `build_filter`: exact string, exact bool, contains, mixed, skips None, empty → 6 tests
- `get_last_known_location`: formatted output, error handling, coords for maps — 4 tests
- `list_routes`: origin filter passed correctly, no-results message — 2 tests

### Integration tests (`tests/test_graph_structure.py`)
- Supervisor graph has all 5 expected nodes
- Subagents have `tools` node

### API tests (`tests/test_api.py`)
- `/chat` endpoint handles normal messages and interrupt/resume flows
- Patches `agents.supervisor.graph` and `mcp_client.load_mcp_tools` with async mocks

---

## Known Limitations

1. **Supervisor classification**: The word "route" in a query causes routing to RouteAgent even when the user means delivery route (e.g., "list deliveries on route TR0002"). Workaround: phrase as "deliveries for route TR0002" or "deliveries with route TR0002".

2. **MCP server startup time**: The Google Maps MCP server subprocess takes 2-3 seconds to spawn on cold start. This only affects the first request after deployment — subsequent requests reuse the running server.

3. **No HiTL gate on write tools**: `interrupt_before=["tools"]` was intentionally not used because it blocks all tool calls including reads. Write actions rely on the LLM explaining what it will do before executing.
