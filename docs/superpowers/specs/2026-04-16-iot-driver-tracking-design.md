# IoT Driver Tracking — Design Spec

**Date:** 2026-04-16
**Branch:** feature2_gmap_iot

---

## Goal

Add real-time driver tracking to the Outbound Delivery Object Page. A dispatcher assigns a driver (mobile number mandatory, truck registration optional) to a delivery. A QR code is generated and displayed on screen. The driver scans it, opens a CAP-hosted mobile page, and their GPS location is emitted every 30 seconds. The live position appears as a moving marker on the Fiori map. MS Teams receives key events. When the driver confirms delivery, everything stops cleanly.

---

## Sub-Projects (build in order)

| # | Name | Delivers |
|---|------|---------|
| 1 | Driver Assignment | Popup → DB → QR code on screen → Kafka topic created → Teams "assigned" event |
| 2 | Mobile Tracking Page | CAP-hosted `/tracking/{id}` → GPS every 30s → CAP → Kafka |
| 3 | Live Map | Fiori polls CAP every 30s → moving marker labelled with truck reg or mobile number |
| 4 | Teams Notifications | Assigned / location every 5 min / Delivered |
| 5 | Delivery Confirmation | Driver "Confirm Delivery" → DELIVERED + timestamp → Kafka closed → Teams final event |

---

## Data Model

### New file: `db/iot_schema.cds`

Kept separate from `db/gmaps_schema.cds` so IoT functionality can be split into its own service later.

#### `DriverAssignment`

```cds
entity DriverAssignment : managed {
    key ID                   : UUID;
        DeliveryDocument     : String(10);   // FK to OutboundDeliveries
        MobileNumber         : String(20);   // mandatory — used as fallback marker label
        TruckRegistration    : String(20);   // optional — null for walking deliveries
        AssignedAt           : DateTime;
        DeliveredAt          : DateTime;     // set on confirmation
        Status               : String(20);  // ASSIGNED | IN_TRANSIT | DELIVERED
        KafkaTopic           : String(100); // 'gps-{DeliveryDocument}'
        QRCodeUrl            : String(500); // '/tracking/{ID}'
}
```

**Key rules:**
- `MobileNumber` is mandatory — validated in action handler
- `TruckRegistration` is nullable — walking deliveries omit it
- One active assignment per `DeliveryDocument` at a time (enforced in handler: reject if existing ASSIGNED/IN_TRANSIT exists)
- Regenerating QR does not create a new row — returns existing `QRCodeUrl`

#### `GpsCoordinates`

```cds
entity GpsCoordinates : managed {
    key ID            : UUID;
        assignment    : Association to DriverAssignment;
        Latitude      : Double;
        Longitude     : Double;
        Speed         : Double;    // m/s from browser Geolocation, nullable
        Accuracy      : Double;    // metres, nullable
        RecordedAt    : DateTime;
}
```

**One row per ping.** Latest row per assignment = current truck position. Old rows are retained for route replay (future scope).

---

## Service Design

### New file: `srv/tracking_srv.cds`

```cds
service TrackingService {
    action assignDriver(
        deliveryDoc     : String,
        mobileNumber    : String,
        truckRegistration : String   // optional
    ) returns DriverAssignment;

    action updateLocation(
        assignmentId  : UUID,
        latitude      : Double,
        longitude     : Double,
        speed         : Double,
        accuracy      : Double
    ) returns Boolean;

    action confirmDelivery(
        assignmentId  : UUID
    ) returns Boolean;

    action getQRCode(
        deliveryDoc   : String
    ) returns DriverAssignment;    // returns existing assignment for QR regeneration

    function latestGps(
        assignmentId  : UUID
    ) returns GpsCoordinates;

    @readonly entity DriverAssignment as projection on iot_schema.DriverAssignment;
    @readonly entity GpsCoordinates   as projection on iot_schema.GpsCoordinates;
}
```

### `srv/tracking_srv.js` — action handlers

| Action | Logic |
|--------|-------|
| `assignDriver` | Validate mobileNumber present. Check no active assignment exists for deliveryDoc. Insert DriverAssignment (Status=ASSIGNED). Call `kafka_producer.createTopic(topic)`. Call `teams_notify.post('ASSIGNED', ...)`. Return assignment with QRCodeUrl. |
| `updateLocation` | Insert GpsCoordinates row. If assignment.Status === ASSIGNED → update to IN_TRANSIT. Call `kafka_producer.publish(topic, {lat, lng, truck, mobile, recordedAt})`. |
| `confirmDelivery` | Set Status=DELIVERED, DeliveredAt=now. Call `kafka_producer.closeTopic(topic)`. Call `teams_notify.post('DELIVERED', ...)`. Return true. |
| `getQRCode` | Find active assignment for deliveryDoc. Return it (QRCodeUrl intact). Returns 404 if no active assignment. |
| `latestGps` | SELECT latest GpsCoordinates row for assignmentId ordered by RecordedAt desc, limit 1. |

