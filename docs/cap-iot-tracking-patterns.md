# CAP IoT Driver Tracking — Architecture & Patterns Reference

> Reference document for building real-time IoT tracking on SAP CAP + Fiori Elements + Kafka + Google Maps.
> Based on the `feature2_gmap_iot` branch of CAP_GMaps project.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Fiori Elements (UI5 1.144, sap_horizon)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ List Report  │→│ Object Page  │→│ Custom Sections      │ │
│  │ Deliveries   │  │ DeliveryMap  │  │ - Google Map         │ │
│  │              │  │ DriverAssign │  │ - Truck Marker (30s) │ │
│  └─────────────┘  └──────────────┘  └─────────────────────┘ │
└────────────────┬─────────────────────────────────────────────┘
                 │ OData V4
┌────────────────▼─────────────────────────────────────────────┐
│  CAP Node.js Services                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ EwmService   │  │ GmapsService │  │ TrackingService      │ │
│  │ - READ proxy │  │ - getDirectns│  │ - assignDriver       │ │
│  │ - getRoute   │  │ - Routes DB  │  │ - updateLocation     │ │
│  │ - getItems   │  │              │  │ - confirmDelivery    │ │
│  └──────┬──────┘  └──────┬───────┘  │ - latestGps          │ │
│         │                │          └──────┬──────┬─────────┘ │
│    SAP Sandbox      Google Maps       Kafka│   Teams│          │
│    (EWM + BP)       Directions API         │       │          │
└────────────────────────────────────────────┼───────┼──────────┘
                                             │       │
┌────────────────────────────────────────────▼───────▼──────────┐
│  Infrastructure                                                │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Kafka (KRaft)    │  │ MS Teams     │  │ Mobile Browser   │ │
│  │ Docker localhost  │  │ Webhook      │  │ GPS watchPosition│ │
│  │ Topic: gps-{doc} │  │ MessageCard  │  │ tracking/index   │ │
│  └─────────────────┘  └──────────────┘  └──────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## Key Patterns

### 1. Proxied READ with Local Cache (EwmService)

```
Browser → OData READ → CAP handler → SAP Sandbox API → map rows → return
                                                      → UPSERT local DB (fire-and-forget)
```

**Single-entity read by key** (Object Page): CAP puts key in `req.data`, NOT `query.SELECT.where`. Detect with:
```js
const reqKey = req.data?.DeliveryDocument;
if (reqKey) { /* serve from local DB, fall back to remote by key */ }
```

**Collection read** (List Report): Build `$filter` from `query.SELECT.where` using `_extractFilters()`.

**Gotcha**: SAP sandbox returns different documents than requested — always validate `d.DeliveryDocument === deliveryDoc` on remote fetch.

### 2. Fiori Elements Custom Header Actions

**Manifest format** (UI5 1.144, Fiori Elements v4):
```json
"content": {
  "header": {
    "actions": {
      "myAction": {
        "press": "my.app.ext.controller.MyExt.onMyAction",
        "text": "My Action"
      }
    }
  }
}
```

**Handler module** — plain object, NOT ControllerExtension:
```js
sap.ui.define(["sap/m/MessageToast"], function (MessageToast) {
    return {
        onMyAction: function (oBindingContext) {
            var val = oBindingContext.getProperty("FieldName");
            // ...
        }
    };
});
```

**Key learnings**:
- Do NOT use `controllerExtensions` in manifest — it's an unknown setting for `sap.fe.templates.ObjectPage.Component`
- Do NOT use `sap.fe.core.PageController` or `sap.ui.core.mvc.ControllerExtension`
- Press handler receives `(oBindingContext, aSelectedContexts)`, NOT an event object
- Use full module path in `press`: `"app.namespace.ext.controller.Module.method"`

### 3. Fragment Dialog with Scoped byId

When loading a fragment dialog via `Fragment.load()`:
```js
Fragment.load({ id: "myFragId", name: "app.ext.fragment.MyFrag", controller: handler })
```

