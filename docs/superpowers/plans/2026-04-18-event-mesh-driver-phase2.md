# Event Mesh + Driver Master Data + Teams Adaptive Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Kafka with SAP Event Mesh pub/sub (one topic per delivery), simplify HANA GPS storage to latest-only on DriverAssignment, add Driver master data with auto-register + value help, and upgrade Teams alerts to Adaptive Cards with tracking URL.

**Architecture:** CAP native `cds.emit` publishes 3 event types (ASSIGNED/GPS/DELIVERED) to `default/gmaps-app/1/delivery/<DeliveryDoc>` on SAP Event Mesh. GpsCoordinates table dropped — DriverAssignment stores StartLat/Lng, CurrentLat/Lng, EndLat/Lng directly. New Driver entity auto-registers on first assignDriver call and provides value help in the Fiori assign dialog. Teams MessageCard upgraded to Adaptive Card with tracking URL.

**Tech Stack:** SAP CAP Node.js, SAP Event Mesh (enterprise-messaging), SAPUI5 Fiori Elements, Microsoft Teams Incoming Webhook (Adaptive Card format), Cloud Foundry BTP.

---

## Files Modified / Created

| File | Action | What changes |
|------|--------|-------------|
| `cap-iot/db/iot_schema.cds` | Modify | Add `Driver` entity; update `DriverAssignment` (drop KafkaTopic, add GPS fields); remove `GpsCoordinates` |
| `cap-iot/srv/tracking_srv.cds` | Modify | Expose `Driver` entity; update `latestGps` return type; remove `GpsCoordinates` projection |
| `cap-iot/srv/tracking_srv.js` | Modify | Replace kafka calls with `cds.emit`; auto-register Driver; update GPS logic to overwrite CurrentLat/Lng; set StartLat on first ping, EndLat on confirm |
| `cap-iot/srv/teams_notify.js` | Modify | Replace MessageCard with Adaptive Card format; add tracking URL to ASSIGNED card |
| `cap-iot/srv/kafka_producer.js` | Delete | Replaced by cds.emit |
| `cap-iot/srv/kafka_consumer.js` | Delete | No longer needed |
| `cap-iot/app/deliveries/webapp/ext/fragment/DriverAssign.fragment.xml` | Modify | Add value help (Select/ComboBox) for mobile number; add driver name field |
| `cap-iot/app/deliveries/webapp/ext/fragment/DriverAssign.js` | Modify | Load drivers list for value help; auto-fill truck on driver select; pass driverName to assignDriver |
| `cap-iot/package.json` | Modify | Remove `kafkajs` dependency |

---

## Task 1: Update IoT Schema — Drop GpsCoordinates, Add Driver, Update DriverAssignment

**Files:**
- Modify: `cap-iot/db/iot_schema.cds`

- [ ] **Step 1: Replace iot_schema.cds contents**

Replace the entire file with:

```cds
namespace iot_schema;
using { managed } from '@sap/cds/common';

/**
 * Driver master data — auto-registered on first assignDriver call.
 */
entity Driver : managed {
    key ID                : UUID;
        MobileNumber      : String(20)  @title: 'Mobile Number';
        DriverName        : String(100) @title: 'Driver Name';
        TruckRegistration : String(20)  @title: 'Default Truck';
        LicenseNumber     : String(50)  @title: 'License Number';
        IsActive          : Boolean default true @title: 'Active';
}

/**
 * Driver assignment — one per delivery trip.
 * GPS stored as start/current/end only — no history table.
 */
entity DriverAssignment : managed {
    key ID                : UUID;
        driver            : Association to Driver;
        DeliveryDocument  : String(10)    @title: 'Delivery Document';
        MobileNumber      : String(20)    @title: 'Mobile Number';
        DriverName        : String(100)   @title: 'Driver Name';
        TruckRegistration : String(20)    @title: 'Truck Registration';
        AssignedAt        : DateTime      @title: 'Assigned At';
        DeliveredAt       : DateTime      @title: 'Delivered At';
        Status            : String(20) default 'ASSIGNED' @title: 'Status';
        EventTopic        : String(200)   @title: 'Event Mesh Topic';
        QRCodeUrl         : String(500)   @title: 'QR Code URL';
        QRCodeImage       : LargeString   @title: 'QR Code Image';
        EstimatedDistance : String(100)   @title: 'Est. Distance';
        EstimatedDuration : String(100)   @title: 'Est. Duration';
        // Trip GPS — start (first ping), current (latest ping), end (on delivery)
        StartLat          : Double        @title: 'Start Latitude';
        StartLng          : Double        @title: 'Start Longitude';
        StartedAt         : DateTime      @title: 'Trip Started At';
        CurrentLat        : Double        @title: 'Current Latitude';
        CurrentLng        : Double        @title: 'Current Longitude';
        CurrentSpeed      : Double        @title: 'Current Speed (m/s)';
        LastGpsAt         : DateTime      @title: 'Last GPS At';
        EndLat            : Double        @title: 'End Latitude';
        EndLng            : Double        @title: 'End Longitude';
}
```

