# CAP Google Maps + EWM IoT Driver Tracking

## Overview

SAP Cloud Application Programming Model (CAP) project integrating **Google Maps**, **SAP EWM Outbound Deliveries**, and **real-time IoT driver tracking** into Fiori Elements applications. Dispatchers manage deliveries, assign drivers, and track GPS live on a map — with Kafka event streaming and MS Teams notifications.

### Business Scenario

1. Dispatcher views outbound deliveries from SAP EWM
2. Clicks "View on Map" to see the Google Maps route (origin/destination resolved from Business Partner addresses)
3. Assigns a driver (mobile + truck) — QR code generated
4. Driver scans QR on mobile phone — GPS tracking starts automatically via browser Geolocation API
5. Truck marker appears live on the Fiori map (30s polling)
6. Teams channel receives rich notifications: assignment, location updates, delivery confirmation
7. Driver confirms delivery on mobile — tracking stops, Kafka topic cleaned up

---

## Features

| Feature | Description |
|---------|-------------|
| **EWM Delivery List** | Proxied from SAP EWM sandbox API, cached in local SQLite/HANA |
| **Google Maps Routes** | Directions API called from CAP, polyline + markers rendered in Fiori custom section |
| **Turn-by-Turn Directions** | Step-by-step navigation stored as RouteSteps, shown in IconTabBar |
| **Driver Assignment** | Header action dialog with QR code generation (qrcode npm, pure Node.js) |
| **Mobile Tracking Page** | UI5 ObjectPageLayout (sap.uxap) — GPS + Simulate GPS + Confirm Delivery |
| **Live Truck Marker** | Polls latestGps every 30s, renders moving marker on Google Maps |
| **Kafka Event Stream** | Per-delivery topic (`gps-{doc}`), KRaft Docker (no ZooKeeper) |
| **MS Teams Notifications** | Rich MessageCards for ASSIGNED, LOCATION, DELIVERED events |
| **Close Trip** | Dispatcher or driver can mark delivery complete, reassign drivers |
| **SAP Event Mesh** | Enterprise messaging configured for production (replaces Docker Kafka) |

---

## Architecture

```
Fiori Elements (UI5 1.144, sap_horizon)
  List Report → Object Page → Custom Sections (Map, Directions, Driver Assign)
       |
       | OData V4
       v
CAP Node.js Services
  EwmService      — READ proxy to SAP EWM + BP APIs, getDeliveryRoute, getDeliveryItems
  GmapsService    — getDirections, Routes/RouteDirections/RouteSteps CRUD
  TrackingService — assignDriver, updateLocation, confirmDelivery, latestGps
       |                    |                    |
  SAP Sandbox        Google Maps API        Kafka (KRaft) / Event Mesh
  (EWM + BP)         Directions API         MS Teams Webhook
                                            Mobile Browser (GPS)
```

### Data Model

```
gmaps_schema:
  Routes ←── RouteDirections ──→ RouteSteps
  OutboundDeliveries ──→ DeliveryItems

iot_schema:
  DriverAssignment ──→ GpsCoordinates
```

---

## Prerequisites

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18.x / 20.x | Runtime |
| @sap/cds-dk | 9.x | CAP development tools |
| Docker | Latest | Kafka (local dev) |
| CF CLI | Latest | Cloud Foundry deployment |
| MBT | 1.2+ | MTA build tool |

### API Keys & Services

| Key | Where | Purpose |
|-----|-------|---------|
| `GOOGLE_MAPS_API_KEY` | `.env` | Google Maps Directions + JavaScript API |
| `SAP_SANDBOX_API_KEY` | `.env` | SAP API Business Hub sandbox (EWM + BP) |
| `KAFKA_BROKER` | `.env` | Kafka broker address (default: `localhost:9092`) |
| `TEAMS_WEBHOOK_URL` | `.env` | MS Teams Incoming Webhook URL |
| `APP_BASE_URL` | `.env` | Base URL for QR codes (default: `http://localhost:4004`) |

---

## Getting Started

### 1. Install and run

```bash
npm install
cds deploy --to sqlite
cds watch
```

Server starts at **http://localhost:4004**