Access controls with `Fragment.byId()`, NOT `oDialog.byId()` (sap.m.Dialog doesn't have `byId`):
```js
var ctrl = sap.ui.core.Fragment.byId("myFragId", "controlId");
```

**Circular dependency**: If fragment XML has `core:require="{ handler: 'same/module' }"`, and the JS module calls `Fragment.load` on the same XML → **deadlock**. Remove `core:require`, use `controller:` parameter and `.methodName` in press attributes instead.

### 4. CDS Entity with Status Field

**Do NOT use inline enum syntax**:
```cds
// BAD — Status column won't be created in SQLite!
Status : String(20) enum { ASSIGNED; IN_TRANSIT; DELIVERED; } = 'ASSIGNED';

// GOOD — generates the column correctly
Status : String(20) default 'ASSIGNED';  // ASSIGNED | IN_TRANSIT | DELIVERED
```

### 5. Non-Blocking External Calls

Kafka and Teams webhook calls must NOT block OData action responses:
```js
// BAD — hangs if Kafka is slow/down
await kafkaProducer.createTopic(topic);

// GOOD — fire-and-forget
kafkaProducer.createTopic(topic).catch(err => console.error('non-fatal:', err.message));
```

Add timeouts to KafkaJS:
```js
new Kafka({ brokers: [...], connectionTimeout: 5000, requestTimeout: 5000 });
```

### 6. CAP Managed Mixin with UPSERT

`managed` mixin auto-populates `createdAt/modifiedAt/createdBy/modifiedBy` only within a request context. Outside (e.g., `cds.run(UPSERT...)` in a fire-and-forget):
```js
const now = new Date().toISOString();
cds.run(UPSERT.into(Entity).entries({ ...row, createdAt: now, modifiedAt: now }));
```

### 7. Google Maps in Fiori Custom Section

- `DirectionsRenderer.setDirections()` only works with live SDK objects, NOT stored JSON
- Instead: parse stored `rawData`, decode `overview_polyline.points` with `google.maps.geometry.encoding.decodePath()`, draw with `Polyline`
- Load Maps SDK dynamically with module-level flags to prevent duplicate loads
- Use `_find(localId)` via `document.querySelector('[id$="--localId"]')` for controls in custom sections

### 8. Live Truck Marker Polling

```js
_startTruckTracking: function(deliveryDoc, map) {
    // 1. Find active assignment
    fetch('/odata/v4/tracking/DriverAssignment?$filter=...')
    // 2. Poll latestGps every 30s
    setInterval(() => updateTruckMarker(assignmentId, label, map), 30000);
}
```

**Gotcha**: Truck GPS may be outside route bounds → extend map bounds on first marker:
```js
var bounds = map.getBounds();
bounds.extend(truckPos);
map.fitBounds(bounds);
```

### 9. Mobile Tracking Page (UI5 ObjectPageLayout)

- Use same UI5 bootstrap as Fiori app: `sapui5.hana.ondemand.com/1.144.0`, `sap_horizon`, `sapUiSizeCompact`
- `sap.uxap.ObjectPageLayout` with sections for Delivery Details, Route Info, GPS, Directions
- `SimpleForm` with `ResponsiveGridLayout` matches Fiori Elements field layout
- GPS via `navigator.geolocation.watchPosition()` + 30s `setInterval` for updates
- Simulate GPS button for desktop testing
- `navigator.wakeLock.request('screen')` keeps phone screen on

### 10. Teams Webhook (MessageCard)

Use `@type: "MessageCard"` for rich formatting:
```js
{
    "@type": "MessageCard",
    "themeColor": "0854A0",
    "title": "🚚 Driver Assigned",
    "sections": [{ "facts": [...], "text": "..." }],
    "potentialAction": [{ "@type": "OpenUri", "name": "View on Maps", "targets": [...] }]
}
```

---

## Docker Kafka (KRaft mode, no ZooKeeper)

```yaml
# docker-compose.yml
services:
  kafka:
    image: confluentinc/cp-kafka:7.7.0
    ports: ["9092:9092"]
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
```

`docker compose up -d` — single container, no ZooKeeper.

---

## Mobile Testing (Local)

**Option A — Same WiFi (no HTTPS needed for localhost IPs in most browsers)**:
```
APP_BASE_URL=http://192.168.x.x:4004  # Mac's WiFi IP
PORT=4004 HOST=0.0.0.0 cds watch
```

**Option B — ngrok (HTTPS, required for GPS on HTTP)**:
```
ngrok http 4004
APP_BASE_URL=https://xxxx.ngrok-free.app
```

QR code encodes `${APP_BASE_URL}/tracking/index.html#${assignmentUUID}`.

---

## .env Variables

```
GOOGLE_MAPS_API_KEY=...          # Google Maps Directions API
SAP_SANDBOX_API_KEY=...          # api.sap.com sandbox key
KAFKA_BROKER=localhost:9092      # Kafka broker
TEAMS_WEBHOOK_URL=https://...    # MS Teams incoming webhook
APP_BASE_URL=http://localhost:4004  # Base URL for QR codes
```

---

## Common Bugs & Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `$now` upsert error | `managed` mixin outside request context | Supply `createdAt`/`modifiedAt` manually |
| Key predicate changed | READ returns different doc than requested | Check `req.data.DeliveryDocument` for single-entity reads |
| Header action does nothing | `controllerExtensions` not recognized | Use direct module.method in `press`, plain object handler |
| `oDialog.byId` is not a function | `sap.m.Dialog` has no `byId` | Use `Fragment.byId(fragmentId, controlId)` |
| Status column missing from SQLite | Inline CDS enum syntax | Use `String(20) default 'ASSIGNED'` |
| Assign Driver hangs | `await kafkaProducer.createTopic()` blocks | Fire-and-forget with `.catch()` |
| Truck marker invisible | GPS outside route bounds | `map.getBounds().extend(pos); map.fitBounds(bounds)` |
| Fragment circular dependency | XML `core:require` loads own JS module | Remove `core:require`, use `controller:` param |

---

## Project Status & Completed Features

### Branch: `feature2_gmap_iot`

| Feature | Status | Notes |
|---------|--------|-------|
| Outbound Delivery List Report | Done | Proxied from SAP EWM sandbox, upserted to local SQLite |
| Delivery Object Page | Done | Delivery Details, Items, Route & Map sections |
| Google Maps route rendering | Done | Polyline from decoded overview_polyline, A/B markers, info window |
| Distance/Duration display | Done | Stats bar above map + Delivery Details panel |
| Driver Assignment (Assign Driver) | Done | Header action → dialog → QR code generation |
| Show QR Code | Done | Header action → retrieves existing assignment QR |
| Close Trip | Done | Header action → confirmation popup → marks DELIVERED |
| Driver Mobile Tracking Page | Done | UI5 ObjectPageLayout (sap.uxap), sap_horizon theme |
| GPS Tracking (Browser Geolocation) | Done | watchPosition + 30s interval, Simulate GPS for desktop |
| Live Truck Marker on Map | Done | Polls latestGps every 30s, extends bounds to show marker |
| Kafka GPS Event Stream | Done | KRaft Docker, topic per delivery, fire-and-forget publish |
| Teams Notifications | Done | Rich MessageCards for ASSIGNED/LOCATION/DELIVERED |
| Driver Status in List Report | Done | DriverStatus, Truck, Mobile, Est. Distance/Duration columns |
| Confirm Delivery (mobile + backend) | Done | Both driver (mobile page) and dispatcher (Close Trip button) |

---

## Phase 3: Teams Chatbot — Design & Requirements

### Goal

Natural language interface in Microsoft Teams for dispatchers to manage deliveries, assign drivers, and track GPS — without switching to the Fiori UI.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Microsoft Teams                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Dispatcher Chat                                          │ │
│  │ "Show me open deliveries"                                │ │
│  │ "Assign truck KA-01NA to delivery 80000005"              │ │
│  │ "Where is the truck for 80000001?"                       │ │
│  │ "What's the ETA for delivery 80000002?"                  │ │
│  └────────────────────┬────────────────────────────────────┘ │
└───────────────────────┼──────────────────────────────────────┘
                        │ Azure Bot Service
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  LangGraph Agent (Python)                                     │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │ Claude / GPT  │  │ Tools (OData V4 endpoints)           │ │
│  │ (reasoning)   │→│                                      │ │
│  │               │  │ list_open_deliveries()               │ │
│  │               │  │   GET /odata/v4/ewm/                 │ │
│  │               │  │       OutboundDeliveries              │ │
│  │               │  │                                      │ │
│  │               │  │ get_delivery_details(doc)             │ │
│  │               │  │   GET /odata/v4/ewm/                 │ │
│  │               │  │       OutboundDeliveries('{doc}')     │ │
│  │               │  │                                      │ │
│  │               │  │ get_delivery_route(doc)               │ │
│  │               │  │   POST /odata/v4/ewm/getDeliveryRoute│ │
│  │               │  │                                      │ │
│  │               │  │ assign_driver(doc, mobile, truck)     │ │
│  │               │  │   POST /odata/v4/tracking/            │ │
│  │               │  │       assignDriver                    │ │
│  │               │  │                                      │ │
│  │               │  │ get_driver_status(doc)                │ │
│  │               │  │   GET /odata/v4/tracking/             │ │
│  │               │  │       DriverAssignment?$filter=...    │ │
│  │               │  │                                      │ │
│  │               │  │ get_live_location(assignmentId)       │ │
│  │               │  │   GET /odata/v4/tracking/             │ │
│  │               │  │       latestGps(assignmentId=...)     │ │
│  │               │  │                                      │ │
│  │               │  │ close_trip(assignmentId)              │ │
│  │               │  │   POST /odata/v4/tracking/            │ │
│  │               │  │       confirmDelivery                 │ │
│  │               │  │                                      │ │
│  │               │  │ get_directions()                      │ │
│  │               │  │   GET /odata/v4/gmaps/                │ │
│  │               │  │       RouteDirections?$expand=steps   │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP (Basic Auth / OAuth)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  CAP Backend (existing, no changes needed)                    │
│  EwmService + GmapsService + TrackingService                  │
│  SQLite (dev) / HANA (prod)                                   │
└──────────────────────────────────────────────────────────────┘
```

### Prerequisites

| Requirement | Purpose | Cost |
|-------------|---------|------|
| **Azure subscription** | Host Azure Bot Service + Bot registration | Free tier (standard channels = $0) |
| **Azure Bot Service** | Required by Microsoft for all Teams bots | Free for Teams channel |
| **M365 Developer Program** | Own Teams tenant with admin rights for testing | Free (25 E5 licenses, 90 days renewable) |
| **Teams admin approval** | Install custom bot in corporate Teams | Required for SAP corporate tenant; not needed in dev tenant |
| **Python 3.11+** | LangGraph agent runtime | Already installed |
| **LangGraph + langchain** | Agent framework with tool calling | pip install (free) |
| **Claude API or OpenAI API** | LLM for natural language understanding | API key + usage-based pricing |

**Sign up links:**
- M365 Developer Program: https://developer.microsoft.com/en-us/microsoft-365/dev-program
- Azure free account: https://azure.microsoft.com/free/

### LangGraph Tools Specification

```python
# Tool definitions — each wraps an existing CAP OData endpoint

@tool
def list_open_deliveries(status_filter: str = None) -> str:
    """List outbound deliveries. Optional filter by goods movement status."""
    # GET /odata/v4/ewm/OutboundDeliveries?$top=20
    # Returns: table of delivery doc, route, ship-to, status, date

@tool  
def get_delivery_details(delivery_doc: str) -> str:
    """Get full details for a specific delivery document."""
    # GET /odata/v4/ewm/OutboundDeliveries('{delivery_doc}')
    # Returns: all fields including driver info, distance, duration

@tool
def get_delivery_route(delivery_doc: str) -> str:
    """Fetch Google Maps route for a delivery (origin/destination from BP addresses)."""
    # POST /odata/v4/ewm/getDeliveryRoute {deliveryDoc: delivery_doc}
    # Returns: distance, duration, origin, destination, steps

@tool
def assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str = None) -> str:
    """Assign a driver to a delivery. Mobile number is mandatory. Returns QR code URL."""
    # POST /odata/v4/tracking/assignDriver
    # Returns: assignment ID, QR code URL, status