- [ ] **Step 2: Verify CDS compiles**

```bash
cd cap-iot && npx cds compile db/iot_schema.cds
```
Expected: no errors, JSON CSN printed to stdout.

- [ ] **Step 3: Commit**

```bash
git add db/iot_schema.cds
git commit -m "feat: add Driver entity, update DriverAssignment with GPS fields, drop GpsCoordinates"
```

---

## Task 2: Update Tracking Service CDS

**Files:**
- Modify: `cap-iot/srv/tracking_srv.cds`

- [ ] **Step 1: Replace tracking_srv.cds contents**

```cds
using { iot_schema } from '../db/iot_schema';

@requires: 'authenticated-user'
service TrackingService {

    @readonly
    entity DriverAssignment as projection on iot_schema.DriverAssignment;

    @readonly
    entity Driver as projection on iot_schema.Driver;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action assignDriver(
        deliveryDoc       : String,
        mobileNumber      : String,
        truckRegistration : String,
        driverName        : String
    ) returns DriverAssignment;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getQRCode(
        deliveryDoc : String
    ) returns DriverAssignment;

    @requires: 'any'
    action updateLocation(
        assignmentId : UUID,
        latitude     : Double,
        longitude    : Double,
        speed        : Double,
        accuracy     : Double
    ) returns Boolean;

    @requires: 'any'
    action confirmDelivery(
        assignmentId : UUID
    ) returns Boolean;

    @requires: 'any'
    function latestGps(
        assignmentId : UUID
    ) returns {
        Latitude  : Double;
        Longitude : Double;
        Speed     : Double;
        LastGpsAt : DateTime;
    };
}
```

- [ ] **Step 2: Verify CDS compiles**

```bash
cd cap-iot && npx cds compile srv/tracking_srv.cds
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add srv/tracking_srv.cds
git commit -m "feat: add Driver entity to TrackingService, update latestGps return type, remove GpsCoordinates"
```

---

## Task 3: Replace Kafka with SAP Event Mesh in tracking_srv.js

**Files:**
- Modify: `cap-iot/srv/tracking_srv.js`
- Delete: `cap-iot/srv/kafka_producer.js`
- Delete: `cap-iot/srv/kafka_consumer.js`

- [ ] **Step 1: Replace tracking_srv.js contents**

