# Detailed Design Document (DDD)
# CAP Google Maps Integration Project

**Version:** 1.0  
**Date:** 29 January 2026  
**Author:** Development Team  
**Status:** Production Ready

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Data Model Design](#3-data-model-design)
4. [Service Layer Design](#4-service-layer-design)
5. [UI Layer Design](#5-ui-layer-design)
6. [Integration Design](#6-integration-design)
7. [Security Design](#7-security-design)
8. [Performance Considerations](#8-performance-considerations)
9. [Deployment Architecture](#9-deployment-architecture)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Testing Strategy](#11-testing-strategy)
12. [Appendices](#12-appendices)

---

## 1. Executive Summary

### 1.1 Purpose
This document provides a comprehensive technical design for integrating Google Maps JavaScript API into a SAP Cloud Application Programming Model (CAP) application with Fiori Elements UI to visualize route directions and navigation steps.

### 1.2 Scope
- Display route directions from Google Maps Directions API
- Visualize individual route steps on an interactive map
- Provide automatic map loading with retry mechanisms
- Support manual refresh capabilities
- Handle errors gracefully with user feedback

### 1.3 Key Technologies
- **Backend:** SAP CAP (Node.js runtime)
- **Frontend:** SAP Fiori Elements (UI5 1.144.0)
- **Database:** SQLite (dev), SAP HANA (production)
- **External API:** Google Maps JavaScript API v3
- **Protocol:** OData V4

### 1.4 System Context

```
┌─────────────┐
│   User      │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────────────────┐
│   Fiori Elements UI                 │
│   - List Pages (RouteDirections)    │
│   - Object Pages (RouteSteps)       │
│   - Custom Map Fragment             │
└──────┬──────────────────────────────┘
       │ OData V4
       ▼
┌─────────────────────────────────────┐
│   CAP Service Layer                 │
│   - GmapsService (OData)            │
│   - Business Logic Handlers         │
└──────┬──────────────────────────────┘
       │
       ├──────────┐
       │          │
       ▼          ▼
┌──────────┐  ┌──────────────────┐
│ SQLite/  │  │ Google Maps API  │
│  HANA    │  │ (REST/JavaScript)│
└──────────┘  └──────────────────┘
```

---

## 2. System Architecture

### 2.1 Architectural Pattern

The application follows the **Multi-Tier Architecture** pattern:

1. **Presentation Layer:** SAP Fiori Elements with custom fragments
2. **Service Layer:** CAP OData services
3. **Business Logic Layer:** CAP service handlers
4. **Data Access Layer:** CDS entities with SQLite/HANA
5. **Integration Layer:** Google Maps API client

### 2.2 Component Diagram

```
┌───────────────────────────────────────────────────────────┐
│                    Presentation Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ List Pages   │  │ Object Pages │  │ Custom Fragments│ │
│  │ (Standard)   │  │ (Standard +  │  │ (DisplayGmap)   │ │
│  │              │  │  Custom)     │  │                 │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘ │
└─────────┼──────────────────┼───────────────────┼──────────┘
          │                  │                   │
          │   OData V4       │                   │ Google Maps
          │   Binding        │                   │ JavaScript API
          │                  │                   │
┌─────────▼──────────────────▼───────────────────▼──────────┐
│                     Service Layer                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              GmapsService (OData V4)                  │ │
│  │  - RouteDirections (Entity Set)                      │ │
│  │  - RouteSteps (Entity Set)                           │ │
│  └────────────────────┬─────────────────────────────────┘ │
│                       │                                    │
│  ┌────────────────────▼─────────────────────────────────┐ │
│  │          Business Logic Handlers (gmap_srv.js)       │ │
│  │  - Data validation                                   │ │
│  │  - External API integration                          │ │
│  └────────────────────┬─────────────────────────────────┘ │
└───────────────────────┼────────────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │                            │
┌─────────▼──────────┐      ┌─────────▼──────────────┐
│  Data Access Layer │      │  Integration Layer      │
│  ┌──────────────┐  │      │  ┌──────────────────┐  │
│  │ CDS Entities │  │      │  │ Google Maps REST │  │
│  │ - Route      │  │      │  │ API Client       │  │
│  │ - Steps      │  │      │  └──────────────────┘  │
│  └──────┬───────┘  │      └────────────────────────┘
│         │          │
│  ┌──────▼───────┐  │
│  │ SQLite/HANA  │  │
│  └──────────────┘  │
└────────────────────┘
```

### 2.3 Technology Stack Details

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Frontend Framework** | SAPUI5 | 1.144.0 | UI rendering |
| **UI Pattern** | Fiori Elements | V4 | Standard UI patterns |
| **Backend Framework** | @sap/cds | 9.6.4 | Service orchestration |
| **Runtime** | Node.js | 18+ | Server execution |
| **Database (Dev)** | SQLite | 3.x | Local data storage |
| **Database (Prod)** | SAP HANA | Cloud | Production data storage |
| **Protocol** | OData | V4 | API standard |
| **Map API** | Google Maps | JavaScript V3 | Map visualization |
| **Build Tool** | Cloud MTA Build Tool | Latest | Deployment packaging |

---

## 3. Data Model Design

### 3.1 Entity Relationship Diagram

```
┌────────────────────────────┐
│    RouteDirections         │
│    (Master Entity)         │
├────────────────────────────┤
│ PK: route_ID (UUID)        │
│     origin                 │
│     destination            │
│     distance               │
│     duration               │
│     bounds_northeast_lat   │
│     bounds_northeast_lng   │
│     bounds_southwest_lat   │
│     bounds_southwest_lng   │
└─────────┬──────────────────┘
          │ 1
          │
          │ Composition
          │
          │ *
┌─────────▼──────────────────┐
│    RouteSteps              │
│    (Detail Entity)         │
├────────────────────────────┤
│ PK: ID (UUID)              │
│ FK: route_ID               │
│     stepNumber             │
│     instruction (HTML)     │
│     distance               │
│     duration               │
│     startLat               │
│     startLng               │
│     endLat                 │
│     endLng                 │
│     travelMode             │
│     maneuver               │
└────────────────────────────┘
```

### 3.2 CDS Entity Definitions

**File:** `db/gmaps_schema.cds`

```cds
namespace gmaps.db;

using { cuid, managed } from '@sap/cds/common';

// Master entity for route information
entity RouteDirections : cuid, managed {
    origin                  : String(500);    // Start address
    destination             : String(500);    // End address
    distance                : String(50);     // Total distance
    duration                : String(50);     // Total duration
    
    // Bounding box for entire route
    bounds_northeast_lat    : Double;
    bounds_northeast_lng    : Double;
    bounds_southwest_lat    : Double;
    bounds_southwest_lng    : Double;
    
    // Composition: one route has many steps
    steps                   : Composition of many RouteSteps 
                              on steps.route = $self;
}

// Detail entity for individual navigation steps
entity RouteSteps : cuid, managed {
    route                   : Association to RouteDirections;
    stepNumber              : Integer;        // Sequence number
    instruction             : String(5000);   // HTML navigation instruction
    distance                : String(50);     // Step distance
    duration                : String(50);     // Step duration
    
    // Geographic coordinates
    startLat                : Double;         // Start latitude
    startLng                : Double;         // Start longitude
    endLat                  : Double;         // End latitude
    endLng                  : Double;         // End longitude
    
    // Navigation metadata
    travelMode              : String(20);     // DRIVING, WALKING, etc.
    maneuver                : String(50);     // turn-left, turn-right, etc.
}
```

### 3.3 Data Types and Constraints

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `route_ID` | UUID | PK, NOT NULL | Primary key (auto-generated) |
| `origin` | String(500) | NOT NULL | Full origin address |
| `destination` | String(500) | NOT NULL | Full destination address |
| `startLat/endLat` | Double | Range: -90 to 90 | Latitude coordinates |
| `startLng/endLng` | Double | Range: -180 to 180 | Longitude coordinates |
| `stepNumber` | Integer | > 0 | Sequential step order |
| `instruction` | String(5000) | HTML content | Rich text navigation |

### 3.4 Indexing Strategy

```sql
-- Recommended indexes for production
CREATE INDEX idx_routesteps_route ON RouteSteps(route_ID);
CREATE INDEX idx_routesteps_stepnum ON RouteSteps(stepNumber);
CREATE INDEX idx_routedirections_created ON RouteDirections(createdAt);
```

---

## 4. Service Layer Design

### 4.1 Service Definition

**File:** `srv/gmap_srv.cds`

```cds
using gmaps.db from '../db/gmaps_schema';

service GmapsService {
    entity RouteDirections as projection on db.RouteDirections;
    entity RouteSteps as projection on db.RouteSteps;
}
```

### 4.2 Service Handler Architecture

**File:** `srv/gmap_srv.js`

```javascript
// Service lifecycle hooks
module.exports = (srv) => {
    
    // Before CREATE validation
    srv.before('CREATE', 'RouteSteps', async (req) => {
        // Validate coordinates
        validateCoordinates(req.data);
    });
    
    // After READ enrichment
    srv.after('READ', 'RouteSteps', async (steps) => {
        // Additional data enrichment if needed
    });
};
```

### 4.3 OData Operations Supported

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| **Query Collection** | `GET /odata/v4/gmaps/RouteDirections` | List all routes |
| **Query Single** | `GET /odata/v4/gmaps/RouteDirections(guid)` | Get route by ID |
| **Expand** | `GET /RouteDirections?$expand=steps` | Get route with steps |
| **Filter** | `GET /RouteSteps?$filter=stepNumber eq 1` | Filter steps |
| **Select** | `GET /RouteSteps?$select=startLat,startLng` | Specific fields |
| **Count** | `GET /RouteSteps/$count` | Count steps |
| **Batch** | `POST /odata/v4/gmaps/$batch` | Multiple operations |

### 4.4 Service Response Format

```json
{
  "@odata.context": "$metadata#RouteSteps/$entity",
  "ID": "e4d2a904-a2a5-4222-b022-bdb93bf4f7d3",
  "stepNumber": 1,
  "instruction": "Head north on Main St",
  "distance": "0.2 km",
  "duration": "1 min",
  "startLat": 40.7128,
  "startLng": -74.0060,
  "endLat": 40.7150,
  "endLng": -74.0060,
  "travelMode": "DRIVING",
  "maneuver": "turn-left"
}
```

---

## 5. UI Layer Design

### 5.1 UI Architecture

```
Fiori Elements App (Standard Pattern)
│
├── List Report Page (RouteDirections)
│   ├── Table/Grid Display
│   ├── Filters
│   └── Search
│
├── Object Page (RouteDirections)
│   ├── Header Facets
│   ├── Sections
│   └── Table (RouteSteps)
│
└── Object Page (RouteSteps)
    ├── Header Facets
    ├── Standard Sections
    └── Custom Section (Map Display) ← Custom Implementation
        ├── DisplayGmap.fragment.xml
        └── DisplayGmap.js
```

### 5.2 Custom Fragment Design

**File:** `app/routes/webapp/ext/fragment/DisplayGmap.fragment.xml`

```xml
<core:FragmentDefinition 
    xmlns:core="sap.ui.core" 
    xmlns="sap.m">
    
    <VBox id="mapContainer" 
          core:require="{ handler: 'routes/routes/ext/fragment/DisplayGmap'}">
        
        <!-- Title -->
        <Title text="Step Location on Map" 
               class="sapUiSmallMarginBottom"/>
        
        <!-- Coordinate Display -->
        <Text text="Start: {startLat}, {startLng} → End: {endLat}, {endLng}" 
              class="sapUiTinyMarginBottom"/>
        
        <!-- Map Container -->
        <VBox height="500px" width="100%">
            <core:HTML 
                content='&lt;div id="googleMap" ...&gt;...&lt;/div&gt;'
                afterRendering="handler.onMapContainerRendered"/>
        </VBox>
        
        <!-- Refresh Button -->
        <Button text="Refresh Map" 
                press="handler.onRefreshMap" 
                icon="sap-icon://refresh"/>
    </VBox>
</core:FragmentDefinition>
```

### 5.3 JavaScript Handler Design

**File:** `app/routes/webapp/ext/fragment/DisplayGmap.js`

#### 5.3.1 Class Structure

```javascript
sap.ui.define([
    "sap/m/MessageToast"
], function(MessageToast) {
    
    // Module-level state
    let googleMapsScriptLoaded = false;
    let googleMapsScriptLoading = false;
    const loadCallbacks = [];
    let autoLoadTriggered = false;
    
    const handler = {
        // API Script Loading
        loadGoogleMapsScript: function(apiKey) { },
        
        // Event Handlers
        onMapContainerRendered: function(oEvent) { },
        onRefreshMap: function(oEvent) { },
        
        // Rendering Logic
        renderMap: function(lat, lng, ...) { }
    };
    
    return handler;
});
```

#### 5.3.2 State Machine for Map Loading

```
┌─────────────┐
│   Initial   │
└──────┬──────┘
       │ afterRendering event
       ▼
┌─────────────────┐
│ Polling Context │ ← Retry up to 10 times
└──────┬──────────┘
       │ Context available
       ▼
┌─────────────────┐
│ Loading Script  │
└──────┬──────────┘
       │ Script loaded
       ▼
┌─────────────────┐
│ Rendering Map   │
└──────┬──────────┘
       │
       ▼
┌─────────────┐     ┌──────────┐
│   Success   │     │  Error   │
└─────────────┘     └──────────┘
```

#### 5.3.3 Polling Mechanism

```javascript
// Retry mechanism with exponential backoff concept
const attemptAutoLoad = () => {
    const oBindingContext = oSource.getBindingContext();
    
    if (!oBindingContext && retryCount < maxRetries) {
        retryCount++;
        setTimeout(attemptAutoLoad, 300); // Fixed 300ms retry
        return;
    }
    
    // Proceed with map loading...
};
```

### 5.4 Map Visualization Components

#### 5.4.1 Marker Configuration

| Marker | Color | Label | Icon URL | Purpose |
|--------|-------|-------|----------|---------|
| Start | Green | A | `green-dot.png` | Start point |
| End | Red | B | `red-dot.png` | End point |

#### 5.4.2 Polyline Configuration

```javascript
{
    path: [startPoint, endPoint],
    geodesic: true,              // Curve along Earth's surface
    strokeColor: "#4285F4",      // Google blue
    strokeOpacity: 0.8,
    strokeWeight: 4              // 4px width
}
```

#### 5.4.3 Info Window Content

```html
<div style="padding:5px;">
    <strong>End Point</strong><br/>
    Turn left onto Main St<br/>
    Distance: 0.2 km<br/>
    Duration: 1 min<br/>
    Lat: 40.715000<br/>
    Lng: -74.006000
</div>
```

---

## 6. Integration Design

### 6.1 Google Maps API Integration

#### 6.1.1 Script Loading Strategy

```javascript
// Dynamic script injection
const script = document.createElement("script");
script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async`;
script.async = true;
script.defer = true;

// Promise-based loading
return new Promise((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = (error) => reject(error);
    document.head.appendChild(script);
});
```

#### 6.1.2 API Key Management

| Environment | Storage Method | Access Pattern |
|-------------|---------------|----------------|
| Development | Hardcoded in JS | Direct string |
| Production | Environment Variable | `process.env.GMAPS_API_KEY` |
| BTP Cloud | User-Provided Service | Destination binding |

#### 6.1.3 API Call Flow

```
User Opens RouteStep Page
         ↓
Fragment afterRendering Event
         ↓
Handler: onMapContainerRendered()
         ↓
Polling: Get Binding Context (max 10 × 300ms)
         ↓
Extract Coordinates from RouteStep Entity
         ↓
Load Google Maps Script (if not loaded)
         ↓
Create Map Instance: new google.maps.Map()
         ↓
Add Markers: new google.maps.Marker() × 2
         ↓
Add Polyline: new google.maps.Polyline()
         ↓
Fit Bounds: map.fitBounds()
         ↓
Attach Event Listeners (marker clicks)
         ↓
Map Rendered Successfully
```

### 6.2 Data Flow Sequence

```
┌──────┐         ┌────────┐         ┌─────────┐         ┌──────────┐
│ User │         │  UI    │         │ Service │         │ Database │
└──┬───┘         └───┬────┘         └────┬────┘         └────┬─────┘
   │                 │                   │                    │
   │ 1. Open Step    │                   │                    │
   ├────────────────>│                   │                    │
   │                 │                   │                    │
   │                 │ 2. Request Data   │                    │
   │                 ├──────────────────>│                    │
   │                 │                   │                    │
   │                 │                   │ 3. Query Step      │
   │                 │                   ├───────────────────>│
   │                 │                   │                    │
   │                 │                   │ 4. Return Data     │
   │                 │                   │<───────────────────┤
   │                 │                   │                    │
   │                 │ 5. OData Response │                    │
   │                 │<──────────────────┤                    │
   │                 │                   │                    │
   │                 │ 6. Render Fragment│                    │
   │                 ├─┐                 │                    │
   │                 │ │                 │                    │
   │                 │<┘                 │                    │
   │                 │                   │                    │
   │                 │ 7. Load GMaps     │                    │
   │                 ├────────┐          │                    │
   │                 │        │          │                    │
   │                 │        │ 8. Script│                    │
   │                 │        └─────────>│ Google Maps CDN   │
   │                 │                   │                    │
   │                 │ 9. Render Map     │                    │
   │                 ├─┐                 │                    │
   │                 │ │                 │                    │
   │ 10. View Map    │<┘                 │                    │
   │<────────────────┤                   │                    │
```

---

## 7. Security Design

### 7.1 Authentication & Authorization

#### 7.1.1 Development Environment
```json
{
  "cds": {
    "requires": {
      "auth": {
        "kind": "mocked"
      }
    }
  }
}
```

#### 7.1.2 Production Environment
```json
{
  "cds": {
    "requires": {
      "auth": {
        "kind": "xsuaa"
      }
    }
  }
}
```

### 7.2 API Key Security

| Aspect | Development | Production |
|--------|------------|------------|
| **Storage** | Hardcoded (temporary) | Environment variable |
| **Restrictions** | None (testing) | Domain whitelist |
| **Rotation** | Manual | Automated CI/CD |
| **Exposure** | Console logging allowed | No logging |

### 7.3 Content Security Policy

```javascript
// Recommended CSP headers
{
  "script-src": "'self' https://maps.googleapis.com",
  "img-src": "'self' https://*.googleapis.com https://*.gstatic.com",
  "connect-src": "'self' https://maps.googleapis.com"
}
```

### 7.4 Input Validation

```javascript
// Coordinate validation
function validateCoordinates(lat, lng) {
    if (isNaN(lat) || lat < -90 || lat > 90) {
        throw new Error("Invalid latitude");
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
        throw new Error("Invalid longitude");
    }
}
```

---

## 8. Performance Considerations

### 8.1 Frontend Optimization

| Technique | Implementation | Impact |
|-----------|---------------|---------|
| **Lazy Loading** | Load Google Maps script only when needed | Faster initial page load |
| **Script Caching** | Global flag prevents duplicate loads | Reduces API calls |
| **Debouncing** | Prevent multiple simultaneous renders | Lower CPU usage |
| **DOM Reuse** | Update map instance instead of recreate | Smoother UX |

### 8.2 Backend Optimization

```javascript
// Database query optimization
SELECT {
    key ID,
    stepNumber,
    startLat, startLng,
    endLat, endLng,
    distance, duration
} FROM RouteSteps
WHERE route_ID = ?
ORDER BY stepNumber ASC;
```

### 8.3 Network Optimization

- **OData $select:** Request only required fields
- **Batch Requests:** Combine multiple queries
- **Compression:** Enable gzip for API responses
- **CDN:** Google Maps served from CDN

### 8.4 Memory Management

```javascript
// Cleanup on navigation away
window.addEventListener('beforeunload', () => {
    // Remove event listeners
    google.maps.event.clearInstanceListeners(map);
    // Clear references
    map = null;
});
```

---

## 9. Deployment Architecture

### 9.1 Development Environment

```
┌────────────────────────────┐
│   Developer Workstation    │
│                            │
│  ┌──────────────────────┐  │
│  │   Node.js Runtime    │  │
│  │   - cds watch        │  │
│  │   - Port 4004        │  │
│  └──────────────────────┘  │
│                            │
│  ┌──────────────────────┐  │
│  │   SQLite Database    │  │
│  │   - db.sqlite        │  │
│  └──────────────────────┘  │
│                            │
│  ┌──────────────────────┐  │
│  │   Web Browser        │  │
│  │   - localhost:4004   │  │
│  └──────────────────────┘  │
└────────────────────────────┘
```

### 9.2 Production Environment (SAP BTP)

```
┌─────────────────────────────────────────────────────┐
│             SAP Business Technology Platform         │
│                                                       │
│  ┌────────────────┐         ┌──────────────────┐    │
│  │   AppRouter    │ ──────> │  CAP Service     │    │
│  │   (NGINX)      │  Auth   │  (Node.js)       │    │
│  │   Port 443     │  Token  │                  │    │
│  └────────┬───────┘         └────────┬─────────┘    │
│           │                          │               │
│           │                          │               │
│  ┌────────▼───────┐         ┌────────▼─────────┐    │
│  │   XSUAA        │         │   SAP HANA       │    │
│  │   (OAuth)      │         │   (Database)     │    │
│  └────────────────┘         └──────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │       HTML5 Application Repository           │    │
│  │       (UI5 Static Resources)                 │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
         │
         │ HTTPS
         ▼
┌────────────────────┐
│  Google Maps API   │
│  (External)        │
└────────────────────┘
```

### 9.3 MTA Descriptor Structure

```yaml
# mta.yaml
_schema-version: '3.3'
ID: cap-gmaps-integration
version: 1.0.0

modules:
  # CAP Service
  - name: cap-gmaps-srv
    type: nodejs
    path: gen/srv
    
  # Database Deployer
  - name: cap-gmaps-db-deployer
    type: hdb
    path: gen/db
    
  # Fiori UI
  - name: cap-gmaps-ui
    type: html5
    path: app/routes
    
  # AppRouter
  - name: cap-gmaps-approuter
    type: nodejs
    path: app/router

resources:
  - name: cap-gmaps-db
    type: com.sap.xs.hdi-container
    
  - name: cap-gmaps-xsuaa
    type: com.sap.xs.uaa-application
```

---

## 10. Error Handling Strategy

### 10.1 Error Classification

| Error Type | HTTP Code | User Message | Action |
|------------|-----------|--------------|--------|
| **Invalid Coordinates** | 400 | "Invalid location data" | Show error, allow retry |
| **API Key Invalid** | 403 | "Map service unavailable" | Contact admin |
| **Network Timeout** | 504 | "Unable to load map" | Retry button |
| **No Data** | 404 | "Route not found" | Navigate back |
| **Script Load Fail** | 500 | "Map initialization failed" | Refresh page |

### 10.2 Error Handling Flow

```javascript
try {
    // Attempt map rendering
    renderMap(lat, lng);
} catch (error) {
    console.error("Map error:", error);
    
    // User-friendly message
    MessageToast.show("Unable to display map");
    
    // Fallback UI
    showStaticFallback();
    
    // Log for monitoring
    logErrorToBackend(error);
}
```

### 10.3 Retry Logic

```javascript
// Exponential backoff (pseudo-code)
const maxRetries = 10;
const retryDelay = 300; // ms

for (let i = 0; i < maxRetries; i++) {
    if (attemptOperation()) {
        break; // Success
    }
    await sleep(retryDelay);
}
```

---

## 11. Testing Strategy

### 11.1 Test Pyramid

```
        ┌─────────┐
        │   E2E   │  ← Fiori Test Recorder
        └────┬────┘
       ┌─────▼─────┐
       │Integration│  ← OData endpoint tests
       └─────┬─────┘
      ┌──────▼──────┐
      │    Unit     │  ← Handler logic tests
      └─────────────┘
```

### 11.2 Test Cases

#### Unit Tests
- Coordinate validation
- Data transformation
- Error handling functions

#### Integration Tests
- OData CRUD operations
- Service handler hooks
- Database queries

#### UI Tests
- Fragment rendering
- Map display
- Button interactions

### 11.3 Test Data

```javascript
// Sample test route
{
    "origin": "New York, NY",
    "destination": "Boston, MA",
    "distance": "346 km",
    "duration": "3 hours 45 mins",
    "steps": [
        {
            "stepNumber": 1,
            "startLat": 40.7128,
            "startLng": -74.0060,
            "endLat": 40.7589,
            "endLng": -73.9851,
            "instruction": "Head north on Broadway"
        }
    ]
}
```

---

## 12. Appendices

### Appendix A: API Reference

**Google Maps JavaScript API**
- Documentation: https://developers.google.com/maps/documentation/javascript
- Version: V3 (latest)
- Key Features Used:
  - `google.maps.Map`
  - `google.maps.Marker`
  - `google.maps.Polyline`
  - `google.maps.InfoWindow`
  - `google.maps.LatLngBounds`

### Appendix B: CAP Framework

**SAP Cloud Application Programming Model**
- Documentation: https://cap.cloud.sap/docs/
- Version: 9.6.4
- Key Features Used:
  - CDS entities
  - Service handlers
  - Compositions
  - Managed aspects

### Appendix C: Fiori Elements

**SAP Fiori Elements V4**
- Documentation: https://ui5.sap.com/test-resources/sap/fe/core/fpmExplorer/
- Pattern: List Report + Object Page
- Custom Extensions:
  - Custom sections
  - Custom fragments
  - Event handlers

### Appendix D: Glossary

| Term | Definition |
|------|------------|
| **CAP** | Cloud Application Programming Model (SAP framework) |
| **CDS** | Core Data Services (domain modeling language) |
| **OData** | Open Data Protocol (RESTful API standard) |
| **Fiori** | SAP's UX design system |
| **MTA** | Multi-Target Application (deployment package) |
| **XSUAA** | Extended Services User Account and Authentication |
| **BTP** | Business Technology Platform (SAP cloud) |

### Appendix E: File Structure Reference

```
04_CAP_GMaps/
├── app/
│   ├── services.cds                    # UI service annotations
│   └── routes/
│       ├── annotations.cds             # Fiori annotations
│       └── webapp/
│           ├── manifest.json           # UI5 app descriptor
│           └── ext/
│               └── fragment/
│                   ├── DisplayGmap.fragment.xml
│                   └── DisplayGmap.js
├── db/
│   └── gmaps_schema.cds                # Data model
├── srv/
│   ├── gmap_srv.cds                    # Service definition
│   └── gmap_srv.js                     # Service handlers
├── package.json                         # Dependencies
├── mta.yaml                            # Deployment descriptor
└── xs-security.json                    # Auth configuration
```

---

**Document Version Control**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 29 Jan 2026 | Dev Team | Initial release |

---

**Approval Signatures**

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Technical Lead | _________ | _________ | _____ |
| Architect | _________ | _________ | _____ |
| Product Owner | _________ | _________ | _____ |

---

**END OF DOCUMENT**
