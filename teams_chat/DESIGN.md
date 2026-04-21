# Teams Chat Integration — Design Spec

**Date:** 2026-04-21
**Status:** Planned (not yet implemented)
**Depends on:** agents/ (LangGraph supervisor + tools), Azure Bot Service

---

## Overview

Thin adapter layer that connects Microsoft Teams to the existing LangGraph dispatch agent system. No new agents or tools — wraps the existing `/chat` endpoint and tools behind the Teams Bot protocol.

---

## Architecture

```
Microsoft Teams
    ↕ (Bot Framework protocol)
Azure Bot Service (free tier, F0)
    ↕ (HTTPS POST /api/messages)
teams_chat/bot.py (adapter)
    ↕ (HTTP POST)
agents/main.py POST /chat (existing)
    ↕
LangGraph supervisor → subagents → tools → CAP OData
```

### What lives where

| Component | Location | New or Existing |
|-----------|----------|-----------------|
| Bot adapter (receives Teams messages, sends responses) | `teams_chat/bot.py` | NEW |
| Adaptive Card templates | `teams_chat/cards.py` | NEW |
| Proactive alert sender | `teams_chat/alerts.py` | NEW |
| Dashboard stats collector | `teams_chat/dashboard.py` | NEW |
| Bot config | `teams_chat/config.py` | NEW |
| LangGraph supervisor + all tools | `agents/` | EXISTING (no changes) |
| Monitor background job | `agents/agents/monitor_agent.py` | EXISTING (minor change: calls alerts.py instead of webhook) |
| FastAPI /chat endpoint | `agents/main.py` | EXISTING (no changes) |

---

## Project Structure

```
teams_chat/
├── bot.py              ← Bot Framework adapter (receives messages, button clicks)
├── cards.py            ← Adaptive Card builders (chat response, alert, dashboard, HiTL)
├── alerts.py           ← Proactive messaging (push alerts to Teams via Bot Service)
├── dashboard.py        ← Collects stats from agent tools, returns dashboard card
├── config.py           ← Azure Bot credentials (from .env)
├── requirements.txt    ← botbuilder-core, botbuilder-integration-aiohttp
├── app.py              ← aiohttp server entry point
└── .env.example        ← Template for Azure Bot credentials
```

---

## Phase 1: Receive Alerts (Adaptive Cards)

**Goal:** Replace the current `teams_tools.py` MessageCard webhook with rich Adaptive Cards sent via Azure Bot Service proactive messaging.

### Alert Types

| Alert | Trigger | Card Content |
|-------|---------|-------------|
| Driver Assigned | `assign_driver` tool executed | Driver name, truck, delivery doc, tracking URL, "Track" button |
| GPS Update | `update_location` tool executed | Truck ID, coordinates, speed, address, "View Map" button |
| Delivery Complete | `confirm_delivery` tool executed | Delivery doc, driver, timestamp, final GPS, "View Location" button |
| Unassigned Escalation | Monitor: delivery unassigned > 30 min | Count, oldest age, delivery docs, "Assign Now" button |
| Idle Driver | Monitor: driver assigned but no GPS > 20 min | Driver name, truck, idle duration, "Check Status" button |
| Batch Opportunity | Monitor: 2+ deliveries to same ship-to | Ship-to, delivery count, docs, "Plan Batch" button |

### How proactive messaging works

1. When bot is first installed in a Teams channel, store the `conversation_reference` (channel ID + service URL)
2. To send an alert, use `bot.continue_conversation(reference)` to push a message without user initiation
3. Conversation reference is persisted in a JSON file (`teams_chat/conversation_refs.json`)

### Card Template (example: Driver Assigned)

```json
{
  "type": "AdaptiveCard",
  "version": "1.4",
  "body": [
    {"type": "TextBlock", "text": "🚚 Driver Assigned", "weight": "Bolder", "size": "Medium"},
    {"type": "TextBlock", "text": "Delivery **80000011**"},
    {"type": "FactSet", "facts": [
      {"title": "Driver", "value": "Agent Test Driver"},
      {"title": "Truck", "value": "KA-01-CC-9999"},
      {"title": "Mobile", "value": "+910000099999"},
      {"title": "Assigned At", "value": "21 Apr 2026, 14:30"}
    ]}
  ],
  "actions": [
    {"type": "Action.OpenUrl", "title": "📍 Track Live", "url": "https://...tracking.html?id=..."},
    {"type": "Action.Submit", "title": "✅ Confirm Delivery", "data": {"action": "confirm", "assignment_id": "..."}}
  ]
}
```

---

## Phase 2: Chat from Teams

**Goal:** Dispatchers type natural language in Teams, the supervisor agent responds with formatted Adaptive Cards.

### Flow

```
1. Dispatcher types: "show available drivers"
2. Teams → Azure Bot Service → POST /api/messages
3. bot.py receives Activity (type: message, text: "show available drivers")
4. bot.py calls: POST http://localhost:8000/chat
   body: {"thread_id": "<teams_conversation_id>", "message": "show available drivers"}
5. agents/main.py processes through supervisor graph → driver agent → list_drivers tool
6. Response: {"reply": "5 drivers: ..."}
7. bot.py formats reply as Adaptive Card with structured layout
8. Bot sends card back to Teams channel
```

### Message formatting

| Agent response contains | Card format |
|------------------------|-------------|
| List of items (deliveries, drivers, assignments) | Table/FactSet card |
| Route directions | Map link + distance/duration card |
| Error message | Red-themed card with retry suggestion |
| Single value (status, confirmation) | Simple text card |
| Pending action (HiTL) | Card with Approve/Reject buttons |

### Thread mapping

- Teams conversation ID → `/chat` `thread_id`
- Each Teams channel gets its own conversation thread
- Conversation history persists via LangGraph checkpointer (MemorySaver)

