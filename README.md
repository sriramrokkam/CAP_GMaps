# CAP Google Maps Integration Project

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Getting Started](#getting-started)
5. [Project Structure](#project-structure)
6. [How-To Guides](#how-to-guides)
7. [Configuration](#configuration)
8. [Development Workflow](#development-workflow)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)
11. [API Reference](#api-reference)
12. [Additional Documentation](#additional-documentation)

---

## Overview

This **SAP Cloud Application Programming Model (CAP)** project demonstrates enterprise-grade integration of **Google Maps JavaScript API** within a **Fiori Elements** application. It visualizes route directions and navigation steps with interactive maps, automatic loading, and robust error handling.

### Business Use Case

- Display route planning data from Google Maps Directions API
- Visualize individual navigation steps on interactive maps
- Provide turn-by-turn route guidance in an enterprise application

### Technical Highlights

- ✅ **SAP CAP Framework** - Cloud-native application development
- ✅ **Fiori Elements V4** - Standard UI patterns with custom extensions
- ✅ **OData V4** - RESTful API with full CRUD support
- ✅ **Google Maps API** - Professional map visualization
- ✅ **Automatic Loading** - Zero-click map rendering with retry logic
- ✅ **Production Ready** - Deployable to SAP BTP

---

## Features

### Core Features

- ✅ **Automatic Map Loading** - Map renders automatically when RouteStep is opened
- ✅ **Interactive Markers** - Start (green marker "A") and end (red marker "B") points
- ✅ **Route Visualization** - Blue polyline connecting route steps
- ✅ **Info Windows** - Click markers to see step details
- ✅ **Auto-fit Bounds** - Map automatically zooms to show entire route

### UX Features

- ✅ **Retry Mechanism** - Polls up to 10 times (3 seconds) for data availability
- ✅ **Manual Refresh** - Backup refresh button for user control
- ✅ **Error Messages** - Clear, actionable feedback for failures
- ✅ **Loading States** - Visual feedback during map initialization

### Technical Features

- ✅ **Lazy Loading** - Google Maps script loaded only when needed
- ✅ **Script Caching** - Prevents duplicate API loads
- ✅ **Responsive Design** - Works on desktop and tablet devices
- ✅ **OData Integration** - Full entity relationships with compositions

---

## Prerequisites

### Required Software

| Software | Version | Purpose | Installation |
|----------|---------|---------|--------------|
| **Node.js** | 18.x or 20.x | Runtime environment | https://nodejs.org/ |
| **@sap/cds-dk** | Latest | CAP development tools | `npm i -g @sap/cds-dk` |
| **Git** | Latest | Version control | https://git-scm.com/ |
| **VS Code** | Latest | IDE (recommended) | https://code.visualstudio.com/ |

### Google Maps API Key

You need a Google Maps API key with **Maps JavaScript API** enabled.

Get your key at: https://console.cloud.google.com/apis/credentials

---

## Getting Started

### Step 1: Install Dependencies

```bash
# Navigate to project
cd 04_CAP_GMaps

# Install dependencies
npm install

# Verify CDS installation
cds version
```

### Step 2: Deploy the Database

```bash
# Initialize SQLite database
cds deploy --to sqlite
```

### Step 3: Start the Development Server

```bash
# Start with auto-reload
cds watch
```

Server starts at: **http://localhost:4004**

### Step 4: Test the Application

1. Open: http://localhost:4004/routes.routes/webapp/index.html
2. Click **RouteDirections** → Select a route → Click a **RouteStep**
3. **Map loads automatically** with markers and route line!

**Expected Result:**

- Green marker (A) at start location
- Red marker (B) at end location
- Blue line connecting the points

---

## Project Structure

```text
04_CAP_GMaps/
│
├── 📁 app/                              # UI Layer
│   ├── services.cds                     # UI service exposure
│   └── routes/
│       ├── annotations.cds              # Fiori annotations
│       └── webapp/
│           └── ext/fragment/
│               ├── DisplayGmap.fragment.xml   # Map UI
│               └── DisplayGmap.js             # Map logic ⭐
│
├── 📁 db/                               # Data Layer
│   └── gmaps_schema.cds                 # Entity definitions
│
├── 📁 srv/                              # Service Layer
│   ├── gmap_srv.cds                     # OData service definition
│   └── gmap_srv.js                      # Business logic handlers
│
├── 📄 package.json                      # Dependencies & scripts
├── 📄 mta.yaml                          # BTP deployment descriptor
├── 📄 README.md                         # This file
└── 📄 DETAILED_DESIGN_DOCUMENT.md       # Technical architecture ⭐
```

---

## How-To Guides

### Add Sample Data

Create `db/data/gmaps.db-RouteDirections.csv`:

```csv
route_ID;origin;destination;distance;duration;bounds_northeast_lat;bounds_northeast_lng;bounds_southwest_lat;bounds_southwest_lng
e4d2a904-a2a5-4222-b022-bdb93bf4f7d3;New York, NY;Boston, MA;346 km;3 hours;42.3601;-71.0589;40.7128;-74.0060
```

Create `db/data/gmaps.db-RouteSteps.csv`:

```csv
ID;route_ID;stepNumber;instruction;distance;duration;startLat;startLng;endLat;endLng;travelMode;maneuver
a1b2c3d4;e4d2a904-a2a5-4222-b022-bdb93bf4f7d3;1;Head north;0.2 km;1 min;40.7128;-74.0060;40.7150;-74.0060;DRIVING;straight
```

Deploy:

```bash
cds deploy --to sqlite
```

### Customize the Map

Edit `app/routes/webapp/ext/fragment/DisplayGmap.js`:

**Change marker color** (line ~295):

```javascript
const startMarker = new google.maps.Marker({
    icon: {
        url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    }
});
```

**Change polyline color** (line ~320):

```javascript
const pathLine = new google.maps.Polyline({
    strokeColor: "#FF0000",  // Red line
    strokeWeight: 6          // Thicker
});
```

### Test OData Endpoints

```bash
# Get all routes
curl http://localhost:4004/odata/v4/gmaps/RouteDirections

# Get route with steps
curl "http://localhost:4004/odata/v4/gmaps/RouteDirections(e4d2a904-a2a5-4222-b022-bdb93bf4f7d3)?\$expand=steps"

# Filter steps
curl "http://localhost:4004/odata/v4/gmaps/RouteSteps?\$filter=stepNumber eq 1"
```

---

## Configuration

### Google Maps API Key

**Current setup (Development):**

Hardcoded in `DisplayGmap.js`:

```javascript
const apiKey = "AIzaSyBnJ6XNmu3vQE6Uay9BX7q1HV-Qz_N5eP4";
```

⚠️ **Replace with your own key for production!**

### Database

Edit `package.json`:

```json
{
  "cds": {
    "requires": {
      "db": { "kind": "sqlite" },
      "[production]": { "db": { "kind": "hana" } }
    }
  }
}
```

---

## Development Workflow

### Daily Commands

```bash
# Start dev server
cds watch

# Deploy database changes
cds deploy --to sqlite

# Build for production
cds build --production

# Run tests
npm test
```

### Debugging

**Enable logs:**

```bash
export DEBUG=*
cds watch
```

**Check browser console:**

- Open DevTools (F12)
- Look for messages starting with `===`

---

## Deployment

### BTP Destination Service Setup

Your app uses **SAP BTP Destination service** to securely store the Google Maps API key in production.

#### 1. Create Destination in BTP Cockpit

Navigate to: **BTP Cockpit → Subaccount → Connectivity → Destinations → New Destination**

| Field | Value |
|-------|-------|
| Name | `GoogleAPI-SR` |
| Type | `HTTP` |
| URL | `https://maps.googleapis.com` |
| Proxy Type | `Internet` |
| Authentication | `NoAuthentication` |

**Additional Properties** (click "New Property"):

| Property | Value |
|----------|-------|
| `URL.queries.key` | Your Google Maps API Key |
| `WebIDEEnabled` | `true` |

**Important:** The API key is stored in the destination, not in your code. This allows you to rotate keys without redeploying.

#### 2. Build and Deploy

```bash
# Build MTA archive
npm run build

# Deploy to Cloud Foundry
npm run deploy

# Or manually:
cf deploy mta_archives/archive.mtar
```

#### 3. Verify Deployment

```bash
# Check service bindings
cf services

# View app logs
cf logs gmaps-app-srv --recent

# Test endpoint
cf apps  # Get app URL
```

#### How It Works

**Local Development:**
- Uses direct URL: `https://maps.googleapis.com`
- API key from environment variable or hardcoded fallback

**Production (Cloud Foundry):**
- Uses destination: `GoogleAPI-SR`
- API key automatically injected from destination properties
- No code changes needed - CAP switches automatically via `[production]` profile

**Configuration in package.json:**

```json
"cds": {
  "requires": {
    "GoogleAPI-SR": {
      "kind": "rest",
      "credentials": { "url": "https://maps.googleapis.com" }
    },
    "[production]": {
      "GoogleAPI-SR": {
        "kind": "rest",
        "credentials": { "destination": "GoogleAPI-SR" }
      }
    }
  }
}
```

**Key Points:**
- ✅ Same service name (`GoogleAPI-SR`) in both environments
- ✅ Production automatically uses BTP Destination service
- ✅ API key stored securely in BTP Cockpit
- ✅ Update destination without redeploying app (just restart)

**Best Practices:**
```json
"GoogleAPI-SR": {
  "kind": "rest",
  "credentials": { "url": "https://maps.googleapis.com" }
},
"[production]": {
  "GoogleAPI-SR": {
    "kind": "rest",
    "credentials": { "destination": "GoogleAPI-SR" }
  }
}
```

#### Updating API Key

To rotate/update the API key:
1. Update `URL.queries.key` in BTP Cockpit destination
2. Restart app: `cf restart gmaps-app-srv`
3. No redeployment needed ✅

---

## Troubleshooting

### Map Doesn't Load

**Solutions:**

1. Check API key is valid
2. Open browser console for errors
3. Verify coordinates are valid numbers
4. Click "Refresh Map" button
5. Check network access to Google Maps

### No Data Appears

```bash
# Check database
sqlite3 db.sqlite "SELECT COUNT(*) FROM gmaps_db_RouteDirections;"

# Redeploy
cds deploy --to sqlite
```

### Port Already in Use

```bash
# Kill process on port 4004
lsof -i :4004
kill -9 <PID>

# Or use different port
cds serve --port 5000
```

---

## API Reference

### OData Endpoints

**Base:** `http://localhost:4004/odata/v4/gmaps`

| Endpoint | Description |
|----------|-------------|
| `/RouteDirections` | List all routes |
| `/RouteDirections(guid)` | Get specific route |
| `/RouteDirections?$expand=steps` | Route with steps |
| `/RouteSteps` | List all steps |
| `/$metadata` | Service metadata |

### Entities

**RouteDirections:**

```typescript
{
  route_ID: UUID,
  origin: String(500),
  destination: String(500),
  distance: String(50),
  duration: String(50),
  bounds_*: Double,
  steps: RouteSteps[]
}
```

**RouteSteps:**

```typescript
{
  ID: UUID,
  route_ID: UUID,
  stepNumber: Integer,
  instruction: String(5000),
  startLat: Double,
  startLng: Double,
  endLat: Double,
  endLng: Double,
  travelMode: String(20),
  maneuver: String(50)
}
```

---

## Additional Documentation

| Document | Description |
|----------|-------------|
| `DETAILED_DESIGN_DOCUMENT.md` | Complete technical architecture |
| `mta.yaml` | BTP deployment configuration |
| `xs-security.json` | Authentication setup |

### External Resources

- **SAP CAP:** https://cap.cloud.sap/docs/
- **Fiori Elements:** https://ui5.sap.com/
- **Google Maps API:** https://developers.google.com/maps/documentation/javascript
- **OData V4:** https://www.odata.org/documentation/

---

## 🎯 Quick Links

- **Local App:** http://localhost:4004/routes.routes/webapp/index.html
- **OData Service:** http://localhost:4004/odata/v4/gmaps
- **Metadata:** http://localhost:4004/odata/v4/gmaps/$metadata

---

**Version:** 1.0  
**Last Updated:** 29 January 2026  
**Status:** ✅ Production Ready