@tool
def get_driver_status(delivery_doc: str) -> str:
    """Get active driver assignment for a delivery (truck, mobile, status, ETA)."""
    # GET /odata/v4/tracking/DriverAssignment?$filter=DeliveryDocument eq '{doc}' and Status ne 'DELIVERED'
    # Returns: truck, mobile, status, est distance/duration

@tool
def get_live_location(assignment_id: str) -> str:
    """Get the latest GPS coordinates for a driver assignment."""
    # GET /odata/v4/tracking/latestGps(assignmentId={id})
    # Returns: lat, lng, speed, accuracy, recorded time, Google Maps link

@tool
def close_trip(assignment_id: str) -> str:
    """Mark a delivery as completed. Stops GPS tracking and Kafka topic."""
    # POST /odata/v4/tracking/confirmDelivery {assignmentId: id}
    # Returns: success/failure

@tool
def get_directions() -> str:
    """Get the latest stored route directions with turn-by-turn steps."""
    # GET /odata/v4/gmaps/RouteDirections?$orderby=createdAt desc&$top=1&$expand=steps
    # Returns: origin, destination, distance, duration, step-by-step directions
```

### Example Conversations

**Listing deliveries:**
```
Dispatcher: Show me today's open deliveries
Bot: Here are the open deliveries:
     | Delivery  | Route  | Ship-To   | Status | Date       |
     |-----------|--------|-----------|--------|------------|
     | 80000000  | TR0002 | 17100001  | C      | 19 Aug 2016|
     | 80000001  | TR0002 | 17100001  | C      | 09 Sep 2016|
     ... (20 more)