---

## Phase 3: Actionable Cards

**Goal:** Adaptive Card buttons trigger agent actions directly — approve assignments, track drivers, confirm deliveries.

### Action flow

```
1. Card shows "✅ Confirm Delivery" button with data: {"action": "confirm", "assignment_id": "abc-123"}
2. User clicks button
3. Teams → Bot Service → POST /api/messages (Activity type: invoke or message with value)
4. bot.py reads action data
5. bot.py calls: POST http://localhost:8000/chat
   body: {"thread_id": "...", "message": "confirm delivery abc-123", "confirm": true}
6. Agent executes confirm_delivery tool
7. bot.py sends success/failure card back
```

### Supported card actions

| Button | Agent tool called | Requires confirmation? |
|--------|------------------|----------------------|
| "Assign Now" (from escalation alert) | Opens assignment dialog → `assign_driver` | Yes (HiTL) |
| "Track Driver" | `get_live_location` | No |
| "Check Status" | `get_driver_status` | No |
| "Confirm Delivery" | `confirm_delivery` | Yes (HiTL) |
| "Plan Batch" | `list_unassigned_deliveries` filtered by zone | No |
| "View Map" | `Action.OpenUrl` to Google Maps | No (client-side) |

### HiTL in Teams

When the agent pauses for confirmation:
1. `/chat` returns `{"reply": "...", "pending_action": {"tool": "assign_driver", "args": {...}}}`
2. `bot.py` renders a card with action details + Approve/Reject buttons
3. User clicks Approve → `bot.py` calls `/chat` with `confirm: true`
4. User clicks Reject → `bot.py` calls `/chat` with `confirm: false`

---

## Phase 4: Dashboard Card

**Goal:** On-demand or periodic summary of delivery/driver status as an Adaptive Card.

### Trigger

- User types "dashboard" or "show summary" in Teams
- Or: scheduled push every N hours via proactive messaging

### Dashboard card layout

```
┌─────────────────────────────────────┐
│  📊 Dispatch Dashboard              │
│  Updated: 21 Apr 2026, 14:30        │
├─────────────────────────────────────┤
│  Deliveries                         │
│  ├── Open: 50                       │
│  ├── Unassigned: 39                 │
│  └── Delivered today: 3             │
├─────────────────────────────────────┤
│  Drivers                            │
│  ├── Total: 5                       │
│  ├── In Transit: 1                  │
│  ├── Assigned (idle): 0             │
│  └── Available: 4                   │
├─────────────────────────────────────┤
│  Alerts                             │
│  ├── Unassigned > 30 min: 12        │
│  └── Idle drivers: 0                │
├─────────────────────────────────────┤
│  [View Deliveries] [View Drivers]   │
│  [Assign Drivers]  [Refresh]        │
└─────────────────────────────────────┘
```

### Data collection

`dashboard.py` calls the existing tools directly (not through the LLM):
- `list_open_deliveries()` → count
- `list_unassigned_deliveries()` → count
- `list_drivers()` → total + active
- `list_assignments()` → in_transit / assigned counts

No LLM call needed — pure data aggregation, fast response.

---

## Azure Bot Service Setup

### Prerequisites

- Azure subscription (free tier works)
- Azure Bot registration (F0 — free, 10k messages/month)
- Teams app manifest (for installing in a Teams channel)

### Credentials needed (in `teams_chat/.env`)

```env
# Azure Bot Service
MICROSOFT_APP_ID=<from Azure Bot registration>
MICROSOFT_APP_PASSWORD=<from Azure Bot registration>

# Agents API (your existing server)
AGENTS_API_URL=http://localhost:8000

# Teams channel for proactive alerts
TEAMS_CHANNEL_ID=<stored on first bot installation>
```

### Deployment options

| Option | Setup | Best for |
|--------|-------|----------|
| Local + ngrok | `ngrok http 3978` → paste URL in Azure Bot | Development/demo |
| Azure App Service | Deploy `teams_chat/` as separate web app | Production |
| Same server as agents | Add bot routes to `agents/main.py` | Simple deployment |

---

## Implementation Order

| Phase | Scope | Effort | Depends on |
|-------|-------|--------|------------|
| **Phase 1: Alerts** | `cards.py` + `alerts.py` + Azure Bot setup | 1-2 days | Azure subscription |
| **Phase 2: Chat** | `bot.py` + message routing + card formatting | 2-3 days | Phase 1 |
| **Phase 3: Actionable Cards** | Button handlers + HiTL flow | 1-2 days | Phase 2 |
| **Phase 4: Dashboard** | `dashboard.py` + stats collection + card | 1 day | Phase 2 |

Phases are independent after Phase 2 — Phase 3 and 4 can be done in any order.

---

## What does NOT change

- `agents/` — no modifications to supervisor, subagents, or tools
- `agents/main.py` — `/chat` endpoint stays exactly the same
- `cap-iot/` — no CAP changes
- `agents/.env` — existing credentials unchanged

The only change to existing code: `monitor_agent.py` would optionally call `alerts.py` (Bot Service proactive messaging) instead of the raw webhook, giving richer cards. The webhook fallback stays for backward compatibility.

---

## Testing Plan

| Test | Method |
|------|--------|
| Bot receives message | Teams → type message → verify response card |
| Alert delivery | Trigger `assign_driver` → verify Teams card appears |
| Button click (read) | Click "Track Driver" → verify location response |
| Button click (write) | Click "Confirm Delivery" → verify HiTL flow |
| Dashboard | Type "dashboard" → verify stats card |
| Proactive alert | Wait for monitor cycle → verify escalation card |
| Thread persistence | Send 2 messages → verify context maintained |