### `srv/kafka_producer.js`

```
createTopic(topicName)   → admin.createTopics([{ topic: topicName, numPartitions: 1 }])
publish(topicName, msg)  → producer.send({ topic: topicName, messages: [{ value: JSON.stringify(msg) }] })
closeTopic(topicName)    → producer.disconnect(); admin.deleteTopics([topicName])
```

Uses `kafkajs` npm package. Broker: `localhost:9092` (Docker), configurable via env `KAFKA_BROKER`.

### `srv/kafka_consumer.js`

- Subscribes to `gps-*` pattern on startup
- On message: parses payload, calls `tracking_srv.updateLocation` directly (internal call, no HTTP)
- Maintains a per-topic 5-minute timer: on timer fire → calls `teams_notify.post('LOCATION', ...)`
- On `confirmDelivery`: consumer unsubscribes from that topic, timer cleared

### `srv/teams_notify.js`

Posts to Teams Incoming Webhook URL (stored in `DriverAssignment.TeamsWebhookUrl`).

| Event | Teams message |
|-------|--------------|
| ASSIGNED | "🚚 Driver assigned to Delivery {doc} — {truck or mobile}, {assignedAt}" |
| LOCATION | "📍 Truck {truck or mobile} — Delivery {doc} — last seen {lat},{lng} at {time}" |
| DELIVERED | "✅ Delivery {doc} COMPLETED by {truck or mobile} at {deliveredAt}" |

Teams webhook URL read from env `TEAMS_WEBHOOK_URL` — not stored per assignment row.

---

## Frontend

### Driver Assignment Popup — `DriverAssign.fragment.xml`

Triggered by "Assign Driver" button added to the Route & Map custom section action bar.

Fields:
- Truck Registration (optional, Input)
- Mobile Number (mandatory, Input with validation)
- "Assign" button → calls `assignDriver` action
- On success: hides form, shows QR code image (`<img src="https://api.qrserver.com/v1/create-qr-code/?data={url}&size=200x200"/>`)
- "Close" button

### "Show QR" button — always visible on Object Page once assignment exists

Calls `getQRCode` action → re-displays QR popup. Allows dispatcher to regenerate/redisplay without reassigning.

### Live Map — `DeliveryMap.js` additions

- After map renders, checks for active `DriverAssignment` for current `DeliveryDocument`
- If found: starts `setInterval(30000)` polling `latestGps`
- On each poll: moves/creates a `google.maps.Marker` at `{lat, lng}` labelled with `TruckRegistration || MobileNumber`
- Marker uses a truck icon (or default pin with label)
- Polling stops when `confirmDelivery` response received or assignment Status = DELIVERED

### Mobile Tracking Page — `app/tracking/index.html`

CAP-hosted static page, URL: `/tracking/{assignmentId}`

- On load: reads `assignmentId` from URL path
- Calls `navigator.geolocation.watchPosition` (continuous) + `setInterval(30000)` to POST
- POST → `TrackingService/updateLocation` with lat/lng/speed/accuracy
- Shows: "Tracking active — Delivery {doc}, Truck {reg or mobile}"
- "Confirm Delivery" button → calls `confirmDelivery` → shows "Delivery Complete — Thank you. You can close this page."
- If browser denies GPS: shows error "Location access required. Please enable GPS."
- Keeps screen alive via `navigator.wakeLock.request('screen')` where supported

---

## Kafka Infrastructure

### Docker Compose (local dev)

```yaml
# docker-compose.yml (added to project root)
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on: [zookeeper]
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
```

Production migration: replace `KAFKA_BROKER=localhost:9092` with SAP Event Mesh / Confluent Cloud connection string — zero code change.

---

## Lifecycle State Machine

```
[No Assignment]
      │
      ▼ assignDriver()
  ASSIGNED ──────────────────────────────────────────┐
      │                                               │
      ▼ first updateLocation()                        │
  IN_TRANSIT                                          │
      │                                               │
      ▼ confirmDelivery()                             │
  DELIVERED                                           │
      │                                               │
  Kafka topic closed                                  │
  Teams "COMPLETED" posted                            │
  Mobile page shows "Thank you"                       │
  Map polling stops                                   │
                                                      │
  Only one ASSIGNED/IN_TRANSIT per DeliveryDocument ──┘
  (new assignDriver() rejected if active exists)
```

---

## Environment Variables

```
KAFKA_BROKER=localhost:9092          # Docker locally, Event Mesh in production
TEAMS_WEBHOOK_URL=https://...        # Teams Incoming Webhook URL
```

---

## Out of Scope (future)

- Geo-fencing alerts (proximity triggers in Teams)
- Teams bot / agentic driver assignment via chat
- Route replay from stored GpsCoordinates history
- Push notifications to driver mobile (SMS/WhatsApp)
- Multi-tenant Teams channels per delivery
- Native mobile app (background GPS)