### 2. Start Kafka (optional, for GPS event streaming)

```bash
docker compose up -d
```

### 3. Open the apps

| App | URL |
|-----|-----|
| Routes (Google Maps) | http://localhost:4004/routes.routes/webapp/index.html |
| Deliveries (EWM + IoT) | http://localhost:4004/ewm.deliveries/webapp/index.html |
| Driver Tracking (Mobile) | http://localhost:4004/tracking/index.html#{assignmentId} |
| OData EWM Service | http://localhost:4004/odata/v4/ewm/ |
| OData Tracking Service | http://localhost:4004/odata/v4/tracking/ |
| OData Maps Service | http://localhost:4004/odata/v4/gmaps/ |

---

## Project Structure

```
922_CAP_GMaps/
├── app/
│   ├── deliveries/              # Fiori Elements — EWM Deliveries + Driver Tracking
│   │   ├── annotations.cds
│   │   ├── webapp/
│   │   │   ├── ext/controller/ObjectPageExt.js    # Header actions (Assign, QR, Close Trip)
│   │   │   ├── ext/fragment/DeliveryMap.js         # Google Maps + truck marker polling
│   │   │   ├── ext/fragment/DriverAssign.js        # Assignment dialog + QR display
│   │   │   └── manifest.json
│   │   ├── ui5-deploy.yaml      # CF build config
│   │   └── xs-app.json          # HTML5 repo routing
│   ├── routes/                  # Fiori Elements — Route Directions
│   │   └── webapp/ext/fragment/DisplayGmap.js
│   ├── tracking/                # Mobile tracking page (UI5 ObjectPageLayout)
│   │   └── index.html
│   ├── router/                  # Approuter
│   │   └── xs-app.json
│   └── services.cds
├── db/
│   ├── gmaps_schema.cds         # Routes, RouteDirections, RouteSteps, OutboundDeliveries
│   └── iot_schema.cds           # DriverAssignment, GpsCoordinates
├── srv/
│   ├── ewm_srv.cds / .js       # EWM service (proxied READ, getDeliveryRoute, getDeliveryItems)
│   ├── gmap_srv.cds / .js       # Google Maps service (getDirections)
│   ├── tracking_srv.cds / .js   # IoT tracking (assignDriver, updateLocation, confirmDelivery)
│   ├── kafka_producer.js        # KafkaJS producer (createTopic, publish, deleteTopic)
│   ├── kafka_consumer.js        # KafkaJS consumer (GPS ingestion, 5-min Teams timer)
│   └── teams_notify.js          # MS Teams webhook (rich MessageCard format)
├── docs/
│   └── cap-iot-tracking-patterns.md  # Architecture & patterns reference
├── mta.yaml                     # BTP Cloud Foundry deployment descriptor
├── xs-security.json             # XSUAA scopes + Enterprise Messaging authorities
├── event-mesh.json              # SAP Event Mesh configuration
├── docker-compose.yml           # Kafka KRaft (local dev)
├── package.json                 # CDS config, scripts, dependencies
└── CLAUDE.md                    # AI assistant project guidelines
```

---

## OData Services

### EwmService (`/odata/v4/ewm/`)

| Endpoint | Type | Description |
|----------|------|-------------|
| `OutboundDeliveries` | Entity | EWM deliveries (proxied from SAP sandbox, cached locally) |
| `DeliveryItems` | Entity | Line items per delivery |
| `RouteDirections` | Entity | Google Maps route data |
| `DriverAssignments` | Entity | Active driver assignments |
| `getDeliveryRoute(deliveryDoc)` | Action | Fetch Google Maps route for a delivery |
| `getDeliveryItems(deliveryDoc)` | Action | Fetch line items from EWM |

### TrackingService (`/odata/v4/tracking/`)

