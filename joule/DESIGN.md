# Phase 4 — Joule A2A Integration Design

**Date:** 2026-04-23
**Branch:** `feature_ph4_joule_agents`
**Status:** Draft — pending implementation

---

## Overview

Replace the Azure Bot Service Teams chat (never shipped) with SAP Joule as the conversational front-end for the dispatch agent system. Joule becomes the UI; the existing LangGraph supervisor + subagents remain the intelligence layer, completely unchanged.

The integration uses **Joule's `api-request` action** to call the FastAPI `/chat` endpoint already running on CF. No new agent logic is written. No existing code is deleted.

Teams *alert* webhooks (CAP `teams_notify.js` + agents `monitor_agent.py`) are **kept as-is** — they are push-only notifications, not chat.

---

## Architecture

```
Dispatcher types in Joule (SAP Build Work Zone)
        │
        ▼
Joule Capability (dispatch_capability)
  ├── Scenario: dispatch_query       ← catches any dispatch question
  ├── Dialog Function: dispatch      ← POSTs to LangGraph /chat
  └── capability.sapdas.yaml        ← wires DispatchAgents BTP destination
        │
        │  POST /chat  (BTP Destination: DispatchAgents)
        ▼
LangGraph FastAPI  (agents/main.py — CF app, unchanged)
  └── Supervisor → DeliveryAgent | DriverAgent | RouteAgent
        │
        │  OData V4 (XSUAA M2M token)
        ▼
CAP IoT Backend  (cap-iot/srv — CF app, unchanged)
  ├── EwmService    → SAP EWM Sandbox
  ├── TrackingService → GPS / Driver Assignment
  └── GmapsService  → Google Maps API

Background (unchanged):
  MonitorAgent (APScheduler) → Teams webhook alerts
```

---

## What Gets Built

### New: `joule/` folder (Joule DTA capability)

```
joule/
├── DESIGN.md                              ← this file
├── dispatch_capability/
│   ├── capability.sapdas.yaml             ← capability config + system_aliases
│   ├── capability_context.yaml            ← thread_id session variable
│   ├── scenarios/
│   │   └── dispatch_query.yaml            ← single catch-all scenario
│   ├── functions/
│   │   └── dispatch.yaml                  ← api-request → POST /chat
│   └── i18n/
│       └── messages.properties            ← English display strings
└── dispatch.da.sapdas.yaml               ← DA config (local dev / deploy)
```

### New: BTP Destination `DispatchAgents`

Configured in BTP cockpit on the Joule subscription subaccount:

| Property | Value |
|---|---|
| Name | `DispatchAgents` |
| Type | HTTP |
| URL | `https://<agents-app>.cfapps.us10.hana.ondemand.com` |
| Authentication | `NoAuthentication` (FastAPI currently open; add OAuth later) |
| Additional property `sap.applicationtype` | `DispatchAgents` |

### Unchanged

| Component | Status |
|---|---|
| `agents/` (all Python) | Untouched |
| `agents/main.py` `/chat` endpoint | Untouched |
| `cap-iot/` (CAP service) | Untouched |
| Teams webhook alerts | Untouched |

---

## Data Flow — Single Turn

1. User types: *"list open deliveries"* in Joule
2. Joule routes to `dispatch_query` scenario (description match)
3. Joule executes `dispatch` dialog function
4. Dialog function POSTs to `DispatchAgents` destination:
   ```json
   { "thread_id": "<session-uuid>", "message": "list open deliveries" }
   ```
5. LangGraph supervisor classifies → `delivery` → `DeliveryAgent`
6. DeliveryAgent calls `list_open_deliveries` tool → CAP OData → EWM Sandbox
7. Response returns through `/chat` → Joule renders as markdown text
8. Dispatcher sees delivery list in Joule panel

**Thread continuity:** `capability_context.yaml` holds a `thread_id` variable initialised on first turn from `$transient.user.id + timestamp`. This is passed to every `/chat` call so LangGraph's `MemorySaver` maintains conversation history across turns.

---

## Joule Capability Files — Detailed Design

### `capability.sapdas.yaml`