```js
const cds = require('@sap/cds');
const teamsNotify = require('./teams_notify');
const QRCode      = require('qrcode');

module.exports = class TrackingService extends cds.ApplicationService {
    async init() {
        const { DriverAssignment, Driver } = this.entities;
        const db = await cds.connect.to('db');

        // ----------------------------------------------------------------
        // assignDriver — dispatcher creates a new assignment
        // ----------------------------------------------------------------
        this.on('assignDriver', async (req) => {
            try {
                const { deliveryDoc, mobileNumber, truckRegistration, driverName } = req.data;

                if (!mobileNumber || mobileNumber.trim() === '')
                    return req.error(400, 'mobileNumber is required');

                // 1. Check for existing active assignment
                const existing = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { in: ['ASSIGNED', 'IN_TRANSIT'] } });
                if (existing)
                    return req.error(409, `Active assignment already exists for delivery ${deliveryDoc}`);

                // 2. Auto-register or update Driver master data
                let driver = await SELECT.one.from(Driver).where({ MobileNumber: mobileNumber });
                if (!driver) {
                    driver = {
                        ID:                cds.utils.uuid(),
                        MobileNumber:      mobileNumber,
                        DriverName:        driverName || mobileNumber,
                        TruckRegistration: truckRegistration || null,
                        LicenseNumber:     null,
                        IsActive:          true
                    };
                    await INSERT.into(Driver).entries(driver);
                } else if (truckRegistration && truckRegistration !== driver.TruckRegistration) {
                    await UPDATE(Driver).set({ TruckRegistration: truckRegistration }).where({ ID: driver.ID });
                }

                // 3. Generate UUID, topic, QR URL
                const id       = cds.utils.uuid();
                const topic    = `default/gmaps-app/1/delivery/${deliveryDoc}`;
                const qrUrl    = `/tracking/index.html#${id}`;
                const baseUrl  = process.env.APP_BASE_URL || 'http://localhost:4004';
                const qrImage  = await QRCode.toDataURL(`${baseUrl}${qrUrl}`);
                const trackUrl = `${baseUrl}${qrUrl}`;

                // 4. Fetch estimated distance/duration from stored route (best-effort)
                let estDistance = null, estDuration = null;
                try {
                    const route = await db.run(
                        SELECT.one.from('gmaps_schema_RouteDirections').columns('distance', 'duration').orderBy({ createdAt: 'desc' })
                    );
                    if (route) { estDistance = route.distance; estDuration = route.duration; }
                } catch (_) {}

                // 5. Build assignment
                const assignment = {
                    ID:                id,
                    driver_ID:         driver.ID,
                    DeliveryDocument:  deliveryDoc,
                    MobileNumber:      mobileNumber,
                    DriverName:        driverName || driver.DriverName || mobileNumber,
                    TruckRegistration: truckRegistration || driver.TruckRegistration || null,
                    AssignedAt:        new Date().toISOString(),
                    Status:            'ASSIGNED',
                    EventTopic:        topic,
                    QRCodeUrl:         qrUrl,
                    QRCodeImage:       qrImage,
                    EstimatedDistance: estDistance,
                    EstimatedDuration: estDuration
                };

                // 6. Persist
                await INSERT.into(DriverAssignment).entries(assignment);

                // 7. Emit to Event Mesh + Teams (fire-and-forget)
                this._emit(topic, {
                    eventType:   'ASSIGNED',
                    deliveryDoc: deliveryDoc,
                    truck:       assignment.TruckRegistration,
                    driver:      assignment.DriverName,
                    mobile:      mobileNumber,
                    trackUrl:    trackUrl,
                    timestamp:   assignment.AssignedAt
                });
                teamsNotify.post('ASSIGNED', { ...assignment, TrackingUrl: trackUrl })
                    .catch(err => console.error('Teams notify (non-fatal):', err.message));

                return assignment;
            } catch (err) {
                console.error('assignDriver error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // getQRCode — retrieve latest active assignment QR for a delivery
        // ----------------------------------------------------------------
        this.on('getQRCode', async (req) => {
            try {
                const { deliveryDoc } = req.data;
                const assignment = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { '!=': 'DELIVERED' } })
                    .orderBy({ AssignedAt: 'desc' });
                if (!assignment)
                    return req.error(404, `No active assignment for delivery ${deliveryDoc}`);
                return assignment;
            } catch (err) {
                console.error('getQRCode error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // updateLocation — driver pushes a GPS ping
        // ----------------------------------------------------------------
        this.on('updateLocation', async (req) => {
            try {
                const { assignmentId, latitude, longitude, speed, accuracy } = req.data;

                const assignment = await SELECT.one.from(DriverAssignment).where({ ID: assignmentId });
                if (!assignment)       return req.error(404, 'Assignment not found');
                if (assignment.Status === 'DELIVERED') return req.error(409, 'Delivery already completed');

                const now = new Date().toISOString();
                const isFirstPing = assignment.Status === 'ASSIGNED';

                // Build update — overwrite current, set start on first ping only
                const update = {
                    CurrentLat:   latitude,
                    CurrentLng:   longitude,
                    CurrentSpeed: speed || null,
                    LastGpsAt:    now
                };
                if (isFirstPing) {
                    update.StartLat   = latitude;
                    update.StartLng   = longitude;
                    update.StartedAt  = now;
                    update.Status     = 'IN_TRANSIT';
                }

                await UPDATE(DriverAssignment).set(update).where({ ID: assignmentId });

                // Emit GPS event to Event Mesh (fire-and-forget)
                this._emit(assignment.EventTopic, {
                    eventType:   'GPS',
                    deliveryDoc: assignment.DeliveryDocument,
                    lat:         latitude,
                    lng:         longitude,
                    speed:       speed || null,
                    truck:       assignment.TruckRegistration || null,
                    timestamp:   now
                });

                // Teams alert only for IN_TRANSIT
                if (assignment.Status === 'IN_TRANSIT' || isFirstPing) {
                    teamsNotify.post('LOCATION', {
                        TruckRegistration: assignment.TruckRegistration || null,
                        MobileNumber:      assignment.MobileNumber,
                        DeliveryDocument:  assignment.DeliveryDocument,
                        Latitude:          latitude,
                        Longitude:         longitude,
                        Speed:             speed || null,
                        RecordedAt:        now
                    }).catch(err => console.error('Teams location notify (non-fatal):', err.message));
                }

                return true;
            } catch (err) {
                console.error('updateLocation error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // confirmDelivery — driver marks delivery as done
        // ----------------------------------------------------------------
        this.on('confirmDelivery', async (req) => {
            try {
                const { assignmentId } = req.data;

                const assignment = await SELECT.one.from(DriverAssignment).where({ ID: assignmentId });
                if (!assignment) return req.error(404, 'Assignment not found');
                if (assignment.Status === 'DELIVERED') return true;

                const deliveredAt = new Date().toISOString();

                await UPDATE(DriverAssignment)
                    .set({
                        Status:      'DELIVERED',
                        DeliveredAt: deliveredAt,
                        EndLat:      assignment.CurrentLat,
                        EndLng:      assignment.CurrentLng
                    })
                    .where({ ID: assignmentId });

                // Emit DELIVERED event then close topic
                this._emit(assignment.EventTopic, {
                    eventType:   'DELIVERED',
                    deliveryDoc: assignment.DeliveryDocument,
                    lat:         assignment.CurrentLat,
                    lng:         assignment.CurrentLng,
                    truck:       assignment.TruckRegistration || null,
                    timestamp:   deliveredAt
                });

                // Teams DELIVERED alert (fire-and-forget)
                (async () => {
                    try {
                        let shipToParty = null;
                        try {
                            const del = await db.run(
                                SELECT.one.from('gmaps_schema_OutboundDeliveries')
                                    .columns('ShipToParty')
                                    .where({ DeliveryDocument: assignment.DeliveryDocument })
                            );
                            if (del) shipToParty = del.ShipToParty;
                        } catch (_) {}

                        await teamsNotify.post('DELIVERED', {
                            ...assignment,
                            DeliveredAt: deliveredAt,
                            ShipToParty: shipToParty,
                            LastLat:     assignment.CurrentLat,
                            LastLng:     assignment.CurrentLng
                        });
                    } catch (e) { console.error('Teams DELIVERED notify error:', e.message); }
                })();

                return true;
            } catch (err) {
                console.error('confirmDelivery error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // latestGps — return current GPS from DriverAssignment (no history table)
        // ----------------------------------------------------------------
        this.on('latestGps', async (req) => {
            try {
                const { assignmentId } = req.data;
                const row = await SELECT.one.from(DriverAssignment)
                    .columns('CurrentLat', 'CurrentLng', 'CurrentSpeed', 'LastGpsAt')
                    .where({ ID: assignmentId });
                if (!row || !row.CurrentLat) return null;
                return {
                    Latitude:  row.CurrentLat,
                    Longitude: row.CurrentLng,
                    Speed:     row.CurrentSpeed,
                    LastGpsAt: row.LastGpsAt
                };
            } catch (err) {
                console.error('latestGps error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // /tracking/config.js — runtime config injection
        // ----------------------------------------------------------------
        cds.app.get('/tracking/config.js', (req, res) => {
            const intervalMs = parseInt(process.env.GPS_POLL_INTERVAL_MS, 10) || 60000;
            res.setHeader('Content-Type', 'application/javascript');
            res.send(`window.GPS_POLL_INTERVAL_MS = ${intervalMs};`);
        });

        return super.init();
    }

    // Helper: emit to Event Mesh, non-fatal if EM not configured
    _emit(topic, payload) {
        cds.emit(topic, payload).catch(err =>
            console.error(`Event Mesh emit failed (non-fatal): ${err.message}`)
        );
    }
};
```

- [ ] **Step 2: Delete Kafka files**

```bash
cd cap-iot
rm srv/kafka_producer.js srv/kafka_consumer.js
```

- [ ] **Step 3: Start locally and verify no startup errors**

```bash
cd cap-iot && npm start 2>&1 | head -30
```
Expected: server starts on port 4004, no "Cannot find module" errors, no Kafka errors.

- [ ] **Step 4: Commit**

```bash
git add srv/tracking_srv.js
git rm srv/kafka_producer.js srv/kafka_consumer.js
git commit -m "feat: replace Kafka with SAP Event Mesh cds.emit, update GPS logic to overwrite CurrentLat/Lng"
```

---

## Task 4: Remove KafkaJS Dependency

**Files:**
- Modify: `cap-iot/package.json`

- [ ] **Step 1: Remove kafkajs from dependencies**

```bash
cd cap-iot && npm uninstall kafkajs
```
Expected: `kafkajs` removed from `package.json` and `node_modules/`.

- [ ] **Step 2: Verify app still starts**

```bash
cd cap-iot && npm start 2>&1 | grep -E "server listening|error|Error" | head -10
```
Expected: `server listening on { url: 'http://localhost:4004' }`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove kafkajs dependency"
```

---

## Task 5: Upgrade Teams Notifications to Adaptive Cards with Tracking URL

**Files:**
- Modify: `cap-iot/srv/teams_notify.js`

- [ ] **Step 1: Replace teams_notify.js contents**

```js
const axios = require('axios');
const cds   = require('@sap/cds');

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mapsLink(lat, lng) {
    return lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '';
}

async function reverseGeocode(lat, lng) {
    if (!lat || !lng) return null;
    try {
        const googleApi = await cds.connect.to('GoogleAPI-SR');
        const res = await googleApi.send({ method: 'GET', path: `/maps/api/geocode/json?latlng=${lat},${lng}` });
        const results = res && res.results;
        return results && results[0] ? results[0].formatted_address : null;
    } catch (_) { return null; }
}

function adaptiveCard(body, actions) {
    return {
        type:        'message',
        attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type:    'AdaptiveCard',
                version: '1.4',
                body:    body,
                actions: actions || []
            }
        }]
    };
}

function factSet(facts) {
    return { type: 'FactSet', facts: facts.map(([t, v]) => ({ title: t, value: v || '—' })) };
}

const MESSAGES = {
    ASSIGNED: (d) => adaptiveCard([
        { type: 'TextBlock', text: '🚚 Driver Assigned', weight: 'Bolder', size: 'Medium', color: 'Accent' },
        { type: 'TextBlock', text: `Delivery **${d.DeliveryDocument}**`, wrap: true },
        factSet([
            ['Truck',          d.TruckRegistration],
            ['Driver',         d.DriverName || d.MobileNumber],
            ['Mobile',         d.MobileNumber],
            ['Est. Distance',  d.EstimatedDistance],
            ['Est. Duration',  d.EstimatedDuration],
            ['Assigned At',    fmtDate(d.AssignedAt)]
        ]),
        d.TrackingUrl ? {
            type: 'TextBlock',
            text: `📱 **Customer tracking link:** [Track Delivery](${d.TrackingUrl})`,
            wrap: true,
            spacing: 'Medium'
        } : null
    ].filter(Boolean), [
        d.TrackingUrl ? { type: 'Action.OpenUrl', title: 'Open Tracking Page', url: d.TrackingUrl } : null
    ].filter(Boolean)),

    LOCATION: (d) => adaptiveCard([
        { type: 'TextBlock', text: '📍 Location Update', weight: 'Bolder', size: 'Medium', color: 'Warning' },
        { type: 'TextBlock', text: `**${d.TruckRegistration || d.MobileNumber}** — Delivery **${d.DeliveryDocument}**`, wrap: true },
        factSet([
            ['Address',      d.Address],
            ['Coordinates',  `${d.Latitude}, ${d.Longitude}`],
            ['Speed',        d.Speed ? `${(d.Speed * 3.6).toFixed(0)} km/h` : null],
            ['Recorded At',  fmtDate(d.RecordedAt)]
        ])
    ], [
        d.Latitude ? { type: 'Action.OpenUrl', title: 'View on Google Maps', url: mapsLink(d.Latitude, d.Longitude) } : null
    ].filter(Boolean)),

    DELIVERED: (d) => adaptiveCard([
        { type: 'TextBlock', text: '✅ Delivery Complete', weight: 'Bolder', size: 'Medium', color: 'Good' },
        { type: 'TextBlock', text: `Delivery **${d.DeliveryDocument}** received by customer **${d.ShipToParty || '—'}**`, wrap: true },
        factSet([
            ['Truck',         d.TruckRegistration],
            ['Driver',        d.DriverName || d.MobileNumber],
            ['Customer',      d.ShipToParty],
            ['Delivered At',  fmtDate(d.DeliveredAt)],
            ['Final GPS',     d.LastLat && d.LastLng ? `${d.LastLat}, ${d.LastLng}` : null]
        ])
    ], [
        d.LastLat ? { type: 'Action.OpenUrl', title: 'View Delivery Location', url: mapsLink(d.LastLat, d.LastLng) } : null
    ].filter(Boolean))
};

module.exports = {
    async post(event, data) {
        const url = process.env.TEAMS_WEBHOOK_URL;
        if (!url) { console.warn('TEAMS_WEBHOOK_URL not set — skipping Teams notification'); return; }
        const cardFn = MESSAGES[event];
        if (!cardFn) { console.warn(`Unknown Teams event type: ${event}`); return; }
        try {
            if (event === 'LOCATION' && data.Latitude && data.Longitude)
                data.Address = await reverseGeocode(data.Latitude, data.Longitude);
            await axios.post(url, cardFn(data));
        } catch (err) {
            console.error('Teams notification failed:', err.message);
        }
    }
};
```

- [ ] **Step 2: Test locally — post a test ASSIGNED card**

```bash
cd cap-iot && node -e "
const t = require('./srv/teams_notify');
t.post('ASSIGNED', {
  DeliveryDocument: 'TEST001',
  TruckRegistration: 'MH12AB1234',
  DriverName: 'Test Driver',
  MobileNumber: '+919999999999',
  EstimatedDistance: '25 km',
  EstimatedDuration: '45 min',
  AssignedAt: new Date().toISOString(),
  TrackingUrl: 'https://example.com/tracking/index.html#test'
}).then(() => console.log('sent')).catch(console.error);
"
```
Expected: Teams channel shows Adaptive Card with tracking URL button. If `TEAMS_WEBHOOK_URL` not set locally, expect `TEAMS_WEBHOOK_URL not set` log — that's fine.

- [ ] **Step 3: Commit**

```bash
git add srv/teams_notify.js
git commit -m "feat: upgrade Teams notifications to Adaptive Cards with tracking URL in ASSIGNED alert"
```

---

## Task 6: Update Fiori Assign Driver Dialog — Value Help + Driver Name

**Files:**
- Modify: `cap-iot/app/deliveries/webapp/ext/fragment/DriverAssign.fragment.xml`
- Modify: `cap-iot/app/deliveries/webapp/ext/fragment/DriverAssign.js`

- [ ] **Step 1: Replace DriverAssign.fragment.xml**

```xml
<core:FragmentDefinition
    xmlns:core="sap.ui.core"
    xmlns="sap.m">

    <Dialog id="driverAssignDialog"
            title="Assign Driver"
            contentWidth="420px">

        <VBox id="assignForm" class="sapUiSmallMargin">
            <Label text="Mobile Number" required="true" class="sapUiTinyMarginBottom"/>
            <ComboBox id="inputMobile"
                      placeholder="Select or type mobile number"
                      selectionChange=".onDriverSelect"
                      class="sapUiSmallMarginBottom"
                      width="100%"/>
            <Label text="Driver Name" class="sapUiTinyMarginBottom"/>
            <Input id="inputDriverName"
                   placeholder="e.g. John Smith"
                   class="sapUiSmallMarginBottom"/>
            <Label text="Truck Registration" class="sapUiTinyMarginBottom"/>
            <Input id="inputTruckReg"
                   placeholder="e.g. MH12AB1234 (optional)"
                   class="sapUiSmallMarginBottom"/>
            <MessageStrip id="assignErrorStrip" visible="false" type="Error"
                          showCloseButton="false" class="sapUiTinyMarginBottom"/>
        </VBox>

        <VBox id="qrSection" visible="false" class="sapUiSmallMargin" alignItems="Center">
            <Text id="qrLabel" text="Scan QR code to start tracking:"
                  class="sapUiTinyMarginBottom"/>
            <core:HTML id="qrImageHtml" content="&lt;span&gt;&lt;/span&gt;"/>
        </VBox>

        <beginButton>
            <Button id="btnAssign"
                    text="Assign"
                    type="Emphasized"
                    press=".onAssign"/>
        </beginButton>
        <endButton>
            <Button text="Close" press=".onCloseDialog"/>
        </endButton>
    </Dialog>
</core:FragmentDefinition>
```

- [ ] **Step 2: Replace DriverAssign.js**

```js
sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/Item"
], function (MessageToast, Fragment, JSONModel, Item) {
    "use strict";

    var _dialog      = null;
    var _deliveryDoc = null;
    var _drivers     = [];

    function _byId(sId) {
        return Fragment.byId("driverAssignFrag", sId);
    }

    var handler = {

        openDialog: function (deliveryDoc, existingQrImage) {
            _deliveryDoc = deliveryDoc;
            handler._getDialog().then(function (oDialog) {
                handler._resetForm();
                if (existingQrImage) {
                    handler._showQR(existingQrImage);
                } else {
                    var assignForm = _byId("assignForm");
                    var qrSection  = _byId("qrSection");
                    var btnAssign  = _byId("btnAssign");
                    if (assignForm) assignForm.setVisible(true);
                    if (qrSection)  qrSection.setVisible(false);
                    if (btnAssign)  { btnAssign.setVisible(true); btnAssign.setEnabled(true); }
                }
                handler._loadDrivers();
                oDialog.open();
            });
        },

        _resetForm: function () {
            var fields = ["inputMobile", "inputDriverName", "inputTruckReg", "assignErrorStrip"];
            fields.forEach(function (id) {
                var el = _byId(id);
                if (!el) return;
                if (id === "assignErrorStrip") el.setVisible(false);
                else if (el.setValue) el.setValue("");
                else if (el.clearSelection) el.clearSelection();
            });
        },

        _loadDrivers: function () {
            fetch("/odata/v4/tracking/Driver?$select=MobileNumber,DriverName,TruckRegistration&$filter=IsActive eq true&$orderby=DriverName", {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(function (res) { return res.json(); })
            .then(function (data) {
                _drivers = (data && data.value) || [];
                var oCombo = _byId("inputMobile");
                if (!oCombo) return;
                oCombo.destroyItems();
                _drivers.forEach(function (d) {
                    oCombo.addItem(new Item({
                        key:  d.MobileNumber,
                        text: d.MobileNumber + (d.DriverName ? " — " + d.DriverName : "")
                    }));
                });
            }).catch(function () { /* value help is best-effort */ });
        },

        onDriverSelect: function (oEvent) {
            var mobile  = oEvent.getParameter("selectedItem") && oEvent.getParameter("selectedItem").getKey();
            var driver  = _drivers.find(function (d) { return d.MobileNumber === mobile; });
            if (!driver) return;
            var inputName  = _byId("inputDriverName");
            var inputTruck = _byId("inputTruckReg");
            if (inputName  && driver.DriverName)        inputName.setValue(driver.DriverName);
            if (inputTruck && driver.TruckRegistration) inputTruck.setValue(driver.TruckRegistration);
        },

        onAssign: function () {
            var oCombo   = _byId("inputMobile");
            var mobile   = oCombo ? (oCombo.getValue ? oCombo.getValue().trim() : "") : "";
            var name     = _byId("inputDriverName") ? _byId("inputDriverName").getValue().trim() : "";
            var truck    = _byId("inputTruckReg")   ? _byId("inputTruckReg").getValue().trim()   : "";

            if (!mobile) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText("Mobile Number is required."); strip.setVisible(true); }
                return;
            }

            var btnAssign = _byId("btnAssign");
            if (btnAssign) btnAssign.setEnabled(false);

            fetch("/odata/v4/tracking/assignDriver", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Basic " + btoa("alice:alice") },
                body:    JSON.stringify({
                    deliveryDoc:       _deliveryDoc,
                    mobileNumber:      mobile,
                    truckRegistration: truck || null,
                    driverName:        name || null
                })
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw new Error((data && data.error && data.error.message) || "Assignment failed");
                    return data;
                });
            }).then(function (assignment) {
                handler._showQR(assignment.QRCodeImage);
            }).catch(function (err) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText(err.message || "Failed to assign driver"); strip.setVisible(true); }
                if (btnAssign) btnAssign.setEnabled(true);
            });
        },

        _showQR: function (base64Image) {
            var assignForm = _byId("assignForm");
            var qrSection  = _byId("qrSection");
            var btnAssign  = _byId("btnAssign");
            var qrHtml     = _byId("qrImageHtml");
            if (assignForm) assignForm.setVisible(false);
            if (qrSection)  qrSection.setVisible(true);
            if (btnAssign)  btnAssign.setVisible(false);
            if (qrHtml && base64Image)
                qrHtml.setContent('<img src="' + base64Image + '" style="width:200px;height:200px;"/>');
        },

        onCloseDialog: function () {
            handler._getDialog().then(function (d) { d.close(); });
        },

        _getDialog: function () {
            if (_dialog) return Promise.resolve(_dialog);
            return Fragment.load({
                id:         "driverAssignFrag",
                name:       "ewm.deliveries.ext.fragment.DriverAssign",
                controller: handler
            }).then(function (oDialog) {
                _dialog = oDialog;
                return oDialog;
            });
        }
    };

    return handler;
});
```

- [ ] **Step 3: Test locally**

```bash
cd cap-iot && npm start
# Open http://localhost:4004/gmaps/deliveries/index.html
# Open a delivery → click Assign Driver
# Expected: Mobile Number is a ComboBox dropdown (empty on first use)
# Type a mobile number + name + truck → click Assign → QR code appears
# Open again for same delivery → ComboBox shows the registered driver
```

- [ ] **Step 4: Commit**

```bash
git add app/deliveries/webapp/ext/fragment/DriverAssign.fragment.xml \
        app/deliveries/webapp/ext/fragment/DriverAssign.js
git commit -m "feat: add driver value help ComboBox and auto-fill truck/name in assign dialog"
```

---

## Task 7: Reset Local SQLite DB and Full Local Test

- [ ] **Step 1: Redeploy SQLite schema**

```bash
cd cap-iot && cds deploy --to sqlite
```
Expected: `Successfully deployed to db.sqlite` — new Driver and updated DriverAssignment tables created, GpsCoordinates dropped.

- [ ] **Step 2: Start and smoke test**

```bash
cd cap-iot && npm start
```

Test sequence:
```
1. GET http://localhost:4004/odata/v4/tracking/Driver
   Expected: { value: [] }  (empty, no drivers yet)

2. POST http://localhost:4004/odata/v4/tracking/assignDriver
   Body: { "deliveryDoc":"TEST001","mobileNumber":"+919999999999","truckRegistration":"MH12AB1234","driverName":"Test Driver" }
   Auth: Basic alice:alice
   Expected: 200, assignment object with QRCodeImage

3. GET http://localhost:4004/odata/v4/tracking/Driver
   Expected: { value: [{ MobileNumber: "+919999999999", DriverName: "Test Driver", TruckRegistration: "MH12AB1234" }] }

4. POST http://localhost:4004/odata/v4/tracking/updateLocation
   Body: { "assignmentId":"<ID from step 2>","latitude":18.5,"longitude":73.8,"speed":15 }
   Expected: true; DriverAssignment has StartLat=18.5, CurrentLat=18.5, Status=IN_TRANSIT

5. POST updateLocation again with lat=18.6
   Expected: CurrentLat=18.6, StartLat still 18.5

6. POST confirmDelivery with assignmentId
   Expected: Status=DELIVERED, EndLat=18.6

7. GET latestGps?assignmentId=<ID>
   Expected: { Latitude: 18.6, Longitude: 73.8 }
```

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add -A && git commit -m "fix: local smoke test fixes"
```

---

## Task 8: CDS Build + MTA Build + CF Deploy

- [ ] **Step 1: CDS production build**

```bash
cd cap-iot && npx cds build --production 2>&1 | tail -5
```
Expected: `build completed in Xms`

- [ ] **Step 2: MTA build**

```bash
mbt build --mtar archive 2>&1 | tail -5
```
Expected: `the MTA archive generated at: .../mta_archives/archive.mtar`

- [ ] **Step 3: CF deploy**

```bash
cf deploy mta_archives/archive.mtar --retries 1 2>&1 | tail -10
```
Expected: `Process finished.` — both `gmaps-app-srv` and `gmaps-app-approuter` started.

- [ ] **Step 4: Verify apps running**

```bash
cf apps
```
Expected:
```
gmaps-app-srv        started   1/1
gmaps-app-approuter  started   1/1
```

- [ ] **Step 5: Check logs for Kafka errors (should be gone)**

```bash
cf logs gmaps-app-srv --recent 2>&1 | grep -i kafka
```
Expected: no output — Kafka is gone.

- [ ] **Step 6: Check Event Mesh emit in logs**

```bash
cf logs gmaps-app-srv --recent 2>&1 | grep -i "event\|emit\|messaging" | head -10
```
Expected: `connect to messaging > enterprise-messaging` on startup.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: phase 2 complete — Event Mesh, Driver master data, Adaptive Cards deployed to CF"
git push origin feature_odo_iot_teams_agents
```

---

## Task 9: Post-Deploy CF Env Vars Check

- [ ] **Step 1: Verify existing env vars still set**

```bash
cf env gmaps-app-srv | grep -E "TEAMS_WEBHOOK_URL|GPS_POLL_INTERVAL_MS|APP_BASE_URL"
```
Expected: all three show values. If any missing, set them:
```bash
cf set-env gmaps-app-srv TEAMS_WEBHOOK_URL "<url>"
cf set-env gmaps-app-srv GPS_POLL_INTERVAL_MS 60000
cf set-env gmaps-app-srv APP_BASE_URL "https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-approuter.cfapps.us10.hana.ondemand.com"
cf restage gmaps-app-srv
```

- [ ] **Step 2: CF smoke test — assign driver**

```bash
curl -X POST \
  "https://s4hanad-s-sap-build-training-hcd2uswp-dev-gmaps-app-srv.cfapps.us10.hana.ondemand.com/odata/v4/tracking/assignDriver" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"deliveryDoc":"TEST001","mobileNumber":"+919999999999","truckRegistration":"MH12AB1234","driverName":"Test Driver"}'
```
Expected: 200 with assignment + QRCodeImage. Teams channel shows Adaptive Card with tracking URL.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Event Mesh — `cds.emit` in Task 3, topic per delivery
- ✅ GPS simplification — StartLat/CurrentLat/EndLat on DriverAssignment, Tasks 1+3
- ✅ Driver master data — Task 1 (schema) + Task 3 (auto-register logic)
- ✅ Value help — Task 6 (ComboBox + auto-fill)
- ✅ Teams Adaptive Cards — Task 5
- ✅ Tracking URL in ASSIGNED card — Task 5
- ✅ Remove Kafka — Tasks 3+4
- ✅ CF deploy — Task 8

**No placeholders:** all steps have complete code.

**Type consistency:** `EventTopic` used consistently in schema (Task 1) and JS (Task 3). `latestGps` returns inline type matching Task 3 handler. `driverName` parameter added in both CDS (Task 2) and JS (Task 3).
