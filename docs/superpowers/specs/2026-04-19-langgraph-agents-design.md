# LangGraph Agents — Phase 3 Design Spec

**Date:** 2026-04-19  
**Branch:** feature_odo_iot_teams → new branch `feature_agents`  
**Status:** Approved for implementation

---

## Overview

A Python FastAPI service deployed on BTP CF alongside the existing CAP app. It hosts a LangGraph multi-agent system (Supervisor + 3 specialist subagents + 1 background monitor) that lets a dispatcher manage EWM deliveries and driver assignments via natural language. All write actions require explicit human confirmation before execution. The same `/chat` endpoint is designed to serve Teams Bot, Joule, or a future CAP UI — the frontend is pluggable.

---

## Repository Structure

```
agents/                          ← root folder for Phase 3 (separate from cap-iot)
  main.py                        ← FastAPI app entrypoint
  agents/
    supervisor.py                ← SupervisorAgent (router + HiTL gate)
    delivery_agent.py            ← DeliveryAgent
    driver_agent.py              ← DriverAgent
    route_agent.py               ← RouteAgent
    monitor_agent.py             ← MonitorAgent (APScheduler background)
  tools/
    delivery_tools.py            ← OData calls for EWM deliveries
    driver_tools.py              ← OData calls for tracking/assignments
    route_tools.py               ← OData calls for GMaps routes
    teams_tools.py               ← Teams webhook poster
    odata_client.py              ← Shared authenticated OData HTTP client
  state.py                       ← LangGraph shared state schema
  config.py                      ← Env var loading
  .env                           ← local dev config (git-ignored)
  requirements.txt
  manifest.yml                   ← CF push manifest for standalone `cf push agents`
  mta.yaml                       ← own MTA for integrated CF deploy
```

Standalone repo/folder at project root — deployed independently from `cap-iot`.

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| **LLM** | SAP AI Core — Claude Sonnet 4.6 via `generative-ai-hub-sdk` (Python) |
| **Auth (agent → CAP OData)** | Reuse `gmaps-app-xsuaa-service` (client credentials); same XSUAA instance CAP srv already trusts — no new XSUAA needed |
| **Auth (Teams/Joule → agent)** | Bearer JWT passed in `Authorization` header on `/chat`; forwarded to CAP OData calls |
| **Agent memory/state** | LangGraph `MemorySaver` (in-process, keyed by `thread_id`); swap to `SqliteSaver` or HANA-backed saver post-PoC |
| **Background scheduler** | APScheduler `BackgroundScheduler`, 5-minute interval, started on FastAPI `lifespan` |
| **Tracing (PoC)** | LangSmith — `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` in `.env`; zero code changes |
| **Config — Dev** | `.env` file only — all vars local, no BTP service bindings needed for development |
| **Config — Prod (CF)** | Bind existing services: `gmaps-app-xsuaa-service`, `gmaps-app-destination`, `aicore` |

### CF Services to Reuse (Prod only — not needed for dev)

| CF Service | Purpose for Agents |
|-----------|-------------------|
| `gmaps-app-xsuaa-service` | XSUAA — bind so agents app shares same JWT trust with CAP srv |
| `gmaps-app-destination` | Has `GoogleAPI-SR`, `EWM-API`, `srv-api` destinations pre-configured |
| `aicore` | Existing AI Core instance — create new service key for agents |

---

## Config / Environment Variables

All vars live in `.env` for local dev. In CF production they are set as environment variables or resolved from bound services.