```yaml
schema_version: 3.6.0
metadata:
  display_name: Dispatch-Assistant
  namespace: com.sap.dispatch
  name: dispatch_capability
  version: 1.0.0-SNAPSHOT
  description: >-
    Dispatch assistant for managing EWM deliveries, driver assignments,
    GPS tracking, and Google Maps routes via natural language.
system_aliases:
  - name: DispatchAgents
    timeout: 45
```

Schema version 3.6.0 chosen for status-update support (long-running responses from LangGraph may take >10s).

### `capability_context.yaml`

```yaml
variables:
  - name: thread_id
```

### `scenarios/dispatch_query.yaml`

```yaml
description: >-
  Handles dispatch operations including listing EWM outbound deliveries,
  checking delivery status, assigning drivers, tracking GPS locations,
  confirming deliveries, and querying Google Maps routes. Use this for
  any question about deliveries, drivers, assignments, routes, or
  logistics operations.
target:
  type: function
  name: dispatch
response_context:
  - value: reply
    description: Agent response to the user's dispatch query
capability_context:
  - name: thread_id
    value: $target_result.thread_id
```

### `functions/dispatch.yaml`

```yaml
parameters:
  - name: user_message
    optional: true
action_groups:
  - actions:
      - type: status-update
        message: Processing your request...
      - type: set-variables
        variables:
          - name: msg
            value: "<? user_message != null ? user_message : $transient.input.text.raw ?>"
      - type: set-variables
        variables:
          - name: tid
            value: "<? $capability_context.thread_id != null ? $capability_context.thread_id : $transient.user.id ?>"
      - type: api-request
        method: POST
        system_alias: DispatchAgents
        path: /chat
        headers:
          Content-Type: application/json
        body: >
          {
            "thread_id": "<? tid ?>",
            "message": "<? msg ?>"
          }
        timeout: 45
        result_variable: chat_result
result:
  reply: "<? chat_result.body.reply ?>"
  thread_id: "<? tid ?>"
```

### `dispatch.da.sapdas.yaml` (local dev)

```yaml
schema_version: 1.0.0
name: dispatch_assistant
capabilities:
  - type: local
    folder: ./dispatch_capability
```

---

## agents/main.py — No Changes Needed

The `/chat` endpoint already accepts `{ thread_id, message }` and returns `{ reply, pending_action }`. Joule reads `reply` from `chat_result.body.reply`. No modification required.

**One minor addition** (optional but recommended): add CORS or a health check Joule can ping. The `/health` endpoint already exists.

---

## HiTL (Human-in-the-Loop)

When DriverAgent interrupts for write confirmation (assign_driver, confirm_delivery), LangGraph returns a `pending_action` field in the response alongside the `reply`. Phase 4 handles this as a **two-message flow**:

1. First turn: Joule shows the agent's confirmation request message
2. User types "yes" or "no" → second `/chat` call with `confirm: true/false`

Full Joule-native confirmation cards (using `user-confirmation` action) can be added in a Phase 4b iteration once the basic flow is validated.

---

## BTP Deployment Checklist

- [ ] `agents/` FastAPI app deployed on CF (`cf push` or MTA)
- [ ] BTP Destination `DispatchAgents` created in Joule subscription subaccount
- [ ] Joule CLI installed: `npm install -g @sap-ai/joule-cli`
- [ ] `joule login` authenticated to BTP subaccount
- [ ] `joule compile` run from `joule/` — zero errors
- [ ] `joule deploy` — capability deployed to Joule tenant
- [ ] Smoke test in Joule: "list open deliveries" → returns delivery list

---

## What Is NOT in Scope for Phase 4

- Joule BAF agents (all agent logic stays in LangGraph)
- Replacing or modifying any existing Python code
- Teams chat bot (removed, never shipped)
- Native Joule confirmation cards (Phase 4b)
- Multi-language i18n (English only for now)
- CI/CD pipeline for `.daar` deployment

---

## Open Questions

1. **Joule subscription subaccount**: Which BTP subaccount hosts the Joule formation? (needed to create the `DispatchAgents` destination)
2. **Auth on `/chat`**: Should the FastAPI endpoint require a bearer token from Joule, or stay open (acceptable for PoC)?
3. **Schema version**: Is 3.6.0 available on the target landscape (US10)? If not, drop to 3.5.0 (remove status-update).
