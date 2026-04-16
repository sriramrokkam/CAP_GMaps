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