```env
# AI Core (SAP BTP)
AICORE_AUTH_URL=https://<subaccount>.authentication.us10.hana.ondemand.com/oauth/token
AICORE_CLIENT_ID=
AICORE_CLIENT_SECRET=
AICORE_BASE_URL=https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com
AICORE_DEPLOYMENT_ID=          # Claude Sonnet 4.6 deployment ID

# CAP OData base (gmaps-app-srv CF URL)
CAP_BASE_URL=https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-srv.cfapps.us10.hana.ondemand.com

# XSUAA — reuse gmaps-app-xsuaa-service credentials (client credentials grant)
# Get from: cf service-key gmaps-app-xsuaa-service gmaps-app-xsuaa-key
XSUAA_URL=
XSUAA_CLIENT_ID=
XSUAA_CLIENT_SECRET=

# Teams
TEAMS_WEBHOOK_URL=             # existing SAP Teams channel Incoming Webhook

# LangSmith tracing (PoC observability)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=             # from smith.langchain.com
LANGCHAIN_PROJECT=gmaps-dispatch-agents

# Monitor tuning
MONITOR_POLL_INTERVAL_SEC=300  # default 5 min
UNASSIGNED_THRESHOLD_MIN=30    # alert after N min unassigned
IDLE_THRESHOLD_MIN=20          # alert after N min no GPS movement
```

---

## Agent Design

### SupervisorAgent

**Role:** Entry point for all `/chat` requests. Classifies intent, routes to the right specialist, and owns the human-in-the-loop (HiTL) gate — no write action is executed without returning a confirmation payload to the caller first.

**HiTL flow:**
1. Specialist proposes action → returns `ActionProposal(tool, args, reasoning)`
2. Supervisor formats proposal as a confirmation message: _"I'll assign driver John Doe (KA-01-1234) to delivery 1800001234. Reason: only available driver within 10 km. Confirm? [Yes / No]"_
3. Caller responds `confirm: true/false` on next turn
4. Supervisor executes or cancels

**LangGraph node flow:**
```
START → classify_intent → route_to_specialist → [specialist subgraph]
                                                      ↓
                                              hitl_confirmation_gate
                                                      ↓ (confirmed)
                                              execute_write_tool → END
```

---

### DeliveryAgent

**Scope:** EWM outbound deliveries — listing, filtering, items, route fetch.

**Tools:**

| Tool | OData Call | Type |
|------|-----------|------|
| `list_open_deliveries()` | `GET /odata/v4/ewm/OutboundDeliveries?$filter=Status eq 'OPEN'` | read |
| `list_unassigned_deliveries()` | `GET /odata/v4/ewm/OutboundDeliveries?$filter=DriverAssigned eq false` | read |
| `get_delivery_items(deliveryDoc)` | `POST /odata/v4/ewm/getDeliveryItems` | read |
| `get_delivery_route(deliveryDoc)` | `POST /odata/v4/ewm/getDeliveryRoute` | read |

**Proactive checks (called by MonitorAgent):**
- `check_unassigned_threshold()` — deliveries open > `UNASSIGNED_THRESHOLD_MIN`
- `check_batch_opportunities()` — 2+ open deliveries with same ship-to postal code

---

### DriverAgent

**Scope:** Driver registration, assignment lifecycle, live GPS tracking.

**Read tools:**

| Tool | OData Call |
|------|-----------|
| `list_drivers()` | `GET /odata/v4/tracking/Driver` |
| `list_assignments()` | `GET /odata/v4/tracking/DriverAssignment` |
| `get_driver_status(assignmentId)` | `GET /odata/v4/tracking/getAssignment(assignmentId=...)` |
| `get_live_location(assignmentId)` | `GET /odata/v4/tracking/latestGps(assignmentId=...)` |

**Write tools (proposal-only — Supervisor executes after confirmation):**

| Tool | OData Call |
|------|-----------|
| `propose_assign_driver(deliveryDoc, mobileNumber, truckReg, driverName)` | → `POST /odata/v4/tracking/assignDriver` |
| `propose_confirm_delivery(assignmentId)` | → `POST /odata/v4/tracking/confirmDelivery` |

**Proactive checks (called by MonitorAgent):**
- `check_idle_drivers()` — assignment Status=ASSIGNED, no GPS update for > `IDLE_THRESHOLD_MIN`

---

### RouteAgent

**Scope:** Route directions and step-level map data. Read-only.