```

**Assigning a driver:**
```
Dispatcher: Assign truck KA-01NA to delivery 80000005, driver mobile +91 98765 43210
Bot: ✅ Driver assigned to delivery 80000005
     Truck: KA-01NA | Mobile: +91 98765 43210
     Status: ASSIGNED
     Est. Distance: 881 mi | ETA: 13 hours 27 mins
     QR Code: [link to tracking page]
     
     Driver should scan this QR code to start GPS tracking.
```

**Tracking:**
```
Dispatcher: Where is the truck for delivery 80000001?
Bot: 🚚 Truck KA-01NA — Delivery 80000001
     Status: IN_TRANSIT
     Location: 12.9716°N, 77.5946°E (Bangalore)
     Speed: 45 km/h
     Last update: 2 minutes ago
     [View on Google Maps]
```

**Closing:**
```
Dispatcher: Close delivery 80000001
Bot: ✅ Delivery 80000001 marked as DELIVERED
     Truck: KA-01NA | Driver: +91 98765 43210
     Delivered at: 16 Apr 2026, 18:45
     Last location: 12.97°N, 77.59°E [View on Maps]
```

### Implementation Steps

1. **Set up M365 Developer Program** — get own Teams tenant with admin rights
2. **Create Azure Bot Service** — register bot, get App ID + secret
3. **Scaffold Python project** — `bot/` directory in this repo
   ```
   bot/
   ├── app.py              # FastAPI server
   ├── agent.py            # LangGraph agent with tools
   ├── tools/
   │   ├── ewm.py          # list_deliveries, get_details, get_route
   │   ├── tracking.py     # assign_driver, get_status, get_location, close_trip
   │   └── gmaps.py        # get_directions
   ├── teams_adapter.py    # Azure Bot Framework → LangGraph bridge
   ├── requirements.txt    # langchain, langgraph, botbuilder-core, fastapi
   └── .env                # AZURE_BOT_APP_ID, AZURE_BOT_APP_SECRET, CAP_BASE_URL
   ```
4. **Implement LangGraph agent** — tools call CAP OData, Claude/GPT reasons
5. **Test locally** — CLI interface first (no Teams)
6. **Connect to Teams** — Azure Bot Framework SDK, register messaging endpoint
7. **Deploy** — Azure Functions (Python) or BTP Kyma

### Auth Strategy

| Environment | CAP Auth | Bot → CAP |
|------------|---------|-----------|
| Local dev | Basic auth (alice:alice) | Same Basic auth in tool HTTP calls |
| Production | XSUAA (OAuth2) | Client credentials flow: Bot gets token from XSUAA, passes as Bearer |

### Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Bot runtime | Python | 3.11+ |
| Agent framework | LangGraph | latest |
| LLM | Claude (Anthropic) or GPT-4 (OpenAI) | latest |
| Bot framework | botbuilder-python (Azure Bot SDK) | 4.x |
| API server | FastAPI | 0.100+ |
| Bot hosting | Azure Functions or BTP Kyma | — |
| Bot registration | Azure Bot Service | Free tier |
| Teams tenant (dev) | M365 Developer Program | Free |

---

## Production Deployment Checklist

### CAP Backend (BTP)
- [ ] `mbt build` → deploy to Cloud Foundry
- [ ] HANA HDI container for persistence
- [ ] XSUAA for authentication
- [ ] BTP Destination Service for Google Maps API + EWM API
- [ ] SAP Event Mesh (replaces Docker Kafka)

### Teams Bot (Azure)
- [ ] Azure Bot Service registration
- [ ] Azure Functions for Python agent
- [ ] Teams admin approval for bot installation
- [ ] XSUAA client credentials for Bot → CAP auth
- [ ] Anthropic/OpenAI API key for LLM

### Monitoring
- [ ] SAP Cloud Logging for CAP
- [ ] Azure Application Insights for Bot
- [ ] Kafka/Event Mesh monitoring
- [ ] Teams webhook health checks