| Endpoint | Type | Auth | Description |
|----------|------|------|-------------|
| `DriverAssignment` | Entity | Authenticated | Assignment records |
| `GpsCoordinates` | Entity | Authenticated | GPS ping history |
| `assignDriver(...)` | Action | gmaps_user | Create assignment + QR code |
| `getQRCode(deliveryDoc)` | Action | gmaps_user | Retrieve active assignment QR |
| `updateLocation(...)` | Action | Any (UUID secret) | Driver pushes GPS ping |
| `confirmDelivery(assignmentId)` | Action | Any (UUID secret) | Mark delivery complete |
| `latestGps(assignmentId)` | Function | Any (UUID secret) | Latest GPS position |

### GmapsService (`/odata/v4/gmaps/`)

| Endpoint | Type | Description |
|----------|------|-------------|
| `Routes` | Entity | Route master data |
| `RouteDirections` | Entity | Directions with bounds, polyline, rawData |
| `RouteSteps` | Entity | Turn-by-turn steps |
| `getDirections(from, to)` | Action | Call Google Maps API, persist results |

---

## Deployment (BTP Cloud Foundry)

### BTP Services Required

| Service | Plan | MTA Resource Name | Purpose |
|---------|------|-------------------|---------|
| HANA | hdi-shared | gmaps-app-db | Database |
| XSUAA | application | gmaps-app-uaa | Authentication |
| Destination | lite | gmaps-app-destination | External API routing |
| HTML5 Repo | app-host | gmaps-app-repo-host | Fiori app hosting |
| Enterprise Messaging | default | gmaps-app-messaging | Event streaming (prod Kafka) |

### BTP Destinations to Configure

| Destination Name | URL | Purpose |
|-----------------|-----|---------|
| `GoogleAPI-SR` | `https://maps.googleapis.com` | Google Maps API (add API key as URL.queries.key) |
| `EWM-API` | SAP EWM system URL | EWM Outbound Deliveries |
| `BP-API` | SAP S/4HANA URL | Business Partner addresses |

### Build and Deploy

```bash
# Build MTA archive
npm run build

# Deploy to Cloud Foundry
npm run deploy

# Verify
cf apps
cf services
cf logs gmaps-app-srv --recent
```

### Undeploy

```bash
npm run undeploy
```

---

## Configuration

### Local vs Production

| Config | Local Dev | Production (CF) |
|--------|-----------|-----------------|
| Database | SQLite (`db.sqlite`) | SAP HANA (HDI container) |
| Auth | Mocked (user `alice`, role `gmaps_user`) | XSUAA |
| Google Maps | Direct URL + env var API key | BTP Destination `GoogleAPI-SR` |
| EWM / BP | SAP sandbox API (`api.sap.com`) | BTP Destination `EWM-API` / `BP-API` |
| Messaging | Docker Kafka (KafkaJS) | SAP Event Mesh |
| Teams | Incoming Webhook URL | Same (or Power Automate) |

---

## Mobile Testing

**Same WiFi (no HTTPS needed for localhost):**
```bash
APP_BASE_URL=http://192.168.x.x:4004 cds watch
```

**ngrok (HTTPS, required for GPS on some browsers):**
```bash
ngrok http 4004
# Set APP_BASE_URL=https://xxxx.ngrok-free.app in .env
```

---

## Phase 3 (Planned): Teams Chatbot

Natural language interface using **SAP AI Core + Generative AI Hub + LangGraph** for dispatchers to manage deliveries via Teams chat. See [docs/cap-iot-tracking-patterns.md](docs/cap-iot-tracking-patterns.md) for full design.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | SAP CAP (Node.js), CDS, OData V4 |
| Frontend | SAP UI5 1.144, Fiori Elements v4, sap.uxap.ObjectPageLayout |
| Maps | Google Maps JavaScript API, Directions API |
| Database | SQLite (dev), SAP HANA (prod) |
| Auth | XSUAA, mocked auth (dev) |
| Messaging | KafkaJS + Docker KRaft (dev), SAP Event Mesh (prod) |
| Notifications | MS Teams Incoming Webhook (MessageCard) |
| Mobile GPS | Browser Geolocation API (navigator.geolocation) |
| QR Code | qrcode npm (pure Node.js, base64 PNG) |
| Deployment | MTA, Cloud Foundry, BTP |

---

**Version:** 2.0
**Last Updated:** 17 April 2026
**Branch:** main (merged from feature2_gmap_iot)