| Tool | OData Call |
|------|-----------|
| `get_route_for_delivery(deliveryDoc)` | `POST /odata/v4/ewm/getDeliveryRoute` |
| `list_all_routes()` | `GET /odata/v4/gmaps/RouteDirections` |
| `get_route_steps(routeId)` | `GET /odata/v4/gmaps/RouteDirections/{id}/steps` |

---

### MonitorAgent

**Scope:** Background-only. Never responds to chat. Runs every `MONITOR_POLL_INTERVAL_SEC` seconds via APScheduler. Posts directly to Teams webhook.

**PoC alert cases (3):**

| # | Check | Condition | Teams Message |
|---|-------|-----------|--------------|
| 1 | Unassigned deliveries | Open delivery with no driver for > 30 min | "📦 {N} deliveries unassigned — oldest waiting {X} min" |
| 2 | Idle assigned driver | Status=ASSIGNED, no GPS ping for > 20 min | "🚛 Driver {name} ({truck}) assigned but not moving for {X} min — delivery {doc}" |
| 3 | Batch opportunity | 2+ open deliveries same postal zone | "📍 {N} deliveries near {zone} — consider assigning same driver" |

Alert deduplication: MonitorAgent tracks last-alerted state in-process dict keyed by `(check_type, entity_id)` with a 30-min cooldown to avoid alert storms.

---

## API Contract

### `POST /chat`
```json
// Request
{
  "thread_id": "dispatcher-session-abc",
  "message": "Which deliveries are unassigned?",
  "confirm": null        // or true/false for HiTL responses
}

// Response
{
  "reply": "3 deliveries are currently unassigned: ...",
  "pending_action": null  // or ActionProposal if awaiting confirmation
}
```

### `GET /health`
```json
{
  "status": "ok" | "degraded" | "error",
  "timestamp": "2026-04-19T10:00:00Z",
  "connections": {
    "aicore": "ok" | "error",
    "xsuaa": "ok" | "error",
    "cap_odata": "ok" | "error",
    "teams_webhook": "ok" | "error"
  },
  "agents": {
    "supervisor": "ready",
    "delivery_agent": "ready",
    "driver_agent": "ready",
    "route_agent": "ready"
  },
  "monitor": {
    "status": "running" | "stopped",
    "last_run": "2026-04-19T09:55:00Z",
    "next_run": "2026-04-19T10:00:00Z",
    "checks": {
      "unassigned_deliveries": "ok" | "error",
      "idle_drivers": "ok" | "error",
      "batch_opportunities": "ok" | "error"
    }
  },
  "tools": {
    "list_open_deliveries": "ok" | "error",
    "list_drivers": "ok" | "error",
    "get_live_location": "ok" | "error",
    "get_route_for_delivery": "ok" | "error"
  }
}
```

Overall `status` is `"ok"` only if all connections are `"ok"`. Any connection failure → `"degraded"`. Unhandled exception during health check → `"error"`. Each connection is verified with a lightweight probe (token fetch for XSUAA/AI Core, `$top=1` OData call for CAP, HTTP HEAD for Teams webhook).

---

## Deployment — CF Module in mta.yaml

```yaml
- name: agents
  type: python
  path: .
  parameters:
    buildpack: python_buildpack
    memory: 512M
  requires:
    - name: gmaps-xsuaa
    - name: gmaps-destination
  properties:
    CAP_BASE_URL: https://<gmaps-app-srv>.cfapps.us10.hana.ondemand.com
```

The `manifest.yml` at `agents/` root supports standalone `cf push agents` for fast PoC iteration without a full MTA build.

---

## Skill

A `cap-sap-prototyping` skill extension will be written covering:
- LangGraph + AI Core patterns for this project
- HiTL confirmation pattern
- OData authenticated client pattern
- MonitorAgent APScheduler pattern

---

## Out of Scope (PoC)

- Joule / Teams Bot Framework integration (endpoint is ready, channel wiring is future)
- Persistent conversation memory (HANA-backed)
- Redis state store
- Multi-tenant XSUAA
- Kyma deployment
