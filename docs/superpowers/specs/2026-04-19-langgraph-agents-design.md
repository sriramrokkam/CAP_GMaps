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
cap-iot/
  agents/                        ← new Python package
    main.py                      ← FastAPI app entrypoint
    agents/
      supervisor.py              ← SupervisorAgent (router + HiTL gate)
      delivery_agent.py          ← DeliveryAgent
      driver_agent.py            ← DriverAgent
      route_agent.py             ← RouteAgent
      monitor_agent.py           ← MonitorAgent (APScheduler background)
    tools/
      delivery_tools.py          ← OData calls for EWM deliveries
      driver_tools.py            ← OData calls for tracking/assignments
      route_tools.py             ← OData calls for GMaps routes
      teams_tools.py             ← Teams webhook poster
      odata_client.py            ← Shared authenticated OData HTTP client
    state.py                     ← LangGraph shared state schema
    config.py                    ← Env var loading
    requirements.txt
    manifest.yml                 ← CF push manifest (standalone)
```

New MTA module `agents` added to `cap-iot/mta.yaml` for integrated CF deploy.

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| **LLM** | SAP AI Core — Claude Sonnet 4.6 via `generative-ai-hub-sdk` (Python) |
| **Auth (agent → CAP OData)** | XSUAA client credentials flow; FastAPI fetches token on startup, refreshes before expiry |
| **Auth (Teams/Joule → agent)** | Bearer JWT passed in `Authorization` header on `/chat`; forwarded to CAP OData calls |
| **Agent memory/state** | LangGraph `MemorySaver` (in-process, keyed by `thread_id`); swap to `SqliteSaver` or HANA-backed saver post-PoC |
| **Background scheduler** | APScheduler `BackgroundScheduler`, 5-minute interval, started on FastAPI `lifespan` |
| **Config** | `.env` (dev) / CF environment variables (prod) — see Config section |
| **Destination (CF)** | Existing BTP Destination Service bound to `agents` CF module for AI Core + OData base URL |

---

## Config / Environment Variables

```env
# AI Core
AICORE_AUTH_URL=
AICORE_CLIENT_ID=
AICORE_CLIENT_SECRET=
AICORE_BASE_URL=
AICORE_DEPLOYMENT_ID=          # Claude Sonnet 4.6 deployment

# CAP OData base
CAP_BASE_URL=https://<srv>.cfapps.us10.hana.ondemand.com

# XSUAA (client credentials for agent→CAP)
XSUAA_URL=
XSUAA_CLIENT_ID=
XSUAA_CLIENT_SECRET=

# Teams
TEAMS_WEBHOOK_URL=             # existing channel webhook

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
{ "status": "ok", "monitor": "running" }
```

---

## Deployment — CF Module in mta.yaml

```yaml
- name: agents
  type: python
  path: cap-iot/agents
  parameters:
    buildpack: python_buildpack
    memory: 512M
  requires:
    - name: gmaps-xsuaa
    - name: gmaps-destination
  properties:
    CAP_BASE_URL: ~{srv-url}
```

The `manifest.yml` in `cap-iot/agents/` supports standalone `cf push agents` for fast iteration during PoC.

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
