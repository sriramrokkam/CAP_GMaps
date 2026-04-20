# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CAP application integrating Google Maps Directions API into SAP Fiori Elements. A user invokes the `getDirections` OData action, which calls the Google Maps API and persists results (Routes + RouteDirections + RouteSteps). The Fiori UI renders a custom Google Map fragment showing the step's start/end coordinates.

## Commands

### Development
```bash
npm start                    # Start CAP dev server (SQLite + mocked auth)
npm run watch-routes         # CAP watch with live-reload, opens the Fiori app automatically
cds watch                    # Equivalent to npm run watch-routes
cds deploy --to sqlite       # Reset/seed local SQLite database
```

### Building & Deploying to BTP
```bash
npm run build                # Full MTA build: mbt build --mtar archive
npm run deploy               # cf deploy mta_archives/archive.mtar
npm run undeploy             # cf undeploy gmaps-app --delete-services
```

### Linting
```bash
npx eslint .
```

## Architecture

### 3-Tier Structure

```
db/gmaps_schema.cds          → Entity definitions (Routes, RouteDirections, RouteSteps)
srv/gmap_srv.cds             → OData V4 service exposure + authorization
srv/gmap_srv.js              → Action handler: calls Google Maps API, persists results
app/routes/                  → Fiori Elements UI5 app
  annotations.cds            → Fiori UI annotations (ListReport + ObjectPage)
  webapp/manifest.json       → UI5 app config (routing, models, pages)
  webapp/ext/fragment/DisplayGmap.js        → Custom map rendering
  webapp/ext/fragment/DisplayGmap.fragment.xml  → Map fragment XML
  webapp/utils/Config.js     → Google Maps API key resolution
```

### Data Model

`Routes` ←(key)— `RouteDirections` —(composition)→ `RouteSteps`

- **Routes**: top-level entity with origin/destination/distance/duration/routeData (raw JSON)
- **RouteDirections**: keyed by `route_ID`, holds flattened bounds (`bounds_northeast_lat/lng`, `bounds_southwest_lat/lng`), rawData, and composition of RouteSteps
- **RouteSteps**: individual navigation steps with start/end coords (`startLat/Lng`, `endLat/Lng`), instruction, maneuver, distance, duration

### Navigation Flow (Fiori FCL — 3 columns)

```
Column 1 (begin):  RouteDirectionsList     → ListReport on /RouteDirections
Column 2 (mid):    RouteDirectionsObjectPage → ObjectPage on /RouteDirections
Column 3 (end):    RouteDirections_stepsObjectPage → ObjectPage on /RouteDirections/steps
                   └── Custom section: DisplayGmap fragment (map for individual step)
```

### Key Action

`GmapsService.getDirections(from, to)` (unbound action):
1. Reads `GOOGLE_MAPS_API_KEY` from env
2. Calls `GoogleAPI-SR` destination (configured as `rest` in `package.json`)
3. Upserts `Routes` → `RouteDirections` → `RouteSteps` (deep insert)
4. Returns the `RouteDirections` entity

### Google Maps Frontend Flow

When a RouteStep Object Page (Column 3) renders, `DisplayGmap.js`:
1. Polls for binding context (10 retries × 300ms) via `afterRendering` on the HTML container
2. Reads `startLat/startLng/endLat/endLng` from the step's binding context
3. Calls `Config.getApiKey()` — reads `window.GOOGLE_MAPS_API_KEY`, falls back to hardcoded dev key
4. Dynamically loads Google Maps JS SDK (cached via module-level flags)
5. Renders map with A/B markers, polyline, auto-fits bounds, info windows on click

### Local vs. Production Config

`package.json` `cds.requires` switches per profile:
- DB: `sqlite` (dev) → `hana` (production)
- Auth: `mocked` user `alice` with role `gmaps_user` (dev) → `xsuaa` (production)
- `GoogleAPI-SR`: direct `https://maps.googleapis.com` (dev) → BTP Destination `GoogleAPI-SR` (production)

### Authentication

- Development: mock user `alice` with role `gmaps_user`
- Production: XSUAA, role-template `gmaps_user`, role-collection `GmapsUser-dev`
- `@requires: 'authenticated-user'` on service; `getDirections` restricted to `gmaps_user`

## Environment Setup

Create a `.env` file at project root with:
```
GOOGLE_MAPS_API_KEY=your_key_here
```
In production the key is sourced from the BTP Destination service `GoogleAPI-SR`.

## Deployment Artifacts

- `mta.yaml`: BTP modules (srv, db-deployer, approuter, html5-deployer) and resources (xsuaa, HDI, destination, html5-repo)
- `xs-security.json`: XSUAA scopes and role templates
- `app/routes/xs-app.json`: App Router routing (OData → srv-api, static → html5-repo)
- `app/router/xs-app.json`: Standalone App Router config
